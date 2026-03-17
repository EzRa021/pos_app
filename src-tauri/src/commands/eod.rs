// ============================================================================
// END-OF-DAY REPORTS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::eod_report::{
        EodReport, EodHistoryFilters, EodBreakdown,
        EodDeptSummary, EodCategorySummary, EodItemSummary,
        EodPaymentSummary, EodHourlySummary, EodCashierSummary,
    },
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
               COUNT(*)::int AS transactions_count
           FROM transactions
           WHERE status='completed' AND store_id=$1 AND created_at::date=$2::text::date"#,
        store_id, date_str,
    )
    .fetch_one(&pool)
    .await?;

    // Aggregate per-method totals from the payments table so split transactions
    // are counted correctly (one row per payment leg, not per transaction).
    let pm_rows = sqlx::query!(
        r#"SELECT p.payment_method AS "payment_method!",
                  COALESCE(SUM(p.amount), 0) AS "total!"
           FROM payments p
           JOIN transactions t ON t.id = p.transaction_id
           WHERE t.status = 'completed' AND t.store_id = $1
             AND t.created_at::date = $2::text::date
           GROUP BY p.payment_method"#,
        store_id, date_str,
    )
    .fetch_all(&pool)
    .await?;

    let mut cash_collected     = Decimal::ZERO;
    let mut card_collected     = Decimal::ZERO;
    let mut transfer_collected = Decimal::ZERO;
    let mut credit_issued      = Decimal::ZERO;
    for r in &pm_rows {
        match r.payment_method.as_str() {
            "cash"     => cash_collected     = r.total,
            "card"     => card_collected     = r.total,
            "transfer" => transfer_collected = r.total,
            "credit"   => credit_issued      = r.total,
            _          => {}
        }
    }

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
        cash_collected,
        card_collected,
        transfer_collected,
        credit_issued,
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

// ── get_eod_breakdown ─────────────────────────────────────────────────────────
// Live analytical queries for a given date — not persisted in eod_reports.
// Returns department/category/item/payment/hourly/cashier breakdowns.

#[tauri::command]
pub async fn get_eod_breakdown(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    date:     String,
) -> AppResult<EodBreakdown> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;

    // ── Department breakdown ──────────────────────────────────────────────────
    let departments = sqlx::query_as!(
        EodDeptSummary,
        r#"SELECT
               COALESCE(d.department_name, 'Uncategorised') AS "department_name!",
               COUNT(DISTINCT t.id)::int                    AS "transaction_count!",
               COALESCE(SUM(ti.quantity), 0)                AS "qty_sold!",
               COALESCE(SUM(ti.line_total), 0)              AS "gross_sales!",
               COALESCE(SUM(ti.net_amount), 0)              AS "net_sales!"
           FROM transaction_items ti
           JOIN transactions  t ON t.id  = ti.tx_id
           JOIN items         i ON i.id  = ti.item_id
           LEFT JOIN departments d ON d.id = i.department_id
           WHERE t.status = 'completed'
             AND t.store_id = $1
             AND t.created_at::date = $2::text::date
           GROUP BY d.id, d.department_name
           ORDER BY 4 DESC"#,
        store_id, date,
    )
    .fetch_all(&pool)
    .await?;

    // ── Category breakdown ────────────────────────────────────────────────────
    let categories = sqlx::query_as!(
        EodCategorySummary,
        r#"SELECT
               c.category_name                              AS "category_name!",
               d.department_name                            AS department_name,
               COUNT(DISTINCT t.id)::int                   AS "transaction_count!",
               COALESCE(SUM(ti.quantity), 0)               AS "qty_sold!",
               COALESCE(SUM(ti.line_total), 0)             AS "gross_sales!",
               COALESCE(SUM(ti.net_amount), 0)             AS "net_sales!"
           FROM transaction_items ti
           JOIN transactions  t ON t.id  = ti.tx_id
           JOIN items         i ON i.id  = ti.item_id
           JOIN categories    c ON c.id  = i.category_id
           LEFT JOIN departments d ON d.id = c.department_id
           WHERE t.status = 'completed'
             AND t.store_id = $1
             AND t.created_at::date = $2::text::date
           GROUP BY c.id, c.category_name, d.department_name
           ORDER BY 5 DESC"#,
        store_id, date,
    )
    .fetch_all(&pool)
    .await?;

    // ── Top items (up to 30, ordered by qty sold) ─────────────────────────────
    let top_items = sqlx::query_as!(
        EodItemSummary,
        r#"SELECT
               ti.item_name                                                             AS "item_name!",
               ti.sku                                                                   AS "sku!",
               COALESCE(c.category_name, 'Uncategorised')                              AS "category_name!",
               COALESCE(SUM(ti.quantity), 0)                                           AS "qty_sold!",
               COALESCE(SUM(ti.line_total), 0)                                         AS "gross_sales!",
               COALESCE(SUM(ti.net_amount), 0)                                         AS "net_sales!",
               CASE WHEN SUM(ti.quantity) > 0
                    THEN SUM(ti.line_total) / SUM(ti.quantity)
                    ELSE 0::numeric END                                                AS "avg_price!"
           FROM transaction_items ti
           JOIN transactions  t ON t.id = ti.tx_id
           LEFT JOIN items    i ON i.id = ti.item_id
           LEFT JOIN categories c ON c.id = i.category_id
           WHERE t.status = 'completed'
             AND t.store_id = $1
             AND t.created_at::date = $2::text::date
           GROUP BY ti.item_id, ti.item_name, ti.sku, c.category_name
           ORDER BY 4 DESC
           LIMIT 30"#,
        store_id, date,
    )
    .fetch_all(&pool)
    .await?;

    // ── Payment method breakdown ──────────────────────────────────────────────
    let payment_methods = sqlx::query_as!(
        EodPaymentSummary,
        r#"SELECT
               p.payment_method            AS "payment_method!",
               COUNT(*)                    AS "count!",
               COALESCE(SUM(p.amount), 0)  AS "total!"
           FROM payments p
           JOIN transactions t ON t.id = p.transaction_id
           WHERE t.status = 'completed'
             AND t.store_id = $1
             AND t.created_at::date = $2::text::date
           GROUP BY p.payment_method
           ORDER BY 3 DESC"#,
        store_id, date,
    )
    .fetch_all(&pool)
    .await?;

    // ── Hourly sales breakdown ────────────────────────────────────────────────
    let hourly = sqlx::query_as!(
        EodHourlySummary,
        r#"SELECT
               EXTRACT(HOUR FROM t.created_at)::int AS "hour!",
               COUNT(*)::int                         AS "transaction_count!",
               COALESCE(SUM(t.total_amount), 0)      AS "sales!"
           FROM transactions t
           WHERE t.status = 'completed'
             AND t.store_id = $1
             AND t.created_at::date = $2::text::date
           GROUP BY 1
           ORDER BY 1"#,
        store_id, date,
    )
    .fetch_all(&pool)
    .await?;

    // ── Cashier performance ───────────────────────────────────────────────────
    let cashiers = sqlx::query_as!(
        EodCashierSummary,
        r#"SELECT
               u.first_name || ' ' || u.last_name  AS "cashier_name!",
               COUNT(DISTINCT t.id)::int           AS "transaction_count!",
               COALESCE(SUM(t.total_amount), 0)    AS "total_sales!"
           FROM transactions t
           JOIN users u ON u.id = t.cashier_id
           WHERE t.status = 'completed'
             AND t.store_id = $1
             AND t.created_at::date = $2::text::date
           GROUP BY u.id, u.first_name, u.last_name
           ORDER BY 3 DESC"#,
        store_id, date,
    )
    .fetch_all(&pool)
    .await?;

    Ok(EodBreakdown { departments, categories, top_items, payment_methods, hourly, cashiers })
}
