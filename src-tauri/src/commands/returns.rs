// ============================================================================
// RETURNS & REFUNDS COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::returns::{Return, ReturnItem, ReturnDetail, CreateReturnDto, ReturnFilters},
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

async fn fetch_return(pool: &sqlx::PgPool, id: i32) -> AppResult<Return> {
    sqlx::query_as!(
        Return,
        r#"SELECT r.id, r.reference_no, r.original_tx_id,
                  t.reference_no                            AS original_ref_no,
                  r.store_id, r.cashier_id,
                  CONCAT(u.first_name, ' ', u.last_name)   AS cashier_name,
                  r.customer_id,
                  CONCAT(c.first_name, ' ', c.last_name)   AS customer_name,
                  r.return_type, r.subtotal, r.tax_amount,
                  r.total_amount, r.refund_method, r.refund_reference,
                  r.status, r.reason, r.notes, r.created_at
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

async fn fetch_return_items(pool: &sqlx::PgPool, return_id: i32) -> AppResult<Vec<ReturnItem>> {
    sqlx::query_as!(
        ReturnItem,
        r#"SELECT id, return_id, item_id, item_name, sku,
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

pub(crate) async fn create_return_inner(state: &AppState, token: String, payload: crate::models::returns::CreateReturnDto) -> AppResult<crate::models::returns::ReturnDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; create_return(s, token, payload).await
}
pub(crate) async fn get_returns_inner(state: &AppState, token: String, filters: crate::models::returns::ReturnFilters) -> AppResult<crate::models::pagination::PagedResult<crate::models::returns::Return>> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; get_returns(s, token, filters).await
}
pub(crate) async fn get_return_inner(state: &AppState, token: String, id: i32) -> AppResult<crate::models::returns::ReturnDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; get_return(s, token, id).await
}

#[tauri::command]
pub async fn create_return(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateReturnDto,
) -> AppResult<ReturnDetail> {
    let claims = guard_permission(&state, &token, "transactions.refund").await?;
    let pool   = state.pool().await?;

    if payload.items.is_empty() {
        return Err(AppError::Validation("Return must include at least one item".into()));
    }

    // Fetch original transaction
    let orig = sqlx::query!(
        r#"SELECT id, store_id, customer_id, status, total_amount, tax_amount
           FROM   transactions WHERE id = $1"#,
        payload.original_tx_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Original transaction not found".into()))?;

    match orig.status.as_str() {
        "voided" | "cancelled" =>
            return Err(AppError::Validation(
                "Cannot return items from a voided or cancelled transaction".into()
            )),
        "refunded" =>
            return Err(AppError::Validation(
                "This transaction has already been fully refunded. No further returns are allowed".into()
            )),
        _ => {}
    }

    let mut db_tx = pool.begin().await?;

    // Generate reference number
    let ref_no: String = sqlx::query_scalar!(
        "SELECT 'RET-' || LPAD(NEXTVAL('return_ref_seq')::text, 6, '0')"
    )
    .fetch_one(&mut *db_tx)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| format!("RET-{}", chrono::Utc::now().timestamp()));

    // ── Struct to carry validated data between the two loops ─────────────────
    struct ValidatedItem {
        item_id:          uuid::Uuid,
        item_name:        String,
        sku:              String,
        qty_ret:          Decimal,
        unit_price:       Decimal,
        line_total:       Decimal,   // inclusive of tax, proportional
        condition:        String,
        restock:          bool,
        notes:            Option<String>,
        measurement_type: String,
        unit_type:        Option<String>,
    }

    let mut validated_items: Vec<ValidatedItem> = Vec::new();
    let mut subtotal   = Decimal::ZERO;
    let mut tax_amount = Decimal::ZERO;

    // ── Pass 1: validate items against original transaction, compute totals ──
    for item_dto in &payload.items {
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
        .ok_or_else(|| AppError::Validation(
            format!("Item {} not found in original transaction", item_dto.item_id)
        ))?;

        let qty_ret = crate::utils::qty::validate_qty_opt(
            to_dec(item_dto.quantity_returned),
            orig_item.measurement_type.as_deref(),
            &orig_item.item_name,
        )?;

        // How much of this item has already been returned in prior returns
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
                "Return quantity for '{}' must be greater than zero", orig_item.item_name
            )));
        }
        if qty_ret > remaining_qty {
            return Err(AppError::Validation(format!(
                "Cannot return {} of '{}'. Only {} unit(s) remaining after {} already returned.",
                qty_ret, orig_item.item_name, remaining_qty, already_returned
            )));
        }

        // Proportional line total and tax based on validated qty
        let unit_price_inclusive = if orig_item.quantity > Decimal::ZERO {
            orig_item.line_total / orig_item.quantity
        } else {
            orig_item.unit_price
        };
        let line_tot = unit_price_inclusive * qty_ret;
        let line_tax = if orig_item.quantity > Decimal::ZERO {
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

    // Include tax in the return total so it matches original total_amount semantics
    let total_amount = subtotal + tax_amount;

    // Determine if this return (combined with any prior returns) makes it a full return.
    // Compare cumulative returned amount against the original transaction total.
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
    let return_type = if cumulative_returned >= orig.total_amount { "full" } else { "partial" };

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
        payload.reason,
        payload.notes,
    )
    .fetch_one(&mut *db_tx)
    .await?;

    // ── Pass 2: insert return items + conditionally restock ───────────────────
    // Uses the validated data cached in pass 1 — no re-fetch needed.
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

        // Restock only if item is in good condition and restock flag is set
        if vi.restock && vi.condition == "good" {
            sqlx::query!(
                r#"UPDATE item_stock SET
                   quantity           = quantity           + $1,
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
                "Return: {} — {} {} of {}",
                ref_no, vi.qty_ret, unit_label, vi.item_name,
            );

            sqlx::query!(
                r#"INSERT INTO item_history
                       (item_id, store_id, event_type, event_description,
                        quantity_before, quantity_after, quantity_change,
                        performed_by, reference_type, reference_id, notes)
                   VALUES ($1,$2,'RETURN',$3,
                           (SELECT quantity - $4 FROM item_stock WHERE item_id = $1 AND store_id = $2),
                           (SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2),
                           $4,
                           $5,'return',$6,$7)"#,
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

    // Update transaction status — use consistent status strings that match the
    // full_refund / void_transaction commands and the frontend status checks.
    let new_status = if return_type == "full" { "refunded" } else { "partially_refunded" };
    sqlx::query!(
        "UPDATE transactions SET status = $1, payment_status = $1 WHERE id = $2",
        new_status, payload.original_tx_id
    )
    .execute(&mut *db_tx)
    .await?;

    db_tx.commit().await?;

    let ret   = fetch_return(&pool, return_id).await?;
    let items = fetch_return_items(&pool, return_id).await?;

    Ok(ReturnDetail { ret, items })
}

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

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM returns
           WHERE ($1::int  IS NULL OR store_id    = $1)
             AND ($2::int  IS NULL OR cashier_id  = $2)
             AND ($3::int  IS NULL OR customer_id = $3)
             AND ($4::text IS NULL OR status      = $4)
             AND ($5::text IS NULL OR return_type = $5)
             AND ($6::text IS NULL OR created_at >= $6::timestamptz)
             AND ($7::text IS NULL OR created_at <= $7::timestamptz)"#,
        filters.store_id, filters.cashier_id, filters.customer_id,
        filters.status, filters.return_type, df, dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let records = sqlx::query_as!(
        Return,
        r#"SELECT r.id, r.reference_no, r.original_tx_id,
                  t.reference_no                          AS original_ref_no,
                  r.store_id, r.cashier_id,
                  CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                  r.customer_id,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                  r.return_type, r.subtotal, r.tax_amount,
                  r.total_amount, r.refund_method, r.refund_reference,
                  r.status, r.reason, r.notes, r.created_at
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
           ORDER  BY r.created_at DESC
           LIMIT $8 OFFSET $9"#,
        filters.store_id, filters.cashier_id, filters.customer_id,
        filters.status, filters.return_type, df, dt, limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(records, total, page, limit))
}

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

pub(crate) async fn get_transaction_returns_inner(state: &AppState, token: String, tx_id: i32) -> AppResult<Vec<Return>> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; get_transaction_returns(s, token, tx_id).await
}

/// Get all returns for a specific transaction.
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
        r#"SELECT r.id, r.reference_no, r.original_tx_id,
                  t.reference_no                          AS original_ref_no,
                  r.store_id, r.cashier_id,
                  CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                  r.customer_id,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                  r.return_type, r.subtotal, r.tax_amount,
                  r.total_amount, r.refund_method, r.refund_reference,
                  r.status, r.reason, r.notes, r.created_at
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
