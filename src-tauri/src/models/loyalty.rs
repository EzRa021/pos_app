// ============================================================================
// LOYALTY MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LoyaltySettings {
    pub store_id:                   i32,
    pub points_per_naira:           Decimal,
    pub naira_per_point_redemption: Decimal,
    pub min_redemption_points:      i32,
    pub expiry_days:                i32,
    pub is_active:                  bool,
    pub created_at:                 DateTime<Utc>,
    pub updated_at:                 DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LoyaltyTransaction {
    pub id:             i32,
    pub customer_id:    i32,
    pub store_id:       i32,
    pub transaction_id: Option<i32>,
    pub r#type:         String,
    pub points:         i32,
    pub balance_after:  i32,
    pub notes:          Option<String>,
    pub created_by:     Option<i32>,
    pub created_at:     DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct LoyaltyBalance {
    pub customer_id: i32,
    pub points:      i32,
    pub naira_value: Decimal,
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UpdateLoyaltySettingsDto {
    pub store_id:                   i32,
    pub points_per_naira:           Option<f64>,
    pub naira_per_point_redemption: Option<f64>,
    pub min_redemption_points:      Option<i32>,
    pub expiry_days:                Option<i32>,
    pub is_active:                  Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct EarnPointsDto {
    pub customer_id:    i32,
    pub store_id:       i32,
    pub transaction_id: Option<i32>,
    pub sale_amount:    f64,
}

#[derive(Debug, Deserialize)]
pub struct RedeemPointsDto {
    pub customer_id:    i32,
    pub store_id:       i32,
    pub transaction_id: Option<i32>,
    pub points:         i32,
}

#[derive(Debug, Deserialize)]
pub struct AdjustPointsDto {
    pub customer_id: i32,
    pub store_id:    i32,
    pub points:      i32,
    pub notes:       Option<String>,
}
