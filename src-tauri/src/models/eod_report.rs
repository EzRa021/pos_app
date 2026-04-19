// ============================================================================
// END-OF-DAY REPORT MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use chrono::{DateTime, NaiveDate, Utc};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EodReport {
    pub id:                 i32,
    pub store_id:           i32,
    pub report_date:        NaiveDate,
    // ── Revenue ──────────────────────────────────────────────────────────────
    pub gross_sales:        Decimal,
    pub total_discounts:    Decimal,
    pub net_sales:          Decimal,
    pub total_tax:          Decimal,
    // ── Profitability ─────────────────────────────────────────────────────────
    pub cost_of_goods_sold: Decimal,
    pub gross_profit:       Decimal,
    pub total_expenses:     Decimal,
    pub net_profit:         Decimal,
    // ── Payment method totals ─────────────────────────────────────────────────
    pub cash_collected:     Decimal,
    pub card_collected:     Decimal,
    pub transfer_collected: Decimal,
    pub credit_issued:      Decimal,
    pub credit_collected:   Decimal,
    // ── Volume ───────────────────────────────────────────────────────────────
    pub items_sold:         Decimal,
    pub transactions_count: i32,
    pub voids_count:        i32,
    pub voids_amount:       Decimal,
    pub refunds_count:      i32,
    pub refunds_amount:     Decimal,
    // ── Shift cash reconciliation ─────────────────────────────────────────────
    /// Opening float from the first closed shift of the day
    pub opening_float:      Option<Decimal>,
    /// Actual cash counted in the last closed shift of the day
    pub closing_cash:       Option<Decimal>,
    /// Sum of all cash-in movements across all shifts (drawer top-ups)
    pub cash_in:            Decimal,
    /// Sum of all cash-out movements across all shifts (withdrawals / payouts)
    pub cash_out:           Decimal,
    /// Computed variance: closing_cash − (opening_float + cash_collected + cash_in − cash_out)
    pub cash_difference:    Option<Decimal>,
    // ── Meta ─────────────────────────────────────────────────────────────────
    pub generated_by:       Option<i32>,
    pub generated_at:       DateTime<Utc>,
    pub is_locked:          bool,
}

// ── Breakdown sub-structs (live queries, not stored) ─────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EodDeptSummary {
    pub department_name:   String,
    pub transaction_count: i32,
    pub qty_sold:          Decimal,
    pub gross_sales:       Decimal,
    pub net_sales:         Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EodCategorySummary {
    pub category_name:     String,
    pub department_name:   Option<String>,
    pub transaction_count: i32,
    pub qty_sold:          Decimal,
    pub gross_sales:       Decimal,
    pub net_sales:         Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EodItemSummary {
    pub item_name:     String,
    pub sku:           String,
    pub category_name: String,
    pub qty_sold:      Decimal,
    pub gross_sales:   Decimal,
    pub net_sales:     Decimal,
    pub avg_price:     Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EodPaymentSummary {
    pub payment_method: String,
    pub count:          i64,
    pub total:          Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EodHourlySummary {
    pub hour:              i32,
    pub transaction_count: i32,
    pub sales:             Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EodCashierSummary {
    pub cashier_name:      String,
    pub transaction_count: i32,
    pub total_sales:       Decimal,
}

#[derive(Debug, Serialize)]
pub struct EodBreakdown {
    pub departments:     Vec<EodDeptSummary>,
    pub categories:      Vec<EodCategorySummary>,
    pub top_items:       Vec<EodItemSummary>,
    pub payment_methods: Vec<EodPaymentSummary>,
    pub hourly:          Vec<EodHourlySummary>,
    pub cashiers:        Vec<EodCashierSummary>,
}

// ── Filters ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct EodHistoryFilters {
    pub store_id:  i32,
    pub date_from: Option<String>,
    pub date_to:   Option<String>,
    pub limit:     Option<i64>,
}
