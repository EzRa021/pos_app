// ============================================================================
// PAYMENT COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use serde::Serialize;
use crate::{
    error::AppResult,
    models::payment::{Payment, PaymentFilters},
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;

#[tauri::command]
pub async fn get_payments(
    state:   State<'_, AppState>,
    token:   String,
    filters: PaymentFilters,
) -> AppResult<PagedResult<Payment>> {
    guard_permission(&state, &token, "payments.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;
    let df     = filters.date_from.as_deref();
    let dt     = filters.date_to.as_deref();

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM payments p
           JOIN transactions t ON t.id = p.transaction_id
           WHERE ($1::int  IS NULL OR t.store_id       = $1)
             AND ($2::text IS NULL OR p.payment_method = $2)
             AND ($3::text IS NULL OR p.created_at    >= $3::timestamptz)
             AND ($4::text IS NULL OR p.created_at    <= $4::timestamptz)"#,
        filters.store_id,
        filters.payment_method,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let payments = sqlx::query_as!(
        Payment,
        r#"SELECT p.id, p.transaction_id, p.reference_no, p.payment_method,
                  p.amount, p.currency, p.status, p.processed_by, p.notes,
                  p.created_at
           FROM   payments p
           JOIN   transactions t ON t.id = p.transaction_id
           WHERE ($1::int  IS NULL OR t.store_id       = $1)
             AND ($2::text IS NULL OR p.payment_method = $2)
             AND ($3::text IS NULL OR p.created_at    >= $3::timestamptz)
             AND ($4::text IS NULL OR p.created_at    <= $4::timestamptz)
           ORDER  BY p.created_at DESC
           LIMIT $5 OFFSET $6"#,
        filters.store_id,
        filters.payment_method,
        df,
        dt,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(payments, total, page, limit))
}

// ── Payment summary ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PaymentMethodTotal {
    pub payment_method: String,
    pub count:          i64,
    pub total:          Decimal,
}

#[derive(Debug, Serialize)]
pub struct PaymentSummary {
    pub total_count:   i64,
    pub total_amount:  Decimal,
    pub by_method:     Vec<PaymentMethodTotal>,
}

#[tauri::command]
pub async fn get_payment_summary(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
    date_from: Option<String>,
    date_to:   Option<String>,
) -> AppResult<PaymentSummary> {
    guard_permission(&state, &token, "payments.read").await?;
    let pool = state.pool().await?;
    let df   = date_from.as_deref();
    let dt   = date_to.as_deref();

    let totals_row = sqlx::query!(
        r#"SELECT COUNT(*) AS total_count, COALESCE(SUM(p.amount), 0) AS total_amount
           FROM payments p
           JOIN transactions t ON t.id = p.transaction_id
           WHERE ($1::int  IS NULL OR t.store_id    = $1)
             AND ($2::text IS NULL OR p.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR p.created_at <= $3::timestamptz)"#,
        store_id, df, dt,
    )
    .fetch_one(&pool)
    .await?;

    let by_method = sqlx::query_as!(
        PaymentMethodTotal,
        r#"SELECT
               p.payment_method                AS "payment_method!",
               COUNT(*)                        AS "count!",
               COALESCE(SUM(p.amount), 0)      AS "total!"
           FROM payments p
           JOIN transactions t ON t.id = p.transaction_id
           WHERE ($1::int  IS NULL OR t.store_id    = $1)
             AND ($2::text IS NULL OR p.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR p.created_at <= $3::timestamptz)
           GROUP BY p.payment_method
           ORDER BY 3 DESC"#,
        store_id, df, dt,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PaymentSummary {
        total_count:  totals_row.total_count.unwrap_or(0),
        total_amount: totals_row.total_amount.unwrap_or_default(),
        by_method,
    })
}
