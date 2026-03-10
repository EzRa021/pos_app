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
    pub gross_sales:        Decimal,
    pub total_discounts:    Decimal,
    pub net_sales:          Decimal,
    pub total_tax:          Decimal,
    pub cost_of_goods_sold: Decimal,
    pub gross_profit:       Decimal,
    pub total_expenses:     Decimal,
    pub net_profit:         Decimal,
    pub cash_collected:     Decimal,
    pub card_collected:     Decimal,
    pub transfer_collected: Decimal,
    pub credit_issued:      Decimal,
    pub credit_collected:   Decimal,
    pub items_sold:         Decimal,
    pub transactions_count: i32,
    pub voids_count:        i32,
    pub voids_amount:       Decimal,
    pub refunds_count:      i32,
    pub refunds_amount:     Decimal,
    pub opening_float:      Option<Decimal>,
    pub closing_cash:       Option<Decimal>,
    pub cash_difference:    Option<Decimal>,
    pub generated_by:       Option<i32>,
    pub generated_at:       DateTime<Utc>,
    pub is_locked:          bool,
}

#[derive(Debug, Deserialize)]
pub struct EodHistoryFilters {
    pub store_id:  i32,
    pub date_from: Option<String>,
    pub date_to:   Option<String>,
    pub limit:     Option<i64>,
}
