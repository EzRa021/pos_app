// ============================================================================
// ANALYTICS MODELS
// ============================================================================

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Existing models (unchanged) ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SalesSummary {
    pub total_transactions: i64,
    pub total_revenue: Decimal,
    pub total_tax: Decimal,
    pub total_discounts: Decimal,
    pub net_revenue: Decimal,
    pub average_order: Decimal,
    /// Total units sold (supports fractional quantities for weight/volume items).
    pub total_items_sold: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RevenueByPeriod {
    pub period: String,
    pub transactions: i64,
    pub revenue: Decimal,
    pub tax: Decimal,
    pub discounts: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TopItem {
    pub item_id: Option<Uuid>,
    pub item_name: String,
    pub sku: String,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
    pub measurement_type: Option<String>,
    pub unit_type: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TopCategory {
    pub category_name: String,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PaymentMethodSummary {
    pub payment_method: String,
    pub count: i64,
    pub total: Decimal,
}

#[derive(Debug, Serialize)]
pub struct DailySummary {
    pub date: String,
    pub transaction_count: i64,
    pub items_sold: Decimal,
    pub gross_sales: Decimal,
    pub total_discounts: Decimal,
    pub net_sales: Decimal,
    pub total_tax: Decimal,
    pub total_expenses: Decimal,
    pub gross_profit: Decimal,
    pub net_profit: Decimal,
    pub cash_sales: Decimal,
    pub card_sales: Decimal,
    pub transfer_sales: Decimal,
    pub credit_sales: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DepartmentAnalytics {
    pub department_name: String,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
    pub transaction_count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CategoryAnalytics {
    pub category_name: String,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
    pub transaction_count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemAnalytics {
    pub item_id: Option<Uuid>,
    pub item_name: String,
    pub sku: String,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
    pub avg_price: Decimal,
    pub measurement_type: Option<String>,
    pub unit_type: Option<String>,
}

// ── Extended AnalyticsFilters (fully backward-compatible) ─────────────────────
// All new fields are Option<T> so every existing caller still works unchanged.

#[derive(Debug, Deserialize)]
pub struct AnalyticsFilters {
    // Existing fields
    pub store_id: Option<i32>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub period: Option<String>, // day | week | month | year
    pub limit: Option<i64>,

    // New fields — used only by the new commands below
    /// asc | desc  (sort direction for item/category lists)
    pub direction: Option<String>,
    /// revenue | qty_sold | margin | count  (what to sort by)
    pub sort_by: Option<String>,
    /// Filter by a specific cashier (for cashier_performance)
    pub cashier_id: Option<i32>,
    /// Filter by a specific customer (for customer_analytics)
    pub customer_id: Option<i32>,
    /// Lookback window in days for dead-stock / velocity (default: 30)
    pub days: Option<i64>,
    /// item | category | department  (grouping for profit analysis)
    pub group_by: Option<String>,
    /// Margin threshold % for get_low_margin_items (default: 10.0)
    pub threshold: Option<f64>,
    /// previous_week | previous_month | previous_year
    pub compare_with: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW MODELS
// ─────────────────────────────────────────────────────────────────────────────

// ── Slow-moving items ─────────────────────────────────────────────────────────

/// Items with the lowest sales in the requested period.
/// Includes items that have never been sold (qty_sold = 0).
#[derive(Debug, Serialize)]
pub struct SlowMovingItem {
    pub item_id: Option<Uuid>,
    pub item_name: String,
    pub sku: String,
    pub category_name: String,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
    pub last_sold_at: Option<DateTime<Utc>>,
    pub days_since_last_sale: Option<i64>,
    pub current_stock: Decimal,
    pub measurement_type: Option<String>,
    pub unit_type: Option<String>,
}

// ── Dead stock ────────────────────────────────────────────────────────────────

/// Items that have positive stock but zero completed sales
/// in the past N days (configurable via `filters.days`, default 30).
#[derive(Debug, Serialize)]
pub struct DeadStockItem {
    pub item_id: Uuid,
    pub item_name: String,
    pub sku: String,
    pub category_name: String,
    pub current_stock: Decimal,
    pub cost_price: Decimal,
    pub selling_price: Decimal,
    /// current_stock × cost_price
    pub stock_value: Decimal,
    pub measurement_type: Option<String>,
    pub unit_type: Option<String>,
}

// ── Profit analysis ───────────────────────────────────────────────────────────

/// Per-item profit: revenue, COGS (cost × qty), gross profit, margin %.
#[derive(Debug, Serialize)]
pub struct ProfitAnalysisItem {
    pub item_id: Option<Uuid>,
    pub item_name: String,
    pub sku: String,
    pub category_name: String,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
    pub cost_of_goods: Decimal,
    pub gross_profit: Decimal,
    pub margin_percent: Decimal,
}

/// Per-category profit aggregation.
#[derive(Debug, Serialize)]
pub struct CategoryProfitAnalysis {
    pub category_name: String,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
    pub cost_of_goods: Decimal,
    pub gross_profit: Decimal,
    pub margin_percent: Decimal,
}

/// Per-department profit aggregation.
#[derive(Debug, Serialize)]
pub struct DepartmentProfitAnalysis {
    pub department_name: String,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
    pub cost_of_goods: Decimal,
    pub gross_profit: Decimal,
    pub margin_percent: Decimal,
}

/// Response for get_profit_analysis — includes all three groupings.
#[derive(Debug, Serialize)]
pub struct ProfitAnalysisReport {
    pub by_item: Vec<ProfitAnalysisItem>,
    pub by_category: Vec<CategoryProfitAnalysis>,
    pub by_department: Vec<DepartmentProfitAnalysis>,
}

// ── Cashier performance ───────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CashierPerformance {
    pub cashier_id: i32,
    pub cashier_name: String,
    /// Completed transactions count
    pub transaction_count: i64,
    pub total_sales: Decimal,
    pub avg_transaction_value: Decimal,
    pub total_discounts: Decimal,
    /// Same-day voided transactions
    pub void_count: i64,
    pub void_amount: Decimal,
    /// Returns/refunds processed by this cashier
    pub refund_count: i64,
    pub refund_amount: Decimal,
    pub credit_sales_count: i64,
    pub credit_sales_amount: Decimal,
    /// Number of closed shifts
    pub shift_count: i64,
    /// Average cash difference on close (negative = short, positive = over)
    pub avg_cash_difference: Decimal,
}

// ── P&L Summary ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ProfitLossSummary {
    pub gross_sales: Decimal,
    pub total_discounts: Decimal,
    pub net_sales: Decimal,
    /// Sum of (item.cost_price × qty_sold) for all transaction_items in period
    pub cost_of_goods_sold: Decimal,
    pub gross_profit: Decimal,
    pub total_tax_collected: Decimal,
    /// Approved expenses in the period
    pub total_expenses: Decimal,
    pub net_profit: Decimal,
    pub gross_margin_percent: Decimal,
    pub net_margin_percent: Decimal,
    pub transaction_count: i64,
}

// ── Stock velocity ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct StockVelocityItem {
    pub item_id: Uuid,
    pub item_name: String,
    pub sku: String,
    pub category_name: String,
    pub current_stock: Decimal,
    /// Average units sold per day over the last 30 days
    pub avg_daily_sales: Decimal,
    /// current_stock / avg_daily_sales — NULL if avg_daily_sales = 0
    pub days_of_stock_remaining: Option<i64>,
    /// current_stock × cost_price
    pub stock_value_at_cost: Decimal,
    /// "critical" (<7 days) | "low" (7–14) | "adequate" (15–60) | "overstocked" (>60)
    pub reorder_urgency: String,
    pub measurement_type: Option<String>,
    pub unit_type: Option<String>,
}

// ── Peak hours ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PeakHour {
    /// 0–23
    pub hour_of_day: i32,
    /// 0 = Sunday … 6 = Saturday (PostgreSQL DOW convention)
    pub day_of_week: i32,
    pub transaction_count: i64,
    pub revenue: Decimal,
    pub avg_basket: Decimal,
}

// ── Customer analytics ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CustomerAnalytics {
    pub customer_id: i32,
    pub customer_name: String,
    pub phone: Option<String>,
    pub total_spent: Decimal,
    pub transaction_count: i64,
    pub avg_basket_size: Decimal,
    pub last_purchase_date: Option<DateTime<Utc>>,
    pub days_since_last_purchase: Option<i64>,
    pub outstanding_balance: Option<Decimal>,
}

// ── Return analysis ───────────────────────────────────────────────────────────

/// Per-item return rate.
#[derive(Debug, Serialize)]
pub struct ReturnAnalysisItem {
    pub item_id: Option<Uuid>,
    pub item_name: String,
    pub sku: String,
    pub total_sold: Decimal,
    pub total_returned: Decimal,
    /// total_returned / total_sold × 100
    pub return_rate_percent: Decimal,
    pub return_value: Decimal,
}

/// Per-cashier return / void stats.
#[derive(Debug, Serialize)]
pub struct CashierReturnStats {
    pub cashier_id: i32,
    pub cashier_name: String,
    pub void_count: i64,
    pub void_amount: Decimal,
    pub refund_count: i64,
    pub refund_amount: Decimal,
    pub total_return_count: i64,
    pub total_return_value: Decimal,
}

#[derive(Debug, Serialize)]
pub struct ReturnAnalysisReport {
    pub total_returns: i64,
    pub total_return_value: Decimal,
    /// total_returned_items / total_sold_items × 100
    pub overall_return_rate: Decimal,
    pub by_item: Vec<ReturnAnalysisItem>,
    pub by_cashier: Vec<CashierReturnStats>,
}

// ── Period comparison ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PeriodComparisonMetric {
    pub metric: String,
    pub current_value: Decimal,
    pub previous_value: Decimal,
    pub change_amount: Decimal,
    /// Positive = growth, negative = decline
    pub change_percent: Decimal,
}

#[derive(Debug, Serialize)]
pub struct PeriodComparison {
    pub current_label: String,
    pub previous_label: String,
    pub metrics: Vec<PeriodComparisonMetric>,
}

// ── Discount analytics ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct DiscountByCashier {
    pub cashier_id: i32,
    pub cashier_name: String,
    pub total_discounts: Decimal,
    pub discount_count: i64,
    pub avg_discount_amount: Decimal,
}

#[derive(Debug, Serialize)]
pub struct DiscountAnalytics {
    pub total_discounts_given: Decimal,
    pub transactions_with_discounts: i64,
    pub avg_discount_per_transaction: Decimal,
    pub by_cashier: Vec<DiscountByCashier>,
}

// ── Payment trends ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PaymentTrend {
    pub period: String,
    pub payment_method: String,
    pub count: i64,
    pub total: Decimal,
    /// Share of this method's total vs all methods in the same period (0–100)
    pub percentage: Decimal,
}

// ── Supplier analytics ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SupplierAnalytics {
    pub supplier_id: i32,
    pub supplier_name: String,
    pub total_orders: i64,
    pub total_order_value: Decimal,
    pub pending_orders: i64,
    /// Average days from ordered_at → received_at (NULL if no received POs)
    pub avg_lead_time_days: Option<Decimal>,
    pub current_balance: Decimal,
}

// ── Tax report ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct TaxReportRow {
    pub period: String,
    pub gross_sales: Decimal,
    pub vat_collected: Decimal,
    pub net_sales_before_vat: Decimal,
    pub transaction_count: i64,
}

// ── Low-margin items ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct LowMarginItem {
    pub item_id: Option<Uuid>,
    pub item_name: String,
    pub sku: String,
    pub category_name: String,
    pub selling_price: Decimal,
    pub cost_price: Decimal,
    pub margin_percent: Decimal,
    pub qty_sold: Decimal,
    pub revenue: Decimal,
}
