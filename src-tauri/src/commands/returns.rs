// ============================================================================
// RETURNS & REFUNDS COMMANDS
// ============================================================================
// All public commands are pure `#[tauri::command]` functions — no unsafe
// transmute hacks.  The inner-function pattern has been removed; any
// cross-module callers should use the HTTP server routes or duplicate the
// small query they need directly.
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;

use crate::{
    error::{AppError, AppResult},
    models::{
        returns::{
            Return, ReturnItem, ReturnDetail, ReturnStats,
            CreateReturnDto, VoidReturnDto, ReturnFilters,
        },
        pagination::PagedResult,
    },
    state::AppState,
};
use super::auth::guard_permission;
use super::audit::write_audit_log;
use crate::utils::ref_no::{next_ret_ref_no, store_txn_slug};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

/// Fetch a single return row with joined names.
async fn fetch_return(pool: &sqlx::PgPool, id: i32) -> AppResult<Return> {
    sqlx::query_as!(
        Return,
        r#"SELECT
               r.id, r.reference_no, r.original_tx_id,
               t.reference_no                            AS original_ref_no,
               r.store_id, r.cashier_id,
               CONCAT(u.first_name, ' ', u.last_name)   AS cashier_name,
               r.customer_id,
               CONCAT(c.first_name, ' ', c.last_name)   AS customer_name,
               r.return_type, r.subtotal, r.tax_amount,
               r.total_amount, r.refund_method, r.refund_reference,
               r.status, r.reason, r.notes, r.created_at,
               r.voided_at, r.voided_by, r.void_reason
           FROM   returns r
           JOIN   transactions t ON t.id = r.original_tx_id
           JOIN   users        u ON u.id = r.cashier_id
           LEFT JOIN customers c ON c.id = r.customer_id
           WHERE  r.id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Return {id} not found")))
}

/// Fetch all items belonging to a return.
async fn fetch_return_items(pool: &sqlx::PgPool, return_id: i32) -> AppResult<Vec<ReturnItem>> {
    sqlx::query_as!(
        ReturnItem,
        r#"SELECT
               id, return_id, item_id, item_name, sku,
               quantity_returned, unit_price, line_total,
               condition, restocked, notes,
               measurement_type, unit_type
           FROM   return_items
           WHERE  return_id = $1
           ORDER  BY id"#,
        return_id
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

// ── Per-item returned-quantity helper ─────────────────────────────────────────

/// Per-item total quantity already returned for a transaction.
/// Used by the frontend to cap return quantity inputs and mark fully-returned
/// items.  Excludes voided returns.
#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct ReturnedItemQty {
    pub item_id:           uuid::Uuid,
    pub quantity_returned: Decimal,
}

#[tauri::command]
pub async fn get_transaction_returned_quantities(
    state: State<'_, AppState>,
    token: String,
    tx_id: i32,
) -> AppResult<Vec<ReturnedItemQty>> {
    guard_permission(&state, &token, "transactions.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        ReturnedItemQty,
        r#"SELECT
               ri.item_id            AS "item_id!: uuid::Uuid",
               SUM(ri.quantity_returned) AS "quantity_returned!: Decimal"
           FROM   return_items ri
           JOIN   returns r ON r.id = ri.return_id
           WHERE  r.original_tx_id = $1
             AND  r.status        != 'voided'
           GROUP  BY ri.item_id"#,
        tx_id
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Slim search result for command palette ────────────────────────────────────

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct ReturnSearchResult {
    pub id:              i32,
    pub reference_no:    String,
    pub original_ref_no: Option<String>,
    pub customer_name:   Option<String>,
    pub total_amount:    Decimal,
    pub return_type:     String,
    pub status:          String,
    pub created_at:      chrono::DateTime<chrono::Utc>,
}

/// Fast text search for the command palette.
#[tauri::command]
pub async fn search_returns(
    state:    State<'_, AppState>,
    token:    String,
    query:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<ReturnSearchResult>> {
    guard_permission(&state, &token, "transactions.read").await?;
    let pool   = state.pool().await?;
    let limit  = limit.unwrap_or(8).clamp(1, 20);
    let search = format!("%{}%", query.trim());

    sqlx::query_as!(
        ReturnSearchResult,
        r#"SELECT
               r.id, r.reference_no,
               t.reference_no                           AS "original_ref_no",
               CONCAT(c.first_name, ' ', c.last_name)  AS "customer_name",
               r.total_amount, r.return_type, r.status, r.created_at
           FROM   returns r
           JOIN   transactions t ON t.id = r.original_tx_id
           JOIN   users        u ON u.id = r.cashier_id
           LEFT JOIN customers c ON c.id = r.customer_id
           WHERE  ($1::int IS NULL OR r.store_id = $1)
             AND  (
                   r.reference_no                         ILIKE $2
                OR t.reference_no                         ILIKE $2
                OR CONCAT(c.first_name, ' ', c.last_name) ILIKE $2
                OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $2
             )
           ORDER  BY r.created_at DESC
           LIMIT  $3"#,
        store_id,
        search,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Aggregate stats ───────────────────────────────────────────────────────────

/// Returns a single-row stats summary for the given store from v_return_stats.
/// This replaces the 3-query pattern that the frontend was previously using.
#[tauri::command]
pub async fn get_return_stats(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<ReturnStats> {
    guard_permission(&state, &token, "transactions.read").await?;
    let pool = state.pool().await?;

    let row = sqlx::query_as!(
        ReturnStats,
        r#"SELECT
               COALESCE(total_count,     0) AS "total_count!: i64",
               COALESCE(full_count,      0) AS "full_count!: i64",
               COALESCE(partial_count,   0) AS "partial_count!: i64",
               COALESCE(completed_count, 0) AS "completed_count!: i64",
               COALESCE(voided_count,    0) AS "voided_count!: i64",
               COALESCE(total_refunded,  0) AS "total_refunded!: Decimal"
           FROM v_return_stats
           WHERE store_id = $1"#,
        store_id
    )
    .fetch_optional(&pool)
    .await?
    .unwrap_or(ReturnStats {
        total_count:     0,
        full_count:      0,
        partial_count:   0,
        completed_count: 0,
        voided_count:    0,
        total_refunded:  Decimal::ZERO,
    });

    Ok(row)
}

// ── Create return ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_return(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateReturnDto,
) -> AppResult<ReturnDetail> {
    let claims = guard_permission(&state, &token, "transactions.refund").await?;
    let pool   = state.pool().await?;

    // ── Basic validation ──────────────────────────────────────────────────────
    if payload.items.is_empty() {
        return Err(AppError::Validation(
            "Return must include at least one item".into(),
        ));
    }
    let reason = payload
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::Validation("A return reason is required".into()))?;

    // Validate refund method
    let valid_methods = ["cash", "card", "transfer", "original_method", "store_credit"];
    if !valid_methods.contains(&payload.refund_method.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid refund method '{}'. Must be one of: {}",
            payload.refund_method,
            valid_methods.join(", ")
        )));
    }

    // ── Fetch original transaction ────────────────────────────────────────────
    let orig = sqlx::query!(
        r#"SELECT id, store_id, customer_id, status, total_amount, tax_amount
           FROM   transactions
           WHERE  id = $1"#,
        payload.original_tx_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Original transaction not found".into()))?;

    // Scope check: non-global users can only process returns for their own store
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if orig.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    match orig.status.as_str() {
        "voided" | "cancelled" => {
            return Err(AppError::Validation(
                "Cannot return items from a voided or cancelled transaction".into(),
            ))
        }
        "refunded" => {
            return Err(AppError::Validation(
                "This transaction has already been fully refunded. \
                 No further returns are allowed.".into(),
            ))
        }
        _ => {}
    }

    let mut db_tx = pool.begin().await?;

    // ── Generate per-store reference number (RET-{N:04}-{SLUG}) ──────────────
    let ret_store_row = sqlx::query!(
        "SELECT store_name, store_code FROM stores WHERE id = $1",
        orig.store_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let ret_slug = store_txn_slug(
        ret_store_row.as_ref().and_then(|r| r.store_code.as_deref()),
        ret_store_row.as_ref().map(|r| r.store_name.as_str()).unwrap_or("STR"),
    );
    let ref_no = next_ret_ref_no(&pool, orig.store_id, &ret_slug).await;

    // ── Struct to carry validated data between passes ─────────────────────────
    struct ValidatedItem {
        item_id:          uuid::Uuid,
        item_name:        String,
        sku:              String,
        qty_ret:          Decimal,
        unit_price:       Decimal,
        line_total:       Decimal,
        condition:        String,
        restock:          bool,
        notes:            Option<String>,
        measurement_type: String,
        unit_type:        Option<String>,
    }

    let mut validated_items: Vec<ValidatedItem> = Vec::new();
    let mut subtotal   = Decimal::ZERO;
    let mut tax_amount = Decimal::ZERO;

    // ── Pass 1: validate items, compute totals ────────────────────────────────
    for item_dto in &payload.items {
        // Validate condition value
        let valid_conditions = ["good", "damaged", "defective"];
        if !valid_conditions.contains(&item_dto.condition.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid condition '{}'. Must be one of: {}",
                item_dto.condition,
                valid_conditions.join(", ")
            )));
        }

        let orig_item = sqlx::query!(
            r#"SELECT
                   ti.quantity,
                   ti.unit_price,
                   ti.discount,
                   ti.tax_amount,
                   ti.line_total,
                   i.item_name,
                   i.sku,
                   COALESCE(ti.measurement_type, ist.measurement_type) AS measurement_type,
                   COALESCE(ti.unit_type,        ist.unit_type)        AS unit_type
               FROM   transaction_items ti
               JOIN   items i ON i.id = ti.item_id
               LEFT JOIN item_settings ist ON ist.item_id = ti.item_id
               WHERE  ti.tx_id = $1 AND ti.item_id = $2"#,
            payload.original_tx_id,
            item_dto.item_id,
        )
        .fetch_optional(&mut *db_tx)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Item {} not found in the original transaction",
                item_dto.item_id
            ))
        })?;

        let qty_ret = crate::utils::qty::validate_qty_opt(
            to_dec(item_dto.quantity_returned),
            orig_item.measurement_type.as_deref(),
            &orig_item.item_name,
        )?;

        // How much of this item has already been returned in non-voided returns
        let already_returned: Decimal = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(ri.quantity_returned), 0)
               FROM   return_items ri
               JOIN   returns r ON r.id = ri.return_id
               WHERE  r.original_tx_id = $1
                 AND  ri.item_id        = $2
                 AND  r.status         != 'voided'"#,
            payload.original_tx_id,
            item_dto.item_id,
        )
        .fetch_one(&mut *db_tx)
        .await?
        .unwrap_or(Decimal::ZERO);

        let remaining_qty = orig_item.quantity - already_returned;

        if qty_ret <= Decimal::ZERO {
            return Err(AppError::Validation(format!(
                "Return quantity for '{}' must be greater than zero",
                orig_item.item_name
            )));
        }
        if qty_ret > remaining_qty {
            return Err(AppError::Validation(format!(
                "Cannot return {} of '{}'. Only {} unit(s) remaining \
                 ({} already returned).",
                qty_ret, orig_item.item_name, remaining_qty, already_returned
            )));
        }

        // Proportional totals based on validated qty
        let unit_price_inclusive = if orig_item.quantity > Decimal::ZERO {
            orig_item.line_total / orig_item.quantity
        } else {
            orig_item.unit_price
        };
        let line_tot      = unit_price_inclusive * qty_ret;
        let line_tax      = if orig_item.quantity > Decimal::ZERO {
            orig_item.tax_amount * qty_ret / orig_item.quantity
        } else {
            Decimal::ZERO
        };
        let line_subtotal = line_tot - line_tax;

        subtotal   += line_subtotal;
        tax_amount += line_tax;

        validated_items.push(ValidatedItem {
            item_id:          item_dto.item_id,
            item_name:        orig_item.item_name.clone(),
            sku:              orig_item.sku.clone(),
            qty_ret,
            unit_price:       unit_price_inclusive,
            line_total:       line_tot,
            condition:        item_dto.condition.clone(),
            restock:          item_dto.restock,
            notes:            item_dto.notes.clone(),
            measurement_type: orig_item.measurement_type.unwrap_or_else(|| "quantity".into()),
            unit_type:        orig_item.unit_type,
        });
    }

    let total_amount = subtotal + tax_amount;

    // Determine full vs partial: compare cumulative returned vs original total
    let prior_returned: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(total_amount), 0)
           FROM   returns
           WHERE  original_tx_id = $1
             AND  status        != 'voided'"#,
        payload.original_tx_id,
    )
    .fetch_one(&mut *db_tx)
    .await?
    .unwrap_or(Decimal::ZERO);

    let cumulative_returned = prior_returned + total_amount;
    let return_type = if cumulative_returned >= orig.total_amount {
        "full"
    } else {
        "partial"
    };

    // ── Insert returns header ─────────────────────────────────────────────────
    let return_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO returns
               (reference_no, original_tx_id, store_id, cashier_id, customer_id,
                return_type, subtotal, tax_amount, total_amount,
                refund_method, refund_reference, status, reason, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed',$12,$13)
           RETURNING id"#,
        ref_no,
        payload.original_tx_id,
        orig.store_id,
        claims.user_id,
        orig.customer_id,
        return_type,
        subtotal,
        tax_amount,
        total_amount,
        payload.refund_method,
        payload.refund_reference,
        reason,
        payload.notes,
    )
    .fetch_one(&mut *db_tx)
    .await?;

    // ── Pass 2: insert return items, conditionally restock ────────────────────
    for vi in &validated_items {
        sqlx::query!(
            r#"INSERT INTO return_items
                   (return_id, item_id, item_name, sku, quantity_returned,
                    unit_price, line_total, condition, restocked, notes,
                    measurement_type, unit_type)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"#,
            return_id,
            vi.item_id,
            vi.item_name,
            vi.sku,
            vi.qty_ret,
            vi.unit_price,
            vi.line_total,
            vi.condition,
            vi.restock,
            vi.notes,
            vi.measurement_type,
            vi.unit_type,
        )
        .execute(&mut *db_tx)
        .await?;

        // Restock only if condition is good and flag is set
        if vi.restock && vi.condition == "good" {
            sqlx::query!(
                r#"UPDATE item_stock
                   SET quantity           = quantity           + $1,
                       available_quantity = available_quantity + $1,
                       updated_at         = NOW()
                   WHERE item_id = $2 AND store_id = $3"#,
                vi.qty_ret,
                vi.item_id,
                orig.store_id,
            )
            .execute(&mut *db_tx)
            .await?;

            let unit_label = vi.unit_type.as_deref().unwrap_or("unit(s)");
            let desc = format!(
                "Return {}: {} {} of {} restocked",
                ref_no, vi.qty_ret, unit_label, vi.item_name,
            );

            sqlx::query!(
                r#"INSERT INTO item_history
                       (item_id, store_id, event_type, event_description,
                        quantity_before, quantity_after, quantity_change,
                        performed_by, reference_type, reference_id, notes)
                   VALUES ($1,$2,'RETURN',$3,
                       (SELECT quantity - $4 FROM item_stock WHERE item_id = $1 AND store_id = $2),
                       (SELECT quantity       FROM item_stock WHERE item_id = $1 AND store_id = $2),
                       $4, $5, 'return', $6, $7)"#,
                vi.item_id,
                orig.store_id,
                desc,
                vi.qty_ret,
                claims.user_id,
                return_id.to_string(),
                vi.notes,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    // ── Update transaction status ─────────────────────────────────────────────
    let new_status = if return_type == "full" {
        "refunded"
    } else {
        "partially_refunded"
    };
    sqlx::query!(
        "UPDATE transactions SET status = $1, payment_status = $1 WHERE id = $2",
        new_status,
        payload.original_tx_id
    )
    .execute(&mut *db_tx)
    .await?;

    db_tx.commit().await?;

    let ret   = fetch_return(&pool, return_id).await?;
    let items = fetch_return_items(&pool, return_id).await?;

    crate::database::sync::queue_row(
        &pool, "returns", "INSERT", &return_id.to_string(),
        serde_json::json!({ "id": return_id, "store_id": orig.store_id,
                            "reference_no": ret.reference_no,
                            "total_amount": ret.total_amount,
                            "refund_method": payload.refund_method,
                            "status": "completed" }),
        Some(orig.store_id),
    ).await;
    for item in &items {
        crate::database::sync::queue_row(
            &pool, "return_items", "INSERT",
            &item.id.to_string(),
            serde_json::json!({ "id": item.id, "return_id": return_id,
                                "item_id":   item.item_id,
                                "item_name": item.item_name,
                                "quantity_returned": item.quantity_returned,
                                "unit_price": item.unit_price,
                                "line_total": item.line_total }),
            Some(orig.store_id),
        ).await;
    }

    write_audit_log(&pool, claims.user_id, Some(orig.store_id), "create", "return",
        &format!("Return {} — ₦{}", ret.reference_no, ret.total_amount), "info").await;

    Ok(ReturnDetail { ret, items })
}

// ── Get returns list (paginated + filtered) ───────────────────────────────────

#[tauri::command]
pub async fn get_returns(
    state:   State<'_, AppState>,
    token:   String,
    filters: ReturnFilters,
) -> AppResult<PagedResult<Return>> {
    guard_permission(&state, &token, "transactions.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;
    let df     = filters.date_from.as_deref();
    let dt     = filters.date_to.as_deref();

    let search = filters
        .search
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM   returns r
           JOIN   transactions t ON t.id = r.original_tx_id
           JOIN   users        u ON u.id = r.cashier_id
           LEFT JOIN customers c ON c.id = r.customer_id
           WHERE ($1::int  IS NULL OR r.store_id    = $1)
             AND ($2::int  IS NULL OR r.cashier_id  = $2)
             AND ($3::int  IS NULL OR r.customer_id = $3)
             AND ($4::text IS NULL OR r.status      = $4)
             AND ($5::text IS NULL OR r.return_type = $5)
             AND ($6::text IS NULL OR r.created_at >= $6::timestamptz)
             AND ($7::text IS NULL OR r.created_at <= $7::timestamptz)
             AND ($8::text IS NULL OR (
                   r.reference_no                          ILIKE $8
                OR t.reference_no                          ILIKE $8
                OR CONCAT(c.first_name, ' ', c.last_name)  ILIKE $8
                OR CONCAT(u.first_name, ' ', u.last_name)  ILIKE $8
             ))"#,
        filters.store_id,
        filters.cashier_id,
        filters.customer_id,
        filters.status,
        filters.return_type,
        df,
        dt,
        search.as_deref(),
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let records = sqlx::query_as!(
        Return,
        r#"SELECT
               r.id, r.reference_no, r.original_tx_id,
               t.reference_no                          AS original_ref_no,
               r.store_id, r.cashier_id,
               CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
               r.customer_id,
               CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
               r.return_type, r.subtotal, r.tax_amount,
               r.total_amount, r.refund_method, r.refund_reference,
               r.status, r.reason, r.notes, r.created_at,
               r.voided_at, r.voided_by, r.void_reason
           FROM   returns r
           JOIN   transactions t ON t.id = r.original_tx_id
           JOIN   users        u ON u.id = r.cashier_id
           LEFT JOIN customers c ON c.id = r.customer_id
           WHERE ($1::int  IS NULL OR r.store_id    = $1)
             AND ($2::int  IS NULL OR r.cashier_id  = $2)
             AND ($3::int  IS NULL OR r.customer_id = $3)
             AND ($4::text IS NULL OR r.status      = $4)
             AND ($5::text IS NULL OR r.return_type = $5)
             AND ($6::text IS NULL OR r.created_at >= $6::timestamptz)
             AND ($7::text IS NULL OR r.created_at <= $7::timestamptz)
             AND ($8::text IS NULL OR (
                   r.reference_no                          ILIKE $8
                OR t.reference_no                          ILIKE $8
                OR CONCAT(c.first_name, ' ', c.last_name)  ILIKE $8
                OR CONCAT(u.first_name, ' ', u.last_name)  ILIKE $8
             ))
           ORDER  BY r.created_at DESC
           LIMIT  $9 OFFSET $10"#,
        filters.store_id,
        filters.cashier_id,
        filters.customer_id,
        filters.status,
        filters.return_type,
        df,
        dt,
        search.as_deref(),
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(records, total, page, limit))
}

// ── Get single return ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_return(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<ReturnDetail> {
    guard_permission(&state, &token, "transactions.read").await?;
    let pool  = state.pool().await?;
    let ret   = fetch_return(&pool, id).await?;
    let items = fetch_return_items(&pool, id).await?;
    Ok(ReturnDetail { ret, items })
}

// ── Get all returns for a transaction ─────────────────────────────────────────

#[tauri::command]
pub async fn get_transaction_returns(
    state: State<'_, AppState>,
    token: String,
    tx_id: i32,
) -> AppResult<Vec<Return>> {
    guard_permission(&state, &token, "transactions.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Return,
        r#"SELECT
               r.id, r.reference_no, r.original_tx_id,
               t.reference_no                          AS original_ref_no,
               r.store_id, r.cashier_id,
               CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
               r.customer_id,
               CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
               r.return_type, r.subtotal, r.tax_amount,
               r.total_amount, r.refund_method, r.refund_reference,
               r.status, r.reason, r.notes, r.created_at,
               r.voided_at, r.voided_by, r.void_reason
           FROM   returns r
           JOIN   transactions t ON t.id = r.original_tx_id
           JOIN   users        u ON u.id = r.cashier_id
           LEFT JOIN customers c ON c.id = r.customer_id
           WHERE  r.original_tx_id = $1
           ORDER  BY r.created_at DESC"#,
        tx_id
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Void a return ─────────────────────────────────────────────────────────────
// Marks the return as voided, reverses any stock restock that was applied,
// and restores the original transaction's status.

#[tauri::command]
pub async fn void_return(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: VoidReturnDto,
) -> AppResult<ReturnDetail> {
    let claims = guard_permission(&state, &token, "transactions.refund").await?;
    let pool   = state.pool().await?;

    // Fetch the return to void
    let ret = fetch_return(&pool, id).await?;

    // Scope check: non-global users can only void returns from their own store
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if ret.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    if ret.status == "voided" {
        return Err(AppError::Validation("This return has already been voided".into()));
    }

    let items = fetch_return_items(&pool, id).await?;

    let mut db_tx = pool.begin().await?;

    // Mark return as voided
    sqlx::query!(
        r#"UPDATE returns
           SET status      = 'voided',
               voided_at   = NOW(),
               voided_by   = $1,
               void_reason = $2
           WHERE id = $3"#,
        claims.user_id,
        payload.reason,
        id,
    )
    .execute(&mut *db_tx)
    .await?;

    // Reverse any restock operations
    for item in &items {
        if item.restocked && item.condition == "good" {
            sqlx::query!(
                r#"UPDATE item_stock
                   SET quantity           = quantity           - $1,
                       available_quantity = available_quantity - $1,
                       updated_at         = NOW()
                   WHERE item_id = $2 AND store_id = $3"#,
                item.quantity_returned,
                item.item_id,
                ret.store_id,
            )
            .execute(&mut *db_tx)
            .await?;

            let unit_label = item.unit_type.as_deref().unwrap_or("unit(s)");
            let desc = format!(
                "Return {} voided: {} {} of {} removed from stock",
                ret.reference_no, item.quantity_returned, unit_label, item.item_name,
            );

            sqlx::query!(
                r#"INSERT INTO item_history
                       (item_id, store_id, event_type, event_description,
                        quantity_before, quantity_after, quantity_change,
                        performed_by, reference_type, reference_id, notes)
                   VALUES ($1,$2,'RETURN_VOID',$3,
                       (SELECT quantity + $4 FROM item_stock WHERE item_id = $1 AND store_id = $2),
                       (SELECT quantity       FROM item_stock WHERE item_id = $1 AND store_id = $2),
                       -$4, $5, 'return', $6, $7)"#,
                item.item_id,
                ret.store_id,
                desc,
                item.quantity_returned,
                claims.user_id,
                id.to_string(),
                payload.reason,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    // Recalculate and restore the original transaction's status
    // based on remaining non-voided returns
    let remaining_returned: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(total_amount), 0)
           FROM   returns
           WHERE  original_tx_id = $1
             AND  status        != 'voided'"#,
        ret.original_tx_id,
    )
    .fetch_one(&mut *db_tx)
    .await?
    .unwrap_or(Decimal::ZERO);

    let orig_total: Decimal = sqlx::query_scalar!(
        "SELECT total_amount FROM transactions WHERE id = $1",
        ret.original_tx_id
    )
    .fetch_one(&mut *db_tx)
    .await
    .unwrap_or(Decimal::ZERO);

    let restored_status = if remaining_returned <= Decimal::ZERO {
        "completed"
    } else if remaining_returned >= orig_total {
        "refunded"
    } else {
        "partially_refunded"
    };

    sqlx::query!(
        "UPDATE transactions SET status = $1, payment_status = $1 WHERE id = $2",
        restored_status,
        ret.original_tx_id,
    )
    .execute(&mut *db_tx)
    .await?;

    db_tx.commit().await?;

    let updated_ret   = fetch_return(&pool, id).await?;
    let updated_items = fetch_return_items(&pool, id).await?;
    write_audit_log(&pool, claims.user_id, Some(ret.store_id), "void", "return",
        &format!("Voided return {}", ret.reference_no), "warning").await;

    Ok(ReturnDetail { ret: updated_ret, items: updated_items })
}
