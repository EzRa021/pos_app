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
                  condition, restocked, notes
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
    let claims = guard_permission(&state, &token, "transactions.void").await?;
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

    if orig.status == "voided" {
        return Err(AppError::Validation("Cannot return items from a voided transaction".into()));
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

    let mut subtotal   = Decimal::ZERO;
    let mut tax_amount = Decimal::ZERO;

    // Validate items against original transaction and compute totals
    for item_dto in &payload.items {
        let orig_item = sqlx::query!(
            r#"SELECT ti.quantity, ti.unit_price, ti.discount, ti.tax_amount, i.item_name, i.sku
               FROM   transaction_items ti
               JOIN   items i ON i.id = ti.item_id
               WHERE  ti.tx_id = $1 AND ti.item_id = $2"#,
            payload.original_tx_id,
            item_dto.item_id,
        )
        .fetch_optional(&mut *db_tx)
        .await?
        .ok_or_else(|| AppError::Validation(
            format!("Item {} not found in original transaction", item_dto.item_id)
        ))?;

        let qty_ret = to_dec(item_dto.quantity_returned);
        if qty_ret > orig_item.quantity {
            return Err(AppError::Validation(format!(
                "Cannot return {} of {}. Original quantity was {}",
                qty_ret, orig_item.item_name, orig_item.quantity
            )));
        }

        let line_tot   = (orig_item.unit_price - orig_item.discount) * qty_ret;
        let line_tax   = if orig_item.quantity > Decimal::ZERO {
            orig_item.tax_amount * qty_ret / orig_item.quantity
        } else { Decimal::ZERO };

        subtotal   += line_tot;
        tax_amount += line_tax;
    }

    let total_amount = subtotal;
    let return_type  = if subtotal >= orig.total_amount { "full" } else { "partial" };

    let return_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO returns
               (reference_no, original_tx_id, store_id, cashier_id, customer_id,
                return_type, subtotal, tax_amount, total_amount,
                refund_method, refund_reference, reason, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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

    // Insert return items and conditionally restock
    for item_dto in &payload.items {
        let orig_item = sqlx::query!(
            r#"SELECT ti.unit_price, ti.discount, i.item_name, i.sku
               FROM   transaction_items ti
               JOIN   items i ON i.id = ti.item_id
               WHERE  ti.tx_id = $1 AND ti.item_id = $2"#,
            payload.original_tx_id,
            item_dto.item_id,
        )
        .fetch_one(&mut *db_tx)
        .await?;

        let qty_ret  = to_dec(item_dto.quantity_returned);
        let line_tot = (orig_item.unit_price - orig_item.discount) * qty_ret;

        sqlx::query!(
            r#"INSERT INTO return_items
                   (return_id, item_id, item_name, sku, quantity_returned,
                    unit_price, line_total, condition, restocked, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)"#,
            return_id,
            item_dto.item_id,
            orig_item.item_name,
            orig_item.sku,
            qty_ret,
            orig_item.unit_price,
            line_tot,
            item_dto.condition,
            item_dto.restock,
            item_dto.notes,
        )
        .execute(&mut *db_tx)
        .await?;

        // Restock only if item is in good/undamaged condition and flag is set
        if item_dto.restock && item_dto.condition == "good" {
            sqlx::query!(
                r#"UPDATE item_stock SET
                   quantity           = quantity           + $1,
                   available_quantity = available_quantity + $1,
                   updated_at         = NOW()
                   WHERE item_id  = $2 AND store_id = $3"#,
                qty_ret,
                item_dto.item_id,
                orig.store_id,
            )
            .execute(&mut *db_tx)
            .await?;

            sqlx::query!(
                r#"INSERT INTO item_history
                       (item_id, store_id, change_type, adjustment, reason, created_by)
                   VALUES ($1,$2,'return',$3,$4,$5)"#,
                item_dto.item_id,
                orig.store_id,
                qty_ret,
                format!("Return: {ref_no}"),
                claims.user_id,
            )
            .execute(&mut *db_tx)
            .await?;
        }
    }

    // Update transaction status to 'refunded' or 'partial_refund'
    let new_status = if return_type == "full" { "refunded" } else { "partial_refund" };
    sqlx::query!(
        "UPDATE transactions SET status = $1 WHERE id = $2",
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
