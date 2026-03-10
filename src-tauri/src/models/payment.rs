// ============================================================================
// PAYMENT MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Payment {
    pub id:             i32,
    pub transaction_id: i32,
    pub reference_no:   Option<String>,
    pub payment_method: String,
    pub amount:         Decimal,
    pub currency:       Option<String>,
    pub status:         String,
    pub processed_by:   i32,
    pub notes:          Option<String>,
    pub created_at:     DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct PaymentFilters {
    pub page:           Option<i64>,
    pub limit:          Option<i64>,
    pub store_id:       Option<i32>,
    pub payment_method: Option<String>,
    pub date_from:      Option<String>,
    pub date_to:        Option<String>,
}
