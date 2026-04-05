// ============================================================================
// CUSTOMER MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Customer {
    pub id:                  i32,
    pub store_id:            i32,
    pub first_name:          String,
    pub last_name:           String,
    pub email:               Option<String>,
    pub phone:               Option<String>,
    pub address:             Option<String>,
    pub city:                Option<String>,
    pub loyalty_points:      Option<i32>,
    pub wallet_balance:      Decimal,
    pub credit_limit:        Option<Decimal>,
    pub outstanding_balance: Option<Decimal>,
    pub customer_type:       Option<String>,
    pub credit_enabled:      Option<bool>,
    pub is_active:           bool,
    pub created_at:          DateTime<Utc>,
    pub updated_at:          DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCustomerDto {
    pub store_id:       i32,
    pub first_name:     String,
    pub last_name:      String,
    pub email:          Option<String>,
    pub phone:          Option<String>,
    pub address:        Option<String>,
    pub city:           Option<String>,
    pub credit_limit:   Option<f64>,
    pub customer_type:  Option<String>,
    pub credit_enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCustomerDto {
    pub first_name:     Option<String>,
    pub last_name:      Option<String>,
    pub email:          Option<String>,
    pub phone:          Option<String>,
    pub address:        Option<String>,
    pub city:           Option<String>,
    pub credit_limit:   Option<f64>,
    pub is_active:      Option<bool>,
    pub customer_type:  Option<String>,
    pub credit_enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CustomerFilters {
    pub page:          Option<i64>,
    pub limit:         Option<i64>,
    pub store_id:      Option<i32>,
    pub search:        Option<String>,
    pub is_active:     Option<bool>,
    pub customer_type: Option<String>,
}
