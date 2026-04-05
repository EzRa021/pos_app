// ============================================================================
// STORE MODELS — matches migration 0002_stores.sql + 0057 + 0065
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Store {
    pub id:             i32,
    pub store_name:     String,
    pub address:        Option<String>,
    pub city:           Option<String>,
    pub state:          Option<String>,
    pub country:        String,
    pub phone:          Option<String>,
    pub email:          Option<String>,
    pub currency:       String,
    pub timezone:       String,
    pub tax_rate:       Decimal,
    pub receipt_footer: Option<String>,
    pub logo_data:      Option<String>,
    pub is_active:      bool,
    pub theme:          String,
    pub accent_color:   String,
    pub created_at:     DateTime<Utc>,
    pub updated_at:     DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateStoreDto {
    pub store_name:     String,
    pub address:        Option<String>,
    pub city:           Option<String>,
    pub state:          Option<String>,
    pub country:        Option<String>,
    pub phone:          Option<String>,
    pub email:          Option<String>,
    pub currency:       Option<String>,
    pub timezone:       Option<String>,
    pub tax_rate:       Option<f64>,
    pub receipt_footer: Option<String>,
    pub logo_data:      Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStoreDto {
    pub store_name:     Option<String>,
    pub address:        Option<String>,
    pub city:           Option<String>,
    pub state:          Option<String>,
    pub country:        Option<String>,
    pub phone:          Option<String>,
    pub email:          Option<String>,
    pub currency:       Option<String>,
    pub timezone:       Option<String>,
    pub tax_rate:       Option<f64>,
    pub receipt_footer: Option<String>,
    pub logo_data:      Option<String>,
    pub is_active:      Option<bool>,
    pub theme:          Option<String>,
    pub accent_color:   Option<String>,
}
