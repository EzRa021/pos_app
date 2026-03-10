// ============================================================================
// CUSTOMER WALLET MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WalletTransaction {
    pub id:             i32,
    pub customer_id:    i32,
    pub store_id:       i32,
    pub r#type:         String,
    pub amount:         Decimal,
    pub balance_after:  Decimal,
    pub reference:      Option<String>,
    pub transaction_id: Option<i32>,
    pub recorded_by:    i32,
    pub notes:          Option<String>,
    pub created_at:     DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct WalletBalance {
    pub customer_id:     i32,
    pub customer_name:   String,
    pub balance:         Decimal,
    pub total_deposited: Decimal,
    pub total_spent:     Decimal,
}

#[derive(Debug, Deserialize)]
pub struct DepositDto {
    pub customer_id: i32,
    pub store_id:    i32,
    pub amount:      f64,
    pub reference:   Option<String>,
    pub notes:       Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AdjustWalletDto {
    pub customer_id: i32,
    pub store_id:    i32,
    pub amount:      f64,
    pub notes:       Option<String>,
}
