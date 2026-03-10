// ============================================================================
// TAX MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct TaxCategory {
    pub id:           i32,
    pub name:         String,
    pub code:         String,
    pub rate:         Decimal,   // e.g. 7.5 for 7.5%
    pub is_inclusive: bool,      // true = tax included in price
    pub description:  Option<String>,
    pub is_active:    bool,
    pub created_at:   DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTaxCategoryDto {
    pub name:         String,
    pub code:         String,
    pub rate:         f64,
    pub is_inclusive: bool,
    pub description:  Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaxCategoryDto {
    pub name:         Option<String>,
    pub rate:         Option<f64>,
    pub is_inclusive: Option<bool>,
    pub description:  Option<String>,
    pub is_active:    Option<bool>,
}
