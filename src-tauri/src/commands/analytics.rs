// ============================================================================
// ANALYTICS COMMANDS
// ============================================================================

use super::auth::guard_permission;
use crate::error::AppError;
use crate::{
    error::AppResult,
    models::analytics::{
        AnalyticsFilters,
        BusinessHealthSummary,
        CashierPerformance,
        CashierReturnStats,
        CategoryAnalytics,
        CategoryProfitAnalysis,
        CustomerAnalytics,
        CustomerAnalyticsReport,
        DailySummary,
        DeadStockItem,
        DepartmentAnalytics,
        DepartmentProfitAnalysis,
        DiscountAnalytics,
        DiscountByCashier,
        DiscountByItem,
        ItemAnalytics,
        LowMarginItem,
        PaymentMethodSummary,
        PaymentTrend,
        PeakHour,
        PeriodComparison,
        PeriodComparisonMetric,
        ProfitAnalysisItem,
        ProfitAnalysisReport,
        ProfitLossSummary,
        ReturnAnalysisItem,
        ReturnAnalysisReport,
        ReturnSummary,
        RevenueByPeriod,
        SalesSummary,
        SlowMovingItem,
        StockVelocityItem,
        SupplierAnalytics,
        TaxReport,
        TaxReportRow,
        TopCategory,
        TopItem,
        VatByCategoryRow,
    },
    state::AppState,
};
use chrono::Datelike;
use rust_decimal::Decimal;
use tauri::State;

// ═══════════════════════════════════════════════════════════════════════════════
// EXISTING COMMANDS (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn get_sales_summary(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<SalesSummary> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    let row = sqlx::query!(
        r#"SELECT
               COUNT(*)                         AS total_transactions,
               COALESCE(SUM(total_amount),  0)  AS total_revenue,
               COALESCE(SUM(tax_amount),    0)  AS total_tax,
               COALESCE(SUM(discount_amount), 0) AS total_discounts,
               COALESCE(SUM(total_amount - tax_amount), 0) AS net_revenue,
               COALESCE(AVG(total_amount),  0)  AS average_order
           FROM  transactions
           WHERE status = 'completed'
             AND ($1::int  IS NULL OR store_id   = $1)
             AND ($2::text IS NULL OR created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR created_at <= $3::timestamptz)"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?;

    let total_items: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(ti.quantity), 0)
           FROM   transaction_items ti
           JOIN   transactions      t  ON t.id = ti.tx_id
           WHERE  t.status = 'completed'
             AND ($1::int  IS NULL OR t.store_id   = $1)
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    Ok(SalesSummary {
        total_transactions: row.total_transactions.unwrap_or(0),
        total_revenue: row.total_revenue.unwrap_or_default(),
        total_tax: row.total_tax.unwrap_or_default(),
        total_discounts: row.total_discounts.unwrap_or_default(),
        net_revenue: row.net_revenue.unwrap_or_default(),
        average_order: row.average_order.unwrap_or_default(),
        total_items_sold: total_items,
    })
}

#[tauri::command]
pub async fn get_revenue_by_period(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<RevenueByPeriod>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    let trunc = match filters.period.as_deref().unwrap_or("day") {
        "week" => "week",
        "month" => "month",
        "year" => "year",
        _ => "day",
    };

    let records = sqlx::query_as!(
        RevenueByPeriod,
        r#"SELECT
               DATE_TRUNC($1, created_at)::text       AS "period!",
               COUNT(*)                               AS "transactions!",
               COALESCE(SUM(total_amount),  0)        AS "revenue!",
               COALESCE(SUM(tax_amount),    0)        AS "tax!",
               COALESCE(SUM(discount_amount), 0)      AS "discounts!"
           FROM  transactions
           WHERE status = 'completed'
             AND ($2::int  IS NULL OR store_id   = $2)
             AND ($3::text IS NULL OR created_at >= $3::timestamptz)
             AND ($4::text IS NULL OR created_at <= $4::timestamptz)
           GROUP  BY DATE_TRUNC($1, created_at)
           ORDER  BY 1"#,
        trunc,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    Ok(records)
}

#[tauri::command]
pub async fn get_top_items(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<TopItem>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit = filters.limit.unwrap_or(10).clamp(1, 100);

    let items = sqlx::query_as!(
        TopItem,
        r#"SELECT
               ti.item_id,
               ti.item_name                          AS "item_name!",
               ti.sku                                AS "sku!",
               COALESCE(SUM(ti.quantity), 0)         AS "qty_sold!",
               COALESCE(SUM(ti.line_total), 0)       AS "revenue!",
               MAX(ist.measurement_type)             AS "measurement_type: String",
               MAX(ist.unit_type)                    AS "unit_type: String"
           FROM   transaction_items ti
           JOIN   transactions      t   ON t.id = ti.tx_id
           JOIN   items             i   ON i.id = ti.item_id
           LEFT  JOIN item_settings ist ON ist.item_id = i.id
           WHERE  t.status = 'completed'
             AND ($1::int  IS NULL OR t.store_id   = $1)
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
           GROUP  BY ti.item_id, ti.item_name, ti.sku
           ORDER  BY 4 DESC
           LIMIT  $4"#,
        filters.store_id,
        df,
        dt,
        limit,
    )
    .fetch_all(&pool)
    .await?;

    Ok(items)
}

#[tauri::command]
pub async fn get_top_categories(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<TopCategory>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit = filters.limit.unwrap_or(10).clamp(1, 100);

    let cats = sqlx::query_as!(
        TopCategory,
        r#"SELECT
               COALESCE(c.category_name, 'Uncategorized') AS "category_name!",
               COALESCE(SUM(ti.quantity),   0)            AS "qty_sold!",
               COALESCE(SUM(ti.line_total), 0)            AS "revenue!"
           FROM   transaction_items ti
           JOIN   transactions      t ON t.id = ti.tx_id
           JOIN   items             i ON i.id = ti.item_id
           LEFT JOIN categories     c ON c.id = i.category_id
           WHERE  t.status = 'completed'
             AND ($1::int  IS NULL OR t.store_id   = $1)
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
           GROUP  BY c.category_name
           ORDER  BY 2 DESC
           LIMIT  $4"#,
        filters.store_id,
        df,
        dt,
        limit,
    )
    .fetch_all(&pool)
    .await?;

    Ok(cats)
}

#[tauri::command]
pub async fn get_payment_method_summary(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<PaymentMethodSummary>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    // Query from the payments table so split transactions are counted correctly:
    // each payment leg is counted individually by its actual payment method.
    sqlx::query_as!(
        PaymentMethodSummary,
        r#"SELECT
               p.payment_method                 AS "payment_method!",
               COUNT(*)                         AS "count!",
               COALESCE(SUM(p.amount), 0)       AS "total!"
           FROM  payments p
           JOIN  transactions t ON t.id = p.transaction_id
           WHERE t.status = 'completed'
             AND ($1::int  IS NULL OR t.store_id   = $1)
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
           GROUP  BY p.payment_method
           ORDER  BY 3 DESC"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_daily_summary(
    state: State<'_, AppState>,
    token: String,
    store_id: i32,
    date: Option<String>,
) -> AppResult<DailySummary> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let date_str = date.unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());

    let sales_row = sqlx::query!(
        r#"SELECT
               COUNT(DISTINCT id)                                                                   AS transaction_count,
               COALESCE(SUM(total_amount),    0)                                                   AS gross_sales,
               COALESCE(SUM(discount_amount), 0)                                                   AS total_discounts,
               COALESCE(SUM(tax_amount),      0)                                                   AS total_tax,
               COALESCE(SUM(total_amount - tax_amount), 0)                                         AS net_sales,
               COALESCE(SUM(CASE WHEN payment_method = 'cash'     THEN total_amount ELSE 0 END), 0) AS cash_sales,
               COALESCE(SUM(CASE WHEN payment_method = 'card'     THEN total_amount ELSE 0 END), 0) AS card_sales,
               COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN total_amount ELSE 0 END), 0) AS transfer_sales,
               COALESCE(SUM(CASE WHEN payment_method = 'credit'   THEN total_amount ELSE 0 END), 0) AS credit_sales
           FROM  transactions
           WHERE status   = 'completed'
             AND store_id = $1
             AND created_at::date = $2::text::date"#,
        store_id,
        date_str,
    )
    .fetch_one(&pool)
    .await?;

    let items_sold: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(ti.quantity), 0)
           FROM   transaction_items ti
           JOIN   transactions t ON t.id = ti.tx_id
           WHERE  t.status   = 'completed'
             AND  t.store_id = $1
             AND  t.created_at::date = $2::text::date"#,
        store_id,
        date_str,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    let total_expenses: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(amount), 0)
           FROM   expenses
           WHERE  store_id        = $1
             AND  approval_status = 'approved'
             AND  deleted_at      IS NULL
             AND  expense_date::date = $2::text::date"#,
        store_id,
        date_str,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    let net_sales = sales_row.net_sales.unwrap_or_default();
    let gross_profit = net_sales - sales_row.total_tax.unwrap_or_default();
    let net_profit = gross_profit - total_expenses;

    Ok(DailySummary {
        date: date_str,
        transaction_count: sales_row.transaction_count.unwrap_or(0),
        items_sold,
        gross_sales: sales_row.gross_sales.unwrap_or_default(),
        total_discounts: sales_row.total_discounts.unwrap_or_default(),
        net_sales,
        total_tax: sales_row.total_tax.unwrap_or_default(),
        total_expenses,
        gross_profit,
        net_profit,
        cash_sales: sales_row.cash_sales.unwrap_or_default(),
        card_sales: sales_row.card_sales.unwrap_or_default(),
        transfer_sales: sales_row.transfer_sales.unwrap_or_default(),
        credit_sales: sales_row.credit_sales.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn get_department_analytics(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<DepartmentAnalytics>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit = filters.limit.unwrap_or(20).clamp(1, 100);

    sqlx::query_as!(
        DepartmentAnalytics,
        r#"SELECT
               COALESCE(d.department_name, 'Uncategorized') AS "department_name!",
               COALESCE(SUM(ti.quantity),   0)              AS "qty_sold!",
               COALESCE(SUM(ti.line_total), 0)              AS "revenue!",
               COUNT(DISTINCT t.id)                         AS "transaction_count!"
           FROM   transaction_items ti
           JOIN   transactions t  ON t.id  = ti.tx_id
           JOIN   items         i  ON i.id  = ti.item_id
           LEFT JOIN categories     c  ON c.id  = i.category_id
           LEFT JOIN departments    d  ON d.id  = c.department_id
           WHERE  t.status = 'completed'
             AND ($1::int  IS NULL OR t.store_id   = $1)
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
           GROUP  BY d.department_name
           ORDER  BY 3 DESC
           LIMIT  $4"#,
        filters.store_id,
        df,
        dt,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_category_analytics(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<CategoryAnalytics>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit = filters.limit.unwrap_or(20).clamp(1, 100);

    sqlx::query_as!(
        CategoryAnalytics,
        r#"SELECT
               COALESCE(c.category_name, 'Uncategorized') AS "category_name!",
               COALESCE(SUM(ti.quantity),   0)            AS "qty_sold!",
               COALESCE(SUM(ti.line_total), 0)            AS "revenue!",
               COUNT(DISTINCT t.id)                       AS "transaction_count!"
           FROM   transaction_items ti
           JOIN   transactions t  ON t.id  = ti.tx_id
           JOIN   items         i  ON i.id  = ti.item_id
           LEFT JOIN categories     c  ON c.id  = i.category_id
           WHERE  t.status = 'completed'
             AND ($1::int  IS NULL OR t.store_id   = $1)
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
           GROUP  BY c.category_name
           ORDER  BY 3 DESC
           LIMIT  $4"#,
        filters.store_id,
        df,
        dt,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_item_analytics(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<ItemAnalytics>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit = filters.limit.unwrap_or(20).clamp(1, 100);

    sqlx::query_as!(
        ItemAnalytics,
        r#"SELECT
               ti.item_id,
               ti.item_name                                    AS "item_name!",
               ti.sku                                         AS "sku!",
               COALESCE(SUM(ti.quantity),   0)                AS "qty_sold!",
               COALESCE(SUM(ti.line_total), 0)                AS "revenue!",
               COALESCE(AVG(ti.unit_price), 0)                AS "avg_price!",
               MAX(ist.measurement_type)                      AS "measurement_type: String",
               MAX(ist.unit_type)                             AS "unit_type: String"
           FROM   transaction_items ti
           JOIN   transactions      t   ON t.id = ti.tx_id
           JOIN   items             i   ON i.id = ti.item_id
           LEFT  JOIN item_settings ist ON ist.item_id = i.id
           WHERE  t.status = 'completed'
             AND ($1::int  IS NULL OR t.store_id   = $1)
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
           GROUP  BY ti.item_id, ti.item_name, ti.sku
           ORDER  BY 4 DESC
           LIMIT  $4"#,
        filters.store_id,
        df,
        dt,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. Slow-moving items ──────────────────────────────────────────────────────

/// Returns active, tracked items ranked by lowest sales in the requested period.
/// Items with zero sales appear first (they have no sales record at all).
#[tauri::command]
pub async fn get_slow_moving_items(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<SlowMovingItem>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit = filters.limit.unwrap_or(20).clamp(1, 200);

    let rows = sqlx::query!(
        r#"
        SELECT
            i.id                                                    AS "item_id: uuid::Uuid",
            i.item_name,
            i.sku,
            COALESCE(c.category_name, 'Uncategorized')             AS "category_name!",
            COALESCE(sales.qty_sold,  0)                           AS "qty_sold!: Decimal",
            COALESCE(sales.revenue,   0)                           AS "revenue!:  Decimal",
            sales.last_sold_at                                      AS "last_sold_at: Option<chrono::DateTime<chrono::Utc>>",
            CASE WHEN sales.last_sold_at IS NOT NULL
                 THEN EXTRACT(DAY FROM NOW() - sales.last_sold_at)::bigint
                 ELSE NULL
            END                                                     AS "days_since_last_sale: Option<i64>",
            COALESCE(istock.available_quantity, 0)                 AS "current_stock!: Decimal",
            ist.measurement_type                                   AS "measurement_type: Option<String>",
            ist.unit_type                                          AS "unit_type: String"
        FROM items i
        LEFT JOIN item_settings  ist    ON ist.item_id    = i.id
        LEFT JOIN item_stock     istock ON istock.item_id = i.id AND istock.store_id = i.store_id
        LEFT JOIN categories     c      ON c.id           = i.category_id
        LEFT JOIN (
            SELECT
                ti.item_id,
                SUM(ti.quantity)   AS qty_sold,
                SUM(ti.line_total) AS revenue,
                MAX(t.created_at)  AS last_sold_at
            FROM   transaction_items ti
            JOIN   transactions      t ON t.id = ti.tx_id
                   AND t.status = 'completed'
                   AND ($1::int  IS NULL OR t.store_id   = $1)
                   AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
                   AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
            GROUP  BY ti.item_id
        ) sales ON sales.item_id = i.id
        WHERE ($1::int IS NULL OR i.store_id = $1)
          AND COALESCE(ist.is_active,   TRUE) = TRUE
          AND COALESCE(ist.track_stock, TRUE) = TRUE
        ORDER BY COALESCE(sales.qty_sold, 0) ASC NULLS FIRST,
                 sales.last_sold_at          ASC NULLS FIRST
        LIMIT $4
        "#,
        filters.store_id,
        df,
        dt,
        limit,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| SlowMovingItem {
            item_id: Some(r.item_id),
            item_name: r.item_name,
            sku: r.sku,
            category_name: r.category_name,
            qty_sold: r.qty_sold,
            revenue: r.revenue,
            last_sold_at: r.last_sold_at.flatten(),
            days_since_last_sale: r.days_since_last_sale.flatten(),
            current_stock: r.current_stock,
            measurement_type: r.measurement_type,
            unit_type: r.unit_type,
        })
        .collect())
}

// ── 2. Dead stock ─────────────────────────────────────────────────────────────

/// Returns tracked items with positive available stock but zero completed sales
/// in the past N days (default 30; configure via filters.days = 60 or 90).
#[tauri::command]
pub async fn get_dead_stock(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<DeadStockItem>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let days = filters.days.unwrap_or(30).clamp(1, 365) as i32;
    let limit = filters.limit.unwrap_or(50).clamp(1, 500);

    let rows = sqlx::query!(
        r#"
        SELECT
            i.id                                                AS "item_id!: uuid::Uuid",
            i.item_name                                         AS "item_name!",
            i.sku                                               AS "sku!",
            COALESCE(c.category_name, 'Uncategorized')         AS "category_name!",
            COALESCE(istock.available_quantity, 0)             AS "current_stock!: Decimal",
            i.cost_price                                        AS "cost_price!: Decimal",
            i.selling_price                                     AS "selling_price!: Decimal",
            i.cost_price * COALESCE(istock.available_quantity, 0) AS "stock_value!: Decimal",
            ist.measurement_type                                AS "measurement_type: Option<String>",
            ist.unit_type                                       AS "unit_type: String"
        FROM items i
        JOIN  item_settings  ist    ON ist.item_id    = i.id
              AND ist.track_stock = TRUE
              AND ist.is_active   = TRUE
        JOIN  item_stock     istock ON istock.item_id = i.id
              AND istock.store_id = i.store_id
              AND istock.available_quantity > 0
        LEFT JOIN categories c      ON c.id           = i.category_id
        WHERE ($1::int IS NULL OR i.store_id = $1)
          AND NOT EXISTS (
              SELECT 1
              FROM   transaction_items ti
              JOIN   transactions      t ON t.id = ti.tx_id
                     AND t.status    = 'completed'
                     AND t.created_at >= NOW() - ($2::int * INTERVAL '1 day')
                     AND ($1::int IS NULL OR t.store_id = $1)
              WHERE  ti.item_id = i.id
          )
        ORDER BY i.cost_price * COALESCE(istock.available_quantity, 0) DESC
        LIMIT $3
        "#,
        filters.store_id,
        days,
        limit,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| DeadStockItem {
            item_id: r.item_id,
            item_name: r.item_name,
            sku: r.sku,
            category_name: r.category_name,
            current_stock: r.current_stock,
            cost_price: r.cost_price,
            selling_price: r.selling_price,
            stock_value: r.stock_value,
            measurement_type: r.measurement_type,
            unit_type: r.unit_type,
        })
        .collect())
}

// ── 3. Profit analysis ────────────────────────────────────────────────────────

/// Returns gross profit and margin % grouped by item, category, and department.
/// Uses the item's current cost_price (point-in-time limitation applies).
#[tauri::command]
pub async fn get_profit_analysis(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<ProfitAnalysisReport> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit = filters.limit.unwrap_or(50).clamp(1, 500);

    // — By item —
    let item_rows = sqlx::query!(
        r#"
        SELECT
            ti.item_id                                              AS "item_id: uuid::Uuid",
            ti.item_name                                            AS "item_name!",
            ti.sku                                                  AS "sku!",
            COALESCE(c.category_name, 'Uncategorized')             AS "category_name!",
            COALESCE(SUM(ti.quantity),                  0)         AS "qty_sold!:     Decimal",
            COALESCE(SUM(ti.line_total),                0)         AS "revenue!:      Decimal",
            COALESCE(SUM(ti.quantity * i.cost_price),   0)         AS "cost_of_goods!: Decimal",
            COALESCE(SUM(ti.line_total)
                   - SUM(ti.quantity * i.cost_price),   0)         AS "gross_profit!: Decimal",
            CASE WHEN COALESCE(SUM(ti.line_total), 0) > 0
                 THEN ROUND(
                      (COALESCE(SUM(ti.line_total), 0)
                       - COALESCE(SUM(ti.quantity * i.cost_price), 0))
                      / SUM(ti.line_total) * 100, 2)
                 ELSE 0
            END                                                     AS "margin_percent!: Decimal"
        FROM   transaction_items ti
        JOIN   transactions      t ON t.id  = ti.tx_id
        JOIN   items             i ON i.id  = ti.item_id
        LEFT JOIN categories     c ON c.id  = i.category_id
        WHERE  t.status = 'completed'
          AND ($1::int  IS NULL OR t.store_id   = $1)
          AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
          AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
        GROUP  BY ti.item_id, ti.item_name, ti.sku, c.category_name
        ORDER  BY 8 DESC
        LIMIT  $4
        "#,
        filters.store_id,
        df,
        dt,
        limit,
    )
    .fetch_all(&pool)
    .await?;

    // — By category —
    let cat_rows = sqlx::query!(
        r#"
        SELECT
            COALESCE(c.category_name, 'Uncategorized')             AS "category_name!",
            COALESCE(SUM(ti.quantity),                  0)         AS "qty_sold!:     Decimal",
            COALESCE(SUM(ti.line_total),                0)         AS "revenue!:      Decimal",
            COALESCE(SUM(ti.quantity * i.cost_price),   0)         AS "cost_of_goods!: Decimal",
            COALESCE(SUM(ti.line_total)
                   - SUM(ti.quantity * i.cost_price),   0)         AS "gross_profit!: Decimal",
            CASE WHEN COALESCE(SUM(ti.line_total), 0) > 0
                 THEN ROUND(
                      (COALESCE(SUM(ti.line_total), 0)
                       - COALESCE(SUM(ti.quantity * i.cost_price), 0))
                      / SUM(ti.line_total) * 100, 2)
                 ELSE 0
            END                                                     AS "margin_percent!: Decimal"
        FROM   transaction_items ti
        JOIN   transactions      t ON t.id = ti.tx_id
        JOIN   items             i ON i.id = ti.item_id
        LEFT JOIN categories     c ON c.id = i.category_id
        WHERE  t.status = 'completed'
          AND ($1::int  IS NULL OR t.store_id   = $1)
          AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
          AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
        GROUP  BY c.category_name
        ORDER  BY 5 DESC
        "#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    // — By department —
    let dept_rows = sqlx::query!(
        r#"
        SELECT
            COALESCE(d.department_name, 'Uncategorized')           AS "department_name!",
            COALESCE(SUM(ti.quantity),                  0)         AS "qty_sold!:     Decimal",
            COALESCE(SUM(ti.line_total),                0)         AS "revenue!:      Decimal",
            COALESCE(SUM(ti.quantity * i.cost_price),   0)         AS "cost_of_goods!: Decimal",
            COALESCE(SUM(ti.line_total)
                   - SUM(ti.quantity * i.cost_price),   0)         AS "gross_profit!: Decimal",
            CASE WHEN COALESCE(SUM(ti.line_total), 0) > 0
                 THEN ROUND(
                      (COALESCE(SUM(ti.line_total), 0)
                       - COALESCE(SUM(ti.quantity * i.cost_price), 0))
                      / SUM(ti.line_total) * 100, 2)
                 ELSE 0
            END                                                     AS "margin_percent!: Decimal"
        FROM   transaction_items ti
        JOIN   transactions      t ON t.id = ti.tx_id
        JOIN   items             i ON i.id = ti.item_id
        LEFT JOIN categories     c ON c.id  = i.category_id
        LEFT JOIN departments    d ON d.id  = c.department_id
        WHERE  t.status = 'completed'
          AND ($1::int  IS NULL OR t.store_id   = $1)
          AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
          AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
        GROUP  BY d.department_name
        ORDER  BY 5 DESC
        "#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    Ok(ProfitAnalysisReport {
        by_item: item_rows
            .into_iter()
            .map(|r| ProfitAnalysisItem {
                item_id: Some(r.item_id),
                item_name: r.item_name,
                sku: r.sku,
                category_name: r.category_name,
                qty_sold: r.qty_sold,
                revenue: r.revenue,
                cost_of_goods: r.cost_of_goods,
                gross_profit: r.gross_profit,
                margin_percent: r.margin_percent,
            })
            .collect(),
        by_category: cat_rows
            .into_iter()
            .map(|r| CategoryProfitAnalysis {
                category_name: r.category_name,
                qty_sold: r.qty_sold,
                revenue: r.revenue,
                cost_of_goods: r.cost_of_goods,
                gross_profit: r.gross_profit,
                margin_percent: r.margin_percent,
            })
            .collect(),
        by_department: dept_rows
            .into_iter()
            .map(|r| DepartmentProfitAnalysis {
                department_name: r.department_name,
                qty_sold: r.qty_sold,
                revenue: r.revenue,
                cost_of_goods: r.cost_of_goods,
                gross_profit: r.gross_profit,
                margin_percent: r.margin_percent,
            })
            .collect(),
    })
}

// ── 4. Cashier performance ────────────────────────────────────────────────────

/// Returns sales, voids, refunds, discounts and shift stats per cashier.
/// Only cashiers who have at least one transaction (completed or voided) in the
/// requested period appear in the result.
#[tauri::command]
pub async fn get_cashier_performance(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<CashierPerformance>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    let rows = sqlx::query!(
        r#"
        SELECT
            u.id                                            AS "cashier_id!",
            CONCAT(u.first_name, ' ', u.last_name)         AS cashier_name,
            COALESCE(comp.transaction_count,  0)            AS "transaction_count!:  i64",
            COALESCE(comp.total_sales,        0)            AS "total_sales!:        Decimal",
            COALESCE(comp.avg_tx_value,       0)            AS "avg_transaction_value!: Decimal",
            COALESCE(comp.total_discounts,    0)            AS "total_discounts!:    Decimal",
            COALESCE(voids.void_count,        0)            AS "void_count!:         i64",
            COALESCE(voids.void_amount,       0)            AS "void_amount!:        Decimal",
            COALESCE(refs.refund_count,       0)            AS "refund_count!:       i64",
            COALESCE(refs.refund_amount,      0)            AS "refund_amount!:      Decimal",
            COALESCE(credits.credit_count,    0)            AS "credit_sales_count!: i64",
            COALESCE(credits.credit_amount,   0)            AS "credit_sales_amount!: Decimal",
            COALESCE(sh.shift_count,          0)            AS "shift_count!:        i64",
            COALESCE(sh.avg_cash_diff,        0)            AS "avg_cash_difference!: Decimal"
        FROM users u
        LEFT JOIN (
            SELECT cashier_id,
                   COUNT(*)              AS transaction_count,
                   SUM(total_amount)     AS total_sales,
                   AVG(total_amount)     AS avg_tx_value,
                   SUM(discount_amount)  AS total_discounts
            FROM   transactions
            WHERE  status = 'completed'
              AND ($1::int  IS NULL OR store_id   = $1)
              AND ($2::text IS NULL OR created_at >= $2::timestamptz)
              AND ($3::text IS NULL OR created_at <= $3::timestamptz)
            GROUP  BY cashier_id
        ) comp    ON comp.cashier_id = u.id
        LEFT JOIN (
            SELECT cashier_id,
                   COUNT(*)          AS void_count,
                   SUM(total_amount) AS void_amount
            FROM   transactions
            WHERE  status = 'voided'
              AND ($1::int  IS NULL OR store_id   = $1)
              AND ($2::text IS NULL OR created_at >= $2::timestamptz)
              AND ($3::text IS NULL OR created_at <= $3::timestamptz)
            GROUP  BY cashier_id
        ) voids   ON voids.cashier_id = u.id
        LEFT JOIN (
            SELECT cashier_id,
                   COUNT(*)          AS refund_count,
                   SUM(total_amount) AS refund_amount
            FROM   returns
            WHERE  status != 'voided'
              AND ($1::int  IS NULL OR store_id   = $1)
              AND ($2::text IS NULL OR created_at >= $2::timestamptz)
              AND ($3::text IS NULL OR created_at <= $3::timestamptz)
            GROUP  BY cashier_id
        ) refs    ON refs.cashier_id = u.id
        LEFT JOIN (
            SELECT cashier_id,
                   COUNT(*)          AS credit_count,
                   SUM(total_amount) AS credit_amount
            FROM   transactions
            WHERE  payment_method = 'credit'
              AND  status = 'completed'
              AND ($1::int  IS NULL OR store_id   = $1)
              AND ($2::text IS NULL OR created_at >= $2::timestamptz)
              AND ($3::text IS NULL OR created_at <= $3::timestamptz)
            GROUP  BY cashier_id
        ) credits ON credits.cashier_id = u.id
        LEFT JOIN (
            SELECT opened_by,
                   COUNT(*)                            AS shift_count,
                   AVG(COALESCE(cash_difference, 0))   AS avg_cash_diff
            FROM   shifts
            WHERE  status = 'closed'
              AND ($1::int  IS NULL OR store_id   = $1)
              AND ($2::text IS NULL OR opened_at  >= $2::timestamptz)
              AND ($3::text IS NULL OR opened_at  <= $3::timestamptz)
            GROUP  BY opened_by
        ) sh      ON sh.opened_by = u.id
        WHERE u.is_active = TRUE
          AND (comp.transaction_count IS NOT NULL OR voids.void_count IS NOT NULL)
        ORDER BY COALESCE(comp.total_sales, 0) DESC
        "#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| CashierPerformance {
            cashier_id: r.cashier_id,
            cashier_name: r.cashier_name.unwrap_or_default(),
            transaction_count: r.transaction_count,
            total_sales: r.total_sales,
            avg_transaction_value: r.avg_transaction_value,
            total_discounts: r.total_discounts,
            void_count: r.void_count,
            void_amount: r.void_amount,
            refund_count: r.refund_count,
            refund_amount: r.refund_amount,
            credit_sales_count: r.credit_sales_count,
            credit_sales_amount: r.credit_sales_amount,
            shift_count: r.shift_count,
            avg_cash_difference: r.avg_cash_difference,
        })
        .collect())
}

// ── 5. P&L Summary ───────────────────────────────────────────────────────────

/// Full Profit & Loss: Gross Sales → Discounts → Net Sales → COGS →
/// Gross Profit → Expenses → Net Profit.
#[tauri::command]
pub async fn get_profit_loss_summary(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<ProfitLossSummary> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    // — Transaction-level aggregates —
    let tx_row = sqlx::query!(
        r#"SELECT
               COUNT(*)                          AS transaction_count,
               COALESCE(SUM(total_amount),   0)  AS gross_sales,
               COALESCE(SUM(discount_amount),0)  AS total_discounts,
               COALESCE(SUM(tax_amount),     0)  AS total_tax
           FROM transactions
           WHERE status = 'completed'
             AND ($1::int  IS NULL OR store_id   = $1)
             AND ($2::text IS NULL OR created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR created_at <= $3::timestamptz)"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?;

    // — COGS: sum of (qty_sold × current cost_price) per transaction line —
    let cogs: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(ti.quantity * i.cost_price), 0)
           FROM   transaction_items ti
           JOIN   transactions t ON t.id = ti.tx_id
           JOIN   items        i ON i.id = ti.item_id
           WHERE  t.status = 'completed'
             AND ($1::int  IS NULL OR t.store_id   = $1)
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    // — Approved operating expenses —
    let expenses: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(amount), 0)
           FROM   expenses
           WHERE  approval_status = 'approved'
             AND  deleted_at IS NULL
             AND ($1::int  IS NULL OR store_id      = $1)
             AND ($2::text IS NULL OR expense_date  >= $2::timestamptz)
             AND ($3::text IS NULL OR expense_date  <= $3::timestamptz)"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    let gross_sales = tx_row.gross_sales.unwrap_or_default();
    let total_discounts = tx_row.total_discounts.unwrap_or_default();
    let total_tax = tx_row.total_tax.unwrap_or_default();
    let transaction_count = tx_row.transaction_count.unwrap_or(0);

    // Net sales = gross - discounts (still inclusive of VAT)
    let net_sales = gross_sales - total_discounts;
    let gross_profit = net_sales - cogs;
    let net_profit = gross_profit - expenses;

    let gross_margin_percent = if net_sales > Decimal::ZERO {
        (gross_profit / net_sales * Decimal::from(100)).round_dp(2)
    } else {
        Decimal::ZERO
    };
    let net_margin_percent = if net_sales > Decimal::ZERO {
        (net_profit / net_sales * Decimal::from(100)).round_dp(2)
    } else {
        Decimal::ZERO
    };

    Ok(ProfitLossSummary {
        gross_sales,
        total_discounts,
        net_sales,
        cost_of_goods_sold: cogs,
        gross_profit,
        total_tax_collected: total_tax,
        total_expenses: expenses,
        net_profit,
        gross_margin_percent,
        net_margin_percent,
        transaction_count,
    })
}

// ── 6. Stock velocity ─────────────────────────────────────────────────────────

/// Returns days-of-stock-remaining for every active tracked item,
/// computed from the 30-day average daily sales.
#[tauri::command]
pub async fn get_stock_velocity(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<StockVelocityItem>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let limit = filters.limit.unwrap_or(100).clamp(1, 500);

    let rows = sqlx::query!(
        r#"
        SELECT
            i.id                                            AS "item_id!: uuid::Uuid",
            i.item_name                                     AS "item_name!",
            i.sku                                           AS "sku!",
            COALESCE(c.category_name, 'Uncategorized')     AS "category_name!",
            COALESCE(istock.available_quantity, 0)         AS "current_stock!: Decimal",
            COALESCE(
                velocity.avg_daily_sales, 0
            )                                               AS "avg_daily_sales!: Decimal",
            CASE
                WHEN COALESCE(velocity.avg_daily_sales, 0) > 0
                THEN (
                    COALESCE(istock.available_quantity, 0)
                    / velocity.avg_daily_sales
                )::bigint
                ELSE NULL
            END                                             AS "days_of_stock_remaining: Option<i64>",
            i.cost_price * COALESCE(istock.available_quantity, 0) AS "stock_value_at_cost!: Decimal",
            ist.measurement_type                                  AS "measurement_type: Option<String>",
            ist.unit_type                                         AS "unit_type: String"
        FROM items i
        JOIN  item_settings  ist    ON ist.item_id    = i.id
              AND ist.track_stock = TRUE
              AND ist.is_active   = TRUE
        JOIN  item_stock     istock ON istock.item_id = i.id
              AND istock.store_id = i.store_id
        LEFT JOIN categories c      ON c.id           = i.category_id
        LEFT JOIN (
            SELECT
                ti.item_id,
                SUM(ti.quantity)::numeric / 30   AS avg_daily_sales
            FROM   transaction_items ti
            JOIN   transactions      t ON t.id = ti.tx_id
                   AND t.status    = 'completed'
                   AND t.created_at >= NOW() - INTERVAL '30 days'
                   AND ($1::int IS NULL OR t.store_id = $1)
            GROUP  BY ti.item_id
        ) velocity ON velocity.item_id = i.id
        WHERE ($1::int IS NULL OR i.store_id = $1)
        ORDER BY COALESCE(velocity.avg_daily_sales, 0) DESC NULLS LAST
        LIMIT $2
        "#,
        filters.store_id,
        limit,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let days_rem = r.days_of_stock_remaining.flatten();
            let urgency = match days_rem {
                None => "no_sales".to_string(),
                Some(d) if d <= 7 => "critical".to_string(),
                Some(d) if d <= 14 => "low".to_string(),
                Some(d) if d <= 60 => "adequate".to_string(),
                _ => "overstocked".to_string(),
            };
            StockVelocityItem {
                item_id: r.item_id,
                item_name: r.item_name,
                sku: r.sku,
                category_name: r.category_name,
                current_stock: r.current_stock,
                avg_daily_sales: r.avg_daily_sales,
                days_of_stock_remaining: days_rem,
                stock_value_at_cost: r.stock_value_at_cost,
                reorder_urgency: urgency,
                measurement_type: r.measurement_type,
                unit_type: r.unit_type,
            }
        })
        .collect())
}

// ── 7. Peak hours ─────────────────────────────────────────────────────────────

/// Returns transaction volume and revenue grouped by hour-of-day and
/// day-of-week, sorted by highest revenue. Use this to staff optimally and
/// time restocking runs.
#[tauri::command]
pub async fn get_peak_hours(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<PeakHour>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    let rows = sqlx::query!(
        r#"
        SELECT
            EXTRACT(HOUR FROM created_at)::int          AS "hour_of_day!",
            EXTRACT(DOW  FROM created_at)::int          AS "day_of_week!",
            COUNT(*)                                     AS "transaction_count!: i64",
            COALESCE(SUM(total_amount),  0)             AS "revenue!:  Decimal",
            COALESCE(AVG(total_amount),  0)             AS "avg_basket!: Decimal"
        FROM  transactions
        WHERE status = 'completed'
          AND ($1::int  IS NULL OR store_id   = $1)
          AND ($2::text IS NULL OR created_at >= $2::timestamptz)
          AND ($3::text IS NULL OR created_at <= $3::timestamptz)
        GROUP  BY EXTRACT(HOUR FROM created_at), EXTRACT(DOW FROM created_at)
        ORDER  BY 4 DESC
        "#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| PeakHour {
            hour_of_day: r.hour_of_day,
            day_of_week: r.day_of_week,
            transaction_count: r.transaction_count,
            revenue: r.revenue,
            avg_basket: r.avg_basket,
        })
        .collect())
}

// ── 8. Customer analytics ─────────────────────────────────────────────────────

// ── 8. Customer analytics ─────────────────────────────────────────────────────

/// Returns aggregate customer KPIs plus top customers ranked by lifetime spend.
/// `lapsed_days` (default 60) defines the cutoff between "active" and "lapsed".
#[tauri::command]
pub async fn get_customer_analytics(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<CustomerAnalyticsReport> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit      = filters.limit.unwrap_or(50).clamp(1, 500);
    let lapsed_days = filters.lapsed_days.unwrap_or(60) as i32;

    // — Aggregate KPIs: total / active / lapsed / avg LTV ─────────────────────
    let agg = sqlx::query!(
        r#"
        SELECT
            COUNT(c.id)                                                             AS "total!:   i64",
            COUNT(CASE WHEN tx.last_purchase_date >= NOW() - ($2::int * INTERVAL '1 day')
                       THEN 1 END)                                                  AS "active!:  i64",
            COUNT(CASE WHEN tx.last_purchase_date <  NOW() - ($2::int * INTERVAL '1 day')
                            AND tx.last_purchase_date >= NOW() - INTERVAL '365 days'
                       THEN 1 END)                                                  AS "lapsed!:  i64",
            COALESCE(AVG(NULLIF(tx.total_spent, 0)), 0)                            AS "avg_ltv!: Decimal"
        FROM customers c
        LEFT JOIN (
            SELECT customer_id,
                   SUM(total_amount) AS total_spent,
                   MAX(created_at)   AS last_purchase_date
            FROM   transactions
            WHERE  status      = 'completed'
              AND  customer_id IS NOT NULL
              AND ($1::int IS NULL OR store_id = $1)
            GROUP  BY customer_id
        ) tx ON tx.customer_id = c.id
        WHERE ($1::int IS NULL OR c.store_id = $1)
          AND c.is_active = TRUE
        "#,
        filters.store_id,
        lapsed_days,
    )
    .fetch_one(&pool)
    .await?;

    // — Top N customers by lifetime spend ─────────────────────────────────────
    let rows = sqlx::query!(
        r#"
        SELECT
            c.id                                                    AS "customer_id!",
            CONCAT(c.first_name, ' ', c.last_name)                 AS customer_name,
            c.phone,
            COALESCE(stats.total_spent,       0)                   AS "total_spent!:        Decimal",
            COALESCE(stats.transaction_count, 0)                   AS "transaction_count!:  i64",
            COALESCE(stats.avg_basket_size,   0)                   AS "avg_basket_size!:    Decimal",
            stats.last_purchase_date                                AS "last_purchase_date:  Option<chrono::DateTime<chrono::Utc>>",
            CASE WHEN stats.last_purchase_date IS NOT NULL
                 THEN EXTRACT(DAY FROM NOW() - stats.last_purchase_date)::bigint
                 ELSE NULL
            END                                                     AS "days_since_last_purchase: Option<i64>",
            c.outstanding_balance                                   AS "outstanding_balance: Option<Decimal>"
        FROM customers c
        LEFT JOIN (
            SELECT
                customer_id,
                SUM(total_amount)    AS total_spent,
                COUNT(*)             AS transaction_count,
                AVG(total_amount)    AS avg_basket_size,
                MAX(created_at)      AS last_purchase_date
            FROM   transactions
            WHERE  status      = 'completed'
              AND  customer_id IS NOT NULL
              AND ($1::int  IS NULL OR store_id   = $1)
              AND ($2::text IS NULL OR created_at >= $2::timestamptz)
              AND ($3::text IS NULL OR created_at <= $3::timestamptz)
            GROUP  BY customer_id
        ) stats ON stats.customer_id = c.id
        WHERE ($1::int IS NULL OR c.store_id = $1)
          AND c.is_active = TRUE
          AND stats.transaction_count IS NOT NULL
        ORDER BY COALESCE(stats.total_spent, 0) DESC
        LIMIT $4
        "#,
        filters.store_id, df, dt, limit,
    )
    .fetch_all(&pool)
    .await?;

    Ok(CustomerAnalyticsReport {
        total_customers:     agg.total,
        active_customers:    agg.active,
        lapsed_customers:    agg.lapsed,
        avg_lifetime_value:  agg.avg_ltv.to_string().parse::<f64>().unwrap_or(0.0),
        top_customers: rows
            .into_iter()
            .map(|r| CustomerAnalytics {
                customer_id:              r.customer_id,
                customer_name:            r.customer_name.unwrap_or_default(),
                phone:                    r.phone,
                total_spent:              r.total_spent,
                transaction_count:        r.transaction_count,
                avg_basket_size:          r.avg_basket_size,
                last_purchase_date:       r.last_purchase_date.flatten(),
                days_since_last_purchase: r.days_since_last_purchase.flatten(),
                outstanding_balance:      r.outstanding_balance,
            })
            .collect(),
    })
}

// ── 9. Return analysis ────────────────────────────────────────────────────────

/// Returns a full return analysis: top-returned items (with return rate %)
/// and per-cashier void + refund stats.
#[tauri::command]
pub async fn get_return_analysis(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<ReturnAnalysisReport> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit = filters.limit.unwrap_or(20).clamp(1, 200);

    // — Overall return totals —
    let totals_row = sqlx::query!(
        r#"SELECT
               COUNT(*)          AS total_returns,
               COALESCE(SUM(r.total_amount), 0) AS total_return_value
           FROM returns r
           WHERE r.status != 'voided'
             AND ($1::int  IS NULL OR r.store_id   = $1)
             AND ($2::text IS NULL OR r.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR r.created_at <= $3::timestamptz)"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?;

    let total_sold_qty: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(ti.quantity), 0)
           FROM   transaction_items ti
           JOIN   transactions t ON t.id = ti.tx_id AND t.status = 'completed'
             AND ($1::int  IS NULL OR t.store_id   = $1)
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    let total_returned_qty: Decimal = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(ri.quantity_returned), 0)
           FROM   return_items ri
           JOIN   returns r ON r.id = ri.return_id AND r.status != 'voided'
             AND ($1::int  IS NULL OR r.store_id   = $1)
             AND ($2::text IS NULL OR r.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR r.created_at <= $3::timestamptz)"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    let overall_return_rate = if total_sold_qty > Decimal::ZERO {
        (total_returned_qty / total_sold_qty * Decimal::from(100)).round_dp(2)
    } else {
        Decimal::ZERO
    };

    // — By item —
    let item_rows = sqlx::query!(
        r#"
        SELECT
            ri.item_id                                      AS "item_id: uuid::Uuid",
            ri.item_name                                    AS "item_name!",
            ri.sku                                          AS "sku!",
            COALESCE(sold.qty_sold, 0)                     AS "total_sold!:    Decimal",
            COALESCE(SUM(ri.quantity_returned), 0)         AS "total_returned!: Decimal",
            CASE WHEN COALESCE(sold.qty_sold, 0) > 0
                 THEN ROUND(
                      COALESCE(SUM(ri.quantity_returned), 0)
                      / sold.qty_sold * 100, 2)
                 ELSE 0
            END                                             AS "return_rate_percent!: Decimal",
            COALESCE(SUM(ri.line_total), 0)               AS "return_value!: Decimal"
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
          AND r.status != 'voided'
          AND ($1::int  IS NULL OR r.store_id   = $1)
          AND ($2::text IS NULL OR r.created_at >= $2::timestamptz)
          AND ($3::text IS NULL OR r.created_at <= $3::timestamptz)
        LEFT JOIN (
            SELECT ti.item_id, SUM(ti.quantity) AS qty_sold
            FROM   transaction_items ti
            JOIN   transactions t ON t.id = ti.tx_id AND t.status = 'completed'
                   AND ($1::int  IS NULL OR t.store_id   = $1)
                   AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
                   AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
            GROUP  BY ti.item_id
        ) sold ON sold.item_id = ri.item_id
        GROUP  BY ri.item_id, ri.item_name, ri.sku, sold.qty_sold
        ORDER  BY 6 DESC NULLS LAST
        LIMIT  $4
        "#,
        filters.store_id,
        df,
        dt,
        limit,
    )
    .fetch_all(&pool)
    .await?;

    // — By cashier: voids from transactions + returns from returns table —
    let cashier_rows = sqlx::query!(
        r#"
        SELECT
            u.id                                            AS "cashier_id!",
            CONCAT(u.first_name, ' ', u.last_name)         AS cashier_name,
            COALESCE(v.void_count,   0)                    AS "void_count!:   i64",
            COALESCE(v.void_amount,  0)                    AS "void_amount!:  Decimal",
            COALESCE(rf.refund_count, 0)                   AS "refund_count!: i64",
            COALESCE(rf.refund_amount,0)                   AS "refund_amount!: Decimal",
            COALESCE(v.void_count, 0) + COALESCE(rf.refund_count, 0)  AS "total_return_count!: i64",
            COALESCE(v.void_amount,0) + COALESCE(rf.refund_amount, 0) AS "total_return_value!: Decimal"
        FROM users u
        LEFT JOIN (
            SELECT cashier_id,
                   COUNT(*)          AS void_count,
                   SUM(total_amount) AS void_amount
            FROM   transactions
            WHERE  status = 'voided'
              AND ($1::int  IS NULL OR store_id   = $1)
              AND ($2::text IS NULL OR created_at >= $2::timestamptz)
              AND ($3::text IS NULL OR created_at <= $3::timestamptz)
            GROUP  BY cashier_id
        ) v  ON v.cashier_id = u.id
        LEFT JOIN (
            SELECT cashier_id,
                   COUNT(*)          AS refund_count,
                   SUM(total_amount) AS refund_amount
            FROM   returns
            WHERE  status != 'voided'
              AND ($1::int  IS NULL OR store_id   = $1)
              AND ($2::text IS NULL OR created_at >= $2::timestamptz)
              AND ($3::text IS NULL OR created_at <= $3::timestamptz)
            GROUP  BY cashier_id
        ) rf ON rf.cashier_id = u.id
        WHERE u.is_active = TRUE
          AND (v.void_count IS NOT NULL OR rf.refund_count IS NOT NULL)
        ORDER BY 8 DESC
        "#,
        filters.store_id, df, dt,
    )
    .fetch_all(&pool)
    .await?;

    let total_return_val = totals_row.total_return_value.unwrap_or_default();
    let total_returns    = totals_row.total_returns.unwrap_or(0);

    Ok(ReturnAnalysisReport {
        total_returns,
        total_return_value: total_return_val,
        overall_return_rate,
        summary: ReturnSummary {
            total_return_value: total_return_val,
            return_count:       total_returns,
            return_rate:        overall_return_rate,
            items_returned:     total_returned_qty,
        },
        by_item: item_rows
            .into_iter()
            .map(|r| ReturnAnalysisItem {
                item_id: Some(r.item_id),
                item_name: r.item_name,
                sku: r.sku,
                total_sold: r.total_sold,
                total_returned: r.total_returned,
                return_rate_percent: r.return_rate_percent,
                return_value: r.return_value,
            })
            .collect(),
        by_cashier: cashier_rows
            .into_iter()
            .map(|r| CashierReturnStats {
                cashier_id: r.cashier_id,
                cashier_name: r.cashier_name.unwrap_or_default(),
                void_count: r.void_count,
                void_amount: r.void_amount,
                refund_count: r.refund_count,
                refund_amount: r.refund_amount,
                total_return_count: r.total_return_count,
                total_return_value: r.total_return_value,
            })
            .collect(),
    })
}

// ── 10. Period comparison ─────────────────────────────────────────────────────

/// Compares key metrics between the current period and the previous equivalent
/// period (previous_week / previous_month / previous_year).
/// If `date_from` / `date_to` are set, those define the current period.
/// Otherwise the current calendar period is used automatically.
#[tauri::command]
pub async fn get_comparison_report(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<PeriodComparison> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;

    let now = chrono::Utc::now().date_naive();
    let mode = filters.compare_with.as_deref().unwrap_or("previous_month");

    // Determine (current_from, current_to, prev_from, prev_to, labels)
    let (current_from, current_to, prev_from, prev_to, current_label, previous_label) =
        if let (Some(df), Some(dt)) = (&filters.date_from, &filters.date_to) {
            // User-supplied period: shift backward by the same duration
            let cf = chrono::NaiveDate::parse_from_str(df, "%Y-%m-%d").map_err(|_| {
                AppError::Validation("Invalid date_from format; use YYYY-MM-DD".into())
            })?;
            let ct = chrono::NaiveDate::parse_from_str(dt, "%Y-%m-%d").map_err(|_| {
                AppError::Validation("Invalid date_to format; use YYYY-MM-DD".into())
            })?;
            let duration = ct.signed_duration_since(cf);
            let pf = cf - duration - chrono::Duration::days(1);
            let pt = cf - chrono::Duration::days(1);
            (
                df.clone(),
                dt.clone(),
                pf.format("%Y-%m-%d").to_string(),
                pt.format("%Y-%m-%d").to_string(),
                format!("{} → {}", df, dt),
                format!("{} → {}", pf, pt),
            )
        } else {
            match mode {
                "previous_week" => {
                    let days_from_mon = now.weekday().num_days_from_monday() as i64;
                    let this_mon = now - chrono::Duration::days(days_from_mon);
                    let last_mon = this_mon - chrono::Duration::days(7);
                    let last_sun = this_mon - chrono::Duration::days(1);
                    (
                        this_mon.format("%Y-%m-%d").to_string(),
                        now.format("%Y-%m-%d").to_string(),
                        last_mon.format("%Y-%m-%d").to_string(),
                        last_sun.format("%Y-%m-%d").to_string(),
                        format!("This week ({})", this_mon.format("%d %b")),
                        format!("Last week ({})", last_mon.format("%d %b")),
                    )
                }
                "previous_year" => {
                    let y = now.year();
                    (
                        format!("{}-01-01", y),
                        now.format("%Y-%m-%d").to_string(),
                        format!("{}-01-01", y - 1),
                        format!("{}-12-31", y - 1),
                        format!("Year {}", y),
                        format!("Year {}", y - 1),
                    )
                }
                _ => {
                    // previous_month (default)
                    let this_first = now.with_day(1).expect("day 1 always valid");
                    let last_last = this_first - chrono::Duration::days(1);
                    let last_first = last_last.with_day(1).expect("day 1 always valid");
                    (
                        this_first.format("%Y-%m-%d").to_string(),
                        now.format("%Y-%m-%d").to_string(),
                        last_first.format("%Y-%m-%d").to_string(),
                        last_last.format("%Y-%m-%d").to_string(),
                        now.format("%B %Y").to_string(),
                        last_last.format("%B %Y").to_string(),
                    )
                }
            }
        };

    // Helper: fetch summary row for a date range
    async fn fetch_period(
        pool: &sqlx::PgPool,
        store_id: Option<i32>,
        from: &str,
        to: &str,
    ) -> Result<(Decimal, Decimal, Decimal, i64), AppError> {
        let row = sqlx::query!(
            r#"SELECT
                   COALESCE(SUM(total_amount),   0) AS revenue,
                   COALESCE(SUM(discount_amount),0) AS discounts,
                   COALESCE(SUM(tax_amount),     0) AS tax,
                   COUNT(*)                          AS tx_count
               FROM transactions
               WHERE status = 'completed'
                 AND ($1::int  IS NULL OR store_id   = $1)
                 AND created_at >= $2::text::timestamptz
                 AND created_at <= ($3::text || ' 23:59:59')::timestamptz"#,
            store_id,
            from,
            to,
        )
        .fetch_one(pool)
        .await?;
        Ok((
            row.revenue.unwrap_or_default(),
            row.discounts.unwrap_or_default(),
            row.tax.unwrap_or_default(),
            row.tx_count.unwrap_or(0),
        ))
    }

    let (cur_rev, cur_disc, cur_tax, cur_txn) =
        fetch_period(&pool, filters.store_id, &current_from, &current_to).await?;
    let (prev_rev, prev_disc, prev_tax, prev_txn) =
        fetch_period(&pool, filters.store_id, &prev_from, &prev_to).await?;

    let make_metric = |name: &str, cur: Decimal, prev: Decimal| -> PeriodComparisonMetric {
        let change_amount = cur - prev;
        let change_percent = if prev != Decimal::ZERO {
            (change_amount / prev * Decimal::from(100)).round_dp(2)
        } else if cur > Decimal::ZERO {
            Decimal::from(100)
        } else {
            Decimal::ZERO
        };
        PeriodComparisonMetric {
            metric: name.to_string(),
            current_value: cur,
            previous_value: prev,
            change_amount,
            change_percent,
        }
    };

    let metrics = vec![
        make_metric("gross_sales", cur_rev, prev_rev),
        make_metric("net_sales", cur_rev - cur_disc, prev_rev - prev_disc),
        make_metric("vat_collected", cur_tax, prev_tax),
        make_metric("discounts", cur_disc, prev_disc),
        make_metric(
            "transaction_count",
            Decimal::from(cur_txn),
            Decimal::from(prev_txn),
        ),
    ];

    Ok(PeriodComparison {
        current_label,
        previous_label,
        metrics,
    })
}

// ── 11. Discount analytics ────────────────────────────────────────────────────

/// Returns total discounts given with a per-cashier breakdown.
/// High discount totals per cashier may indicate price abuse.
#[tauri::command]
pub async fn get_discount_analytics(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<DiscountAnalytics> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    // — Summary —
    let summary_row = sqlx::query!(
        r#"SELECT
               COALESCE(SUM(discount_amount), 0)                AS total_discounts_given,
               COUNT(CASE WHEN discount_amount > 0 THEN 1 END)  AS transactions_with_discounts,
               COALESCE(
                   AVG(CASE WHEN discount_amount > 0
                        THEN discount_amount END), 0
               )                                                 AS avg_discount
           FROM transactions
           WHERE status = 'completed'
             AND ($1::int  IS NULL OR store_id   = $1)
             AND ($2::text IS NULL OR created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR created_at <= $3::timestamptz)"#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?;

    // — By cashier —
    let cashier_rows = sqlx::query!(
        r#"
        SELECT
            t.cashier_id                                        AS "cashier_id!",
            CONCAT(u.first_name, ' ', u.last_name)             AS cashier_name,
            COALESCE(SUM(t.discount_amount), 0)                AS "total_discounts!: Decimal",
            COUNT(CASE WHEN t.discount_amount > 0 THEN 1 END)  AS "discount_count!: i64",
            COALESCE(
                AVG(CASE WHEN t.discount_amount > 0
                     THEN t.discount_amount END), 0
            )                                                   AS "avg_discount_amount!: Decimal"
        FROM   transactions t
        JOIN   users u ON u.id = t.cashier_id
        WHERE  t.status = 'completed'
          AND ($1::int  IS NULL OR t.store_id   = $1)
          AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
          AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
        GROUP  BY t.cashier_id, u.first_name, u.last_name
        ORDER  BY 3 DESC
        "#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    // — By item: items that had per-line discounts ─────────────────────────────
    let item_rows = sqlx::query!(
        r#"
        SELECT
            ti.item_id                                                      AS "item_id: uuid::Uuid",
            ti.item_name                                                    AS "item_name!",
            COUNT(DISTINCT t.id)                                            AS "tx_count!:           i64",
            COALESCE(SUM(ti.quantity), 0)                                   AS "qty_sold!:           Decimal",
            COALESCE(SUM(ti.discount), 0)                                   AS "total_discount!:     Decimal",
            COALESCE(AVG(CASE WHEN ti.discount > 0 THEN ti.discount END), 0) AS "avg_discount_amount!: Decimal"
        FROM   transaction_items ti
        JOIN   transactions t ON t.id = ti.tx_id
        WHERE  t.status    = 'completed'
          AND  ti.discount > 0
          AND ($1::int  IS NULL OR t.store_id   = $1)
          AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
          AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
        GROUP  BY ti.item_id, ti.item_name
        ORDER  BY 5 DESC
        LIMIT  20
        "#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    Ok(DiscountAnalytics {
        total_discounts_given:        summary_row.total_discounts_given.unwrap_or_default(),
        transactions_with_discounts:  summary_row.transactions_with_discounts.unwrap_or(0),
        avg_discount_per_transaction: summary_row.avg_discount.unwrap_or_default(),
        by_cashier: cashier_rows
            .into_iter()
            .map(|r| DiscountByCashier {
                cashier_id:          r.cashier_id,
                cashier_name:        r.cashier_name.unwrap_or_default(),
                total_discounts:     r.total_discounts,
                discount_count:      r.discount_count,
                avg_discount_amount: r.avg_discount_amount,
            })
            .collect(),
        by_item: item_rows
            .into_iter()
            .map(|r| DiscountByItem {
                item_id:             Some(r.item_id),
                item_name:           r.item_name,
                tx_count:            r.tx_count,
                qty_sold:            r.qty_sold,
                total_discount:      r.total_discount,
                avg_discount_amount: r.avg_discount_amount,
            })
            .collect(),
    })
}

// ── 12. Payment trends ────────────────────────────────────────────────────────

/// Returns payment-method breakdown over time (period-series).
/// Each row is one (period, payment_method) pair with its share (%) of
/// total revenue in that period.
#[tauri::command]
pub async fn get_payment_trends(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<PaymentTrend>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    let trunc = match filters.period.as_deref().unwrap_or("month") {
        "week" => "week",
        "day" => "day",
        "year" => "year",
        _ => "month",
    };

    let rows = sqlx::query!(
        r#"
        SELECT
            DATE_TRUNC($1, created_at)::text                   AS "period!",
            payment_method                                      AS "payment_method!",
            COUNT(*)                                            AS "count!: i64",
            COALESCE(SUM(total_amount), 0)                     AS "total!: Decimal",
            ROUND(
                COALESCE(SUM(total_amount), 0) * 100.0
                / NULLIF(
                    SUM(SUM(total_amount)) OVER (
                        PARTITION BY DATE_TRUNC($1, created_at)
                    ), 0
                ), 2
            )                                                   AS "percentage!: Decimal"
        FROM  transactions
        WHERE status = 'completed'
          AND ($2::int  IS NULL OR store_id   = $2)
          AND ($3::text IS NULL OR created_at >= $3::timestamptz)
          AND ($4::text IS NULL OR created_at <= $4::timestamptz)
        GROUP  BY DATE_TRUNC($1, created_at), payment_method
        ORDER  BY 1 ASC, 4 DESC
        "#,
        trunc,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| PaymentTrend {
            period: r.period,
            payment_method: r.payment_method,
            count: r.count,
            total: r.total,
            percentage: r.percentage,
        })
        .collect())
}

// ── 13. Supplier analytics ────────────────────────────────────────────────────

/// Returns purchase order statistics per supplier, including average lead time
/// and current outstanding balance owed.
#[tauri::command]
pub async fn get_supplier_analytics(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<SupplierAnalytics>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let limit = filters.limit.unwrap_or(20).clamp(1, 200);

    let rows = sqlx::query!(
        r#"
        SELECT
            s.id                                                AS "supplier_id!",
            s.supplier_name                                     AS "supplier_name!",
            COALESCE(po_stats.total_orders,    0)              AS "total_orders!:      i64",
            COALESCE(po_stats.total_value,     0)              AS "total_order_value!: Decimal",
            COALESCE(po_stats.pending_orders,  0)              AS "pending_orders!:    i64",
            po_stats.avg_lead_time_days                        AS "avg_lead_time_days: Option<Decimal>",
            COALESCE(s.current_balance,        0)              AS "current_balance!:   Decimal"
        FROM suppliers s
        LEFT JOIN (
            SELECT
                supplier_id,
                COUNT(*)                                         AS total_orders,
                SUM(total_amount)                                AS total_value,
                COUNT(CASE WHEN status IN ('pending','approved') THEN 1 END)
                                                                 AS pending_orders,
                AVG(
                    CASE WHEN received_at IS NOT NULL
                         THEN EXTRACT(EPOCH FROM received_at - ordered_at) / 86400.0
                         ELSE NULL END
                )                                                AS avg_lead_time_days
            FROM   purchase_orders
            WHERE ($1::int  IS NULL OR store_id   = $1)
              AND ($2::text IS NULL OR ordered_at >= $2::timestamptz)
              AND ($3::text IS NULL OR ordered_at <= $3::timestamptz)
            GROUP  BY supplier_id
        ) po_stats ON po_stats.supplier_id = s.id
        WHERE ($1::int IS NULL OR s.store_id = $1)
          AND s.is_active = TRUE
        ORDER BY COALESCE(po_stats.total_value, 0) DESC NULLS LAST
        LIMIT $4
        "#,
        filters.store_id, df, dt, limit,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| SupplierAnalytics {
            supplier_id: r.supplier_id,
            supplier_name: r.supplier_name,
            total_orders: r.total_orders,
            total_order_value: r.total_order_value,
            pending_orders: r.pending_orders,
            avg_lead_time_days: r.avg_lead_time_days.flatten(),
            current_balance: r.current_balance,
        })
        .collect())
}

// ── 14. Tax report ────────────────────────────────────────────────────────────

/// Returns a period-series VAT summary ready to hand to an accountant or
/// submit to FIRS. Groups by month by default (set filters.period = "month").
#[tauri::command]
pub async fn get_tax_report(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<TaxReport> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();

    let trunc = match filters.period.as_deref().unwrap_or("month") {
        "week" => "week",
        "day" => "day",
        "year" => "year",
        _ => "month",
    };

    let rows = sqlx::query!(
        r#"
        SELECT
            DATE_TRUNC($1, created_at)::text                   AS "period!",
            COALESCE(SUM(total_amount),              0)        AS "gross_sales!:          Decimal",
            COALESCE(SUM(tax_amount),                0)        AS "vat_collected!:         Decimal",
            COALESCE(SUM(total_amount - tax_amount), 0)        AS "net_sales_before_vat!:  Decimal",
            COUNT(*)                                            AS "transaction_count!: i64"
        FROM  transactions
        WHERE status = 'completed'
          AND ($2::int  IS NULL OR store_id   = $2)
          AND ($3::text IS NULL OR created_at >= $3::timestamptz)
          AND ($4::text IS NULL OR created_at <= $4::timestamptz)
        GROUP  BY DATE_TRUNC($1, created_at)
        ORDER  BY 1 ASC
        "#,
        trunc,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    // — VAT breakdown by tax category ─────────────────────────────────────────
    let cat_rows = sqlx::query!(
        r#"
        SELECT
            COALESCE(tc.name, 'No Tax Category')       AS "category_name!",
            COALESCE(tc.rate,  0)                       AS "rate!:          Decimal",
            COALESCE(SUM(ti.net_amount),  0)            AS "taxable_sales!: Decimal",
            COALESCE(SUM(ti.tax_amount),  0)            AS "vat_amount!:    Decimal"
        FROM transaction_items ti
        JOIN transactions    t  ON t.id  = ti.tx_id
        JOIN items           i  ON i.id  = ti.item_id
        LEFT JOIN tax_categories tc ON tc.id = i.tax_category_id
        WHERE t.status = 'completed'
          AND ($1::int  IS NULL OR t.store_id   = $1)
          AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
          AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
        GROUP BY tc.name, tc.rate
        ORDER BY 4 DESC
        "#,
        filters.store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await?;

    // Compute totals from period rows
    let total_vat:         Decimal = rows.iter().map(|r| r.vat_collected).sum();
    let gross_sales:       Decimal = rows.iter().map(|r| r.gross_sales).sum();
    let net_sales:         Decimal = rows.iter().map(|r| r.net_sales_before_vat).sum();
    let transaction_count: i64     = rows.iter().map(|r| r.transaction_count).sum();

    Ok(TaxReport {
        total_vat,
        gross_sales,
        net_sales,
        transaction_count,
        period_rows: rows
            .into_iter()
            .map(|r| TaxReportRow {
                period:               r.period,
                gross_sales:          r.gross_sales,
                vat_collected:        r.vat_collected,
                net_sales_before_vat: r.net_sales_before_vat,
                transaction_count:    r.transaction_count,
            })
            .collect(),
        vat_by_category: cat_rows
            .into_iter()
            .map(|r| VatByCategoryRow {
                category_name: r.category_name,
                rate:          r.rate,
                taxable_sales: r.taxable_sales,
                vat_amount:    r.vat_amount,
            })
            .collect(),
    })
}

// ── 15. Low-margin items ──────────────────────────────────────────────────────

/// Returns items whose selling margin is below `filters.threshold` percent
/// (default 10 %). Uses the item's current cost_price.
#[tauri::command]
pub async fn get_low_margin_items(
    state: State<'_, AppState>,
    token: String,
    filters: AnalyticsFilters,
) -> AppResult<Vec<LowMarginItem>> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;
    let df = filters.date_from.as_deref();
    let dt = filters.date_to.as_deref();
    let threshold = filters.threshold.unwrap_or(10.0);
    let limit = filters.limit.unwrap_or(50).clamp(1, 500);

    // Convert threshold to Decimal for the comparison
    let threshold_dec = Decimal::try_from(threshold).unwrap_or(Decimal::from(10));

    let rows = sqlx::query!(
        r#"
        SELECT
            i.id                                                AS "item_id: uuid::Uuid",
            i.item_name                                         AS "item_name!",
            i.sku                                               AS "sku!",
            COALESCE(c.category_name, 'Uncategorized')         AS "category_name!",
            i.selling_price                                     AS "selling_price!: Decimal",
            i.cost_price                                        AS "cost_price!:    Decimal",
            CASE WHEN i.selling_price > 0
                 THEN ROUND(
                      (i.selling_price - i.cost_price)
                      / i.selling_price * 100, 2)
                 ELSE 0
            END                                                 AS "margin_percent!: Decimal",
            COALESCE(sales.qty_sold,  0)                       AS "qty_sold!:   Decimal",
            COALESCE(sales.revenue,   0)                       AS "revenue!:    Decimal"
        FROM items i
        LEFT JOIN item_settings  ist ON ist.item_id    = i.id
        LEFT JOIN categories     c   ON c.id           = i.category_id
        LEFT JOIN (
            SELECT ti.item_id,
                   SUM(ti.quantity)   AS qty_sold,
                   SUM(ti.line_total) AS revenue
            FROM   transaction_items ti
            JOIN   transactions      t ON t.id = ti.tx_id AND t.status = 'completed'
                   AND ($1::int  IS NULL OR t.store_id   = $1)
                   AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
                   AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
            GROUP  BY ti.item_id
        ) sales ON sales.item_id = i.id
        WHERE ($1::int IS NULL OR i.store_id = $1)
          AND COALESCE(ist.is_active, TRUE) = TRUE
          AND i.selling_price > 0
          AND CASE WHEN i.selling_price > 0
                   THEN ROUND((i.selling_price - i.cost_price) / i.selling_price * 100, 2)
                   ELSE 0 END < $4
        ORDER BY 7 ASC
        LIMIT $5
        "#,
        filters.store_id,
        df,
        dt,
        threshold_dec,
        limit,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| LowMarginItem {
        item_id: Some(r.item_id),
            item_name: r.item_name,
            sku: r.sku,
            category_name: r.category_name,
            selling_price: r.selling_price,
            cost_price: r.cost_price,
            margin_percent: r.margin_percent,
            qty_sold: r.qty_sold,
            revenue: r.revenue,
        })
        .collect())
}

// ── 16. Business health summary ───────────────────────────────────────────────

/// Single-endpoint aggregate for the analytics landing page.
/// Returns multi-window revenue, inventory health, credit exposure,
/// pending work queues, and top performers — all in one RPC call.
#[tauri::command]
pub async fn get_business_health_summary(
    state: State<'_, AppState>,
    token: String,
    store_id: Option<i32>,
) -> AppResult<BusinessHealthSummary> {
    guard_permission(&state, &token, "analytics.read").await?;
    let pool = state.pool().await?;

    // ── 1. Multi-window revenue (single pass over last 60 days) ──────────────
    let rev = sqlx::query!(
        r#"
        SELECT
            COALESCE(SUM(CASE WHEN created_at::date = CURRENT_DATE
                              THEN total_amount ELSE 0 END), 0)                     AS "today_rev!:      Decimal",
            COUNT(   CASE WHEN created_at::date = CURRENT_DATE
                          THEN 1 END)                                               AS "today_txns!:     i64",
            COALESCE(SUM(CASE WHEN created_at::date = CURRENT_DATE - 1
                              THEN total_amount ELSE 0 END), 0)                     AS "yest_rev!:       Decimal",
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days'
                              THEN total_amount ELSE 0 END), 0)                     AS "week_rev!:       Decimal",
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '14 days'
                               AND created_at <  NOW() - INTERVAL '7 days'
                              THEN total_amount ELSE 0 END), 0)                     AS "prev_week_rev!:  Decimal",
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days'
                              THEN total_amount ELSE 0 END), 0)                     AS "month_rev!:      Decimal",
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '60 days'
                               AND created_at <  NOW() - INTERVAL '30 days'
                              THEN total_amount ELSE 0 END), 0)                     AS "prev_month_rev!: Decimal"
        FROM transactions
        WHERE status = 'completed'
          AND ($1::int IS NULL OR store_id = $1)
          AND created_at >= NOW() - INTERVAL '60 days'
        "#,
        store_id,
    )
    .fetch_one(&pool)
    .await?;

    // ── 2. Gross profit margin for current calendar month ────────────────────
    let margin = sqlx::query!(
        r#"
        SELECT
            COALESCE(SUM(ti.line_total - ti.tax_amount), 0) AS "net_sales!: Decimal",
            COALESCE(SUM(ti.quantity * i.cost_price),    0) AS "cogs!:      Decimal"
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti.tx_id
        JOIN items        i ON i.id = ti.item_id
        WHERE t.status   = 'completed'
          AND ($1::int IS NULL OR t.store_id = $1)
          AND t.created_at >= DATE_TRUNC('month', NOW())
        "#,
        store_id,
    )
    .fetch_one(&pool)
    .await?;

    // ── 3. Stock health ──────────────────────────────────────────────────────
    let stock = sqlx::query!(
        r#"
        SELECT
            COUNT(CASE WHEN istock.available_quantity > 0
                            AND ist.min_stock_level > 0
                            AND istock.available_quantity <= ist.min_stock_level::numeric
                       THEN 1 END)                          AS "low_stock!:     i64",
            COUNT(CASE WHEN istock.available_quantity <= 0  THEN 1 END) AS "out_of_stock!:  i64"
        FROM item_settings ist
        JOIN item_stock    istock ON istock.item_id = ist.item_id
        JOIN items         i      ON i.id           = ist.item_id
        WHERE ist.is_active   = TRUE
          AND ist.track_stock = TRUE
          AND ($1::int IS NULL OR istock.store_id = $1)
          AND ($1::int IS NULL OR i.store_id      = $1)
        "#,
        store_id,
    )
    .fetch_one(&pool)
    .await?;

    // ── 4. Credit health ────────────────────────────────────────────────────
    let credit = sqlx::query!(
        r#"
        SELECT
            COALESCE(SUM(c.outstanding_balance), 0) AS "open_credit_total!: Decimal",
            COUNT(CASE WHEN cs.due_date < NOW() AND cs.status != 'paid' THEN 1 END) AS "overdue_count!: i64"
        FROM customers c
        LEFT JOIN credit_sales cs ON cs.customer_id = c.id
        WHERE c.is_active = TRUE
          AND ($1::int IS NULL OR c.store_id = $1)
        "#,
        store_id,
    )
    .fetch_one(&pool)
    .await?;

    // ── 5. Pending expenses ─────────────────────────────────────────────────
    let pending_expenses: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM expenses
           WHERE approval_status = 'pending'
             AND deleted_at IS NULL
             AND ($1::int IS NULL OR store_id = $1)"#,
        store_id,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    // ── 6. Pending purchase orders ──────────────────────────────────────────
    let pending_pos: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM purchase_orders
           WHERE status IN ('pending', 'approved')
             AND ($1::int IS NULL OR store_id = $1)"#,
        store_id,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    // ── 7. Top item this month ───────────────────────────────────────────────
    let top_item = sqlx::query!(
        r#"
        SELECT ti.item_name                        AS "item_name!",
               COALESCE(SUM(ti.quantity), 0)        AS "qty_sold!: Decimal"
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti.tx_id
        WHERE t.status = 'completed'
          AND t.created_at >= DATE_TRUNC('month', NOW())
          AND ($1::int IS NULL OR t.store_id = $1)
        GROUP BY ti.item_name
        ORDER BY 2 DESC
        LIMIT 1
        "#,
        store_id,
    )
    .fetch_optional(&pool)
    .await?;

    // ── 8. Top cashier this month ────────────────────────────────────────────
    let top_cashier = sqlx::query!(
        r#"
        SELECT CONCAT(u.first_name, ' ', u.last_name)  AS "cashier_name!",
               COALESCE(SUM(t.total_amount), 0)         AS "total_sales!: Decimal"
        FROM transactions t
        JOIN users u ON u.id = t.cashier_id
        WHERE t.status = 'completed'
          AND t.created_at >= DATE_TRUNC('month', NOW())
          AND ($1::int IS NULL OR t.store_id = $1)
        GROUP BY t.cashier_id, u.first_name, u.last_name
        ORDER BY 2 DESC
        LIMIT 1
        "#,
        store_id,
    )
    .fetch_optional(&pool)
    .await?;

    // ── Compute growth % helper ──────────────────────────────────────────────
    let pct = |cur: Decimal, prev: Decimal| -> Decimal {
        if prev == Decimal::ZERO {
            if cur > Decimal::ZERO { Decimal::from(100) } else { Decimal::ZERO }
        } else {
            ((cur - prev) / prev * Decimal::from(100)).round_dp(1)
        }
    };

    let gross_profit_margin = if margin.net_sales > Decimal::ZERO {
        ((margin.net_sales - margin.cogs) / margin.net_sales * Decimal::from(100)).round_dp(1)
    } else {
        Decimal::ZERO
    };

    Ok(BusinessHealthSummary {
        today_revenue:         rev.today_rev,
        today_transactions:    rev.today_txns,
        today_vs_yesterday:    pct(rev.today_rev,   rev.yest_rev),
        week_revenue:          rev.week_rev,
        week_vs_last_week:     pct(rev.week_rev,    rev.prev_week_rev),
        month_revenue:         rev.month_rev,
        month_vs_last_month:   pct(rev.month_rev,   rev.prev_month_rev),
        gross_profit_margin,
        low_stock_count:       stock.low_stock,
        out_of_stock_count:    stock.out_of_stock,
        open_credit_total:     credit.open_credit_total,
        overdue_credit_count:  credit.overdue_count,
        pending_expenses_count: pending_expenses,
        pending_po_count:      pending_pos,
        top_item_name:         top_item.as_ref().map(|r| r.item_name.clone()),
        top_item_qty:          top_item.map(|r| r.qty_sold).unwrap_or_default(),
        top_cashier_name:      top_cashier.as_ref().map(|r| r.cashier_name.clone()),
        top_cashier_sales:     top_cashier.map(|r| r.total_sales).unwrap_or_default(),
    })
}
