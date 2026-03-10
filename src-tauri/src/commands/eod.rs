// ============================================================================
// END-OF-DAY REPORTS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::eod_report::{EodReport, EodHistoryFilters},
    state::AppState,
};
use super::auth::guard_permission;

// ── generate_eod_report ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_eod_report(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    date:     Option<String>,
) -> AppResult<EodReport> {
    let claims = guard_permission(&state, &token, "analytics.read").await?;
    let pool   = state.pool().await?;
    let date_str = date.unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());

    let locked: Option<bool> = sqlx::query_scalar!(
        "SELECT is_locked FROM eod_reports WHERE store_id = $1 AND report_date = $2::text::date",
        store_id, date_str,
    )
    .fetch_optional(&pool)
    .await?;

    if locked == Some(true) {
        return Err(AppError::Validation(
            format!("EOD report for {date_str} is locked and cannot be regenerated"),
        ));
    }

    let sales = sqlx::query!(
        r#"SELECT
               COALESCE(SUM(total_amount),    0) AS gross_sales,
               COALESCE(SUM(discount_amount), 0) AS total_discounts,
               COALESCE(SUM(tax_amount),      0) AS total_tax,
               COALESCE(SUM(CASE WHEN payment_method='cash'     THEN total_amount ELSE 0 END), 0) AS cash_collected,
               COALESCE(SUM(CASE WHEN payment_method='card'     THEN total_amount ELSE 0 END), 0) AS card_collected,
               COALESCE(SUM(CASE WHEN payment_method='transfer' THEN total_amount ELSE 0 END), 0) AS transfer_collected,
               COALESCE(SUM(CASE WHEN payment_method='credit'   THEN total_amount ELSE 0 END), 0) AS credit_issued,
               COUNT(*)::int AS transactions_count
           FROM transactions
           WHERE status='completed' AND store_id=$1 AND created_at::date=$2::text::date"#,
        store_id, date_str,
    )
    .fetch_one(&pool)
    .await?;

    let items_sold: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(ti.quantity), 0)
           FROM transaction_items ti
           JOIN transactions t ON t.id = ti.tx_id
           WHERE t.status='completed' AND t.store_id=$1 AND t.created_at::date=$2::text::date"#,
        store_id, date_str,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    let cogs: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(ti.quantity * i.cost_price), 0)
           FROM transaction_items ti
           JOIN transactions t ON t.id = ti.tx_id
           JOIN items i ON i.id = ti.item_id
           WHERE t.status='completed' AND t.store_id=$1 AND t.created_at::date=$2::text::date"#,
        store_id, date_str,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    let total_expenses: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(amount), 0) FROM expenses
           WHERE store_id=$1 AND approval_status='approved'
             AND deleted_at IS NULL AND expense_date::date=$2::text::date"#,
        store_id, date_str,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    let voids = sqlx::query!(
        r#"SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total_amount), 0) AS amount
           FROM transactions
           WHERE status='voided' AND store_id=$1 AND created_at::date=$2::text::date"#,
        store_id, date_str,
    )
    .fetch_one(&pool)
    .await?;

    let refunds = sqlx::query!(
        r#"SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total_amount), 0) AS amount
           FROM returns
           WHERE status!='voided' AND store_id=$1 AND created_at::date=$2::text::date"#,
        store_id, date_str,
    )
    .fetch_one(&pool)
    .await?;

    let credit_collected: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(cp.amount), 0)
           FROM credit_payments cp
           JOIN credit_sales cs ON cs.id = cp.credit_sale_id
           WHERE cs.store_id=$1 AND cp.created_at::date=$2::text::date"#,
        store_id, date_str,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    let shift_cash = sqlx::query!(
        r#"SELECT opening_float, actual_cash, cash_difference
           FROM shifts WHERE store_id=$1 AND status='closed'
             AND opened_at::date=$2::text::date
           ORDER BY closed_at DESC LIMIT 1"#,
        store_id, date_str,
    )
    .fetch_optional(&pool)
    .await?;

    let gross_sales     = sales.gross_sales.unwrap_or_default();
    let total_discounts = sales.total_discounts.unwrap_or_default();
    let total_tax       = sales.total_tax.unwrap_or_default();
    let net_sales       = gross_sales - total_discounts;
    let gross_profit    = net_sales - cogs;
    let net_profit      = gross_profit - total_expenses;

    let report_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO eod_reports (
               store_id, report_date,
               gross_sales, total_discounts, net_sales, total_tax,
               cost_of_goods_sold, gross_profit, total_expenses, net_profit,
               cash_collected, card_collected, transfer_collected,
               credit_issued, credit_collected,
               items_sold, transactions_count,
               voids_count, voids_amount, refunds_count, refunds_amount,
               opening_float, closing_cash, cash_difference,
               generated_by, generated_at
           ) VALUES (
               $1, $2::text::date,
               $3,$4,$5,$6,$7,$8,$9,$10,
               $11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,
               $22,$23,$24,$25,NOW()
           )
           ON CONFLICT (store_id, report_date) DO UPDATE SET
               gross_sales        = EXCLUDED.gross_sales,
               total_discounts    = EXCLUDED.total_discounts,
               net_sales          = EXCLUDED.net_sales,
               total_tax          = EXCLUDED.total_tax,
               cost_of_goods_sold = EXCLUDED.cost_of_goods_sold,
               gross_profit       = EXCLUDED.gross_profit,
               total_expenses     = EXCLUDED.total_expenses,
               net_profit         = EXCLUDED.net_profit,
               cash_collected     = EXCLUDED.cash_collected,
               card_collected     = EXCLUDED.card_collected,
               transfer_collected = EXCLUDED.transfer_collected,
               credit_issued      = EXCLUDED.credit_issued,
               credit_collected   = EXCLUDED.credit_collected,
               items_sold         = EXCLUDED.items_sold,
               transactions_count = EXCLUDED.transactions_count,
               voids_count        = EXCLUDED.voids_count,
               voids_amount       = EXCLUDED.voids_amount,
               refunds_count      = EXCLUDED.refunds_count,
               refunds_amount     = EXCLUDED.refunds_amount,
               opening_float      = EXCLUDED.opening_float,
               closing_cash       = EXCLUDED.closing_cash,
               cash_difference    = EXCLUDED.cash_difference,
               generated_by       = EXCLUDED.generated_by,
               generated_at       = NOW()
           RETURNING id"#,
        store_id, date_str,
        gross_sales, total_discounts, net_sales, total_tax, cogs, gross_profit,
        total_expenses, net_profit,
        sales.cash_collected.unwrap_or_default(),
        sales.card_collected.unwrap_or_default(),
        sales.transfer_collected.unwrap_or_default(),
        sales.credit_issued.unwrap_or_default(),
        credit_collected,
        items_sold,
        sales.transactions_count.unwrap_or(0),
        voids.cnt.unwrap_or(0),
        voids.amount.unwrap_or_default(),
        refunds.cnt.unwrap_or(0),
        refunds.amount.unwrap_or_default(),
        shift_cash.as_ref().map(|s| s.opening_float),
        shift_cash.as_ref().and_then(|s| s.actual_cash),
        shift_cash.as_ref().and_then(|s| s.cash_difference),
        claims.user_id,
    )
    .fetch_one(&pool)
    .await?;

    fetch_eod(&pool, report_id).await
}

// ── lock_eod_report ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lock_eod_report(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<EodReport> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let exists: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM eod_reports WHERE id = $1)", id
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(false);
    if !exists {
        return Err(AppError::NotFound(format!("EOD report {id} not found")));
    }
    sqlx::query!("UPDATE eod_reports SET is_locked = TRUE WHERE id = $1", id)
        .execute(&pool)
        .await?;
    fetch_eod(&pool, id).await
}

// ── get_eod_report ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_eod_report(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    date:     String,
) -> AppResult<EodReport> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    sqlx::query_as!(
        EodReport,
        r#"SELECT id, store_id, report_date,
                  gross_sales, total_discounts, net_sales, total_tax,
                  cost_of_goods_sold, gross_profit, total_expenses, net_profit,
                  cash_collected, card_collected, transfer_collected,
                  credit_issued, credit_collected,
                  items_sold, transactions_count,
                  voids_count, voids_amount, refunds_count, refunds_amount,
                  opening_float, closing_cash, cash_difference,
                  generated_by, generated_at, is_locked
           FROM eod_reports WHERE store_id=$1 AND report_date=$2::text::date"#,
        store_id, date,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("No EOD report for store {store_id} on {date}")))
}

// ── get_eod_history ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_eod_history(
    state:   State<'_, AppState>,
    token:   String,
    filters: EodHistoryFilters,
) -> AppResult<Vec<EodReport>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool  = state.pool().await?;
    let limit = filters.limit.unwrap_or(31).clamp(1, 365);
    let df    = filters.date_from.as_deref();
    let dt    = filters.date_to.as_deref();
    sqlx::query_as!(
        EodReport,
        r#"SELECT id, store_id, report_date,
                  gross_sales, total_discounts, net_sales, total_tax,
                  cost_of_goods_sold, gross_profit, total_expenses, net_profit,
                  cash_collected, card_collected, transfer_collected,
                  credit_issued, credit_collected,
                  items_sold, transactions_count,
                  voids_count, voids_amount, refunds_count, refunds_amount,
                  opening_float, closing_cash, cash_difference,
                  generated_by, generated_at, is_locked
           FROM eod_reports
           WHERE store_id=$1
             AND ($2::text IS NULL OR report_date >= $2::text::date)
             AND ($3::text IS NULL OR report_date <= $3::text::date)
           ORDER BY report_date DESC LIMIT $4"#,
        filters.store_id, df, dt, limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── helper ────────────────────────────────────────────────────────────────────

async fn fetch_eod(pool: &sqlx::PgPool, id: i32) -> AppResult<EodReport> {
    sqlx::query_as!(
        EodReport,
        r#"SELECT id, store_id, report_date,
                  gross_sales, total_discounts, net_sales, total_tax,
                  cost_of_goods_sold, gross_profit, total_expenses, net_profit,
                  cash_collected, card_collected, transfer_collected,
                  credit_issued, credit_collected,
                  items_sold, transactions_count,
                  voids_count, voids_amount, refunds_count, refunds_amount,
                  opening_float, closing_cash, cash_difference,
                  generated_by, generated_at, is_locked
           FROM eod_reports WHERE id=$1"#,
        id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("EOD report {id} not found")))
}
