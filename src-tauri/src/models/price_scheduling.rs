// ============================================================================
// PRICE SCHEDULING MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ScheduledPriceChange {
    pub id:                i32,
    pub item_id:           Uuid,
    pub item_name:         Option<String>,
    pub store_id:          i32,
    pub new_selling_price: Decimal,
    pub new_cost_price:    Option<Decimal>,
    pub change_reason:     Option<String>,
    pub effective_at:      DateTime<Utc>,
    pub created_by:        i32,
    pub applied:           bool,
    pub applied_at:        Option<DateTime<Utc>>,
    pub cancelled:         bool,
    pub created_at:        DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemPriceHistoryRow {
    pub id:         i32,
    pub item_id:    Uuid,
    pub item_name:  Option<String>,
    pub store_id:   i32,
    pub old_price:  Option<Decimal>,
    pub new_price:  Decimal,
    pub changed_by: Option<i32>,
    pub reason:     Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SchedulePriceChangeDto {
    pub item_id:           String,
    pub store_id:          i32,
    pub new_selling_price: f64,
    pub new_cost_price:    Option<f64>,
    pub change_reason:     Option<String>,
    pub effective_at:      String,
}
