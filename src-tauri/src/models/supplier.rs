// ============================================================================
// SUPPLIER MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Supplier {
    pub id:              i32,
    pub store_id:        i32,
    pub supplier_code:   String,
    pub supplier_name:   String,
    pub contact_name:    Option<String>,
    pub email:           Option<String>,
    pub phone:           Option<String>,
    pub address:         Option<String>,
    pub city:            Option<String>,
    pub tax_id:          Option<String>,
    pub payment_terms:   Option<String>,
    pub credit_limit:    Option<Decimal>,
    pub current_balance: Option<Decimal>,
    pub is_active:       bool,
    pub created_at:      DateTime<Utc>,
    pub updated_at:      DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSupplierDto {
    pub store_id:      i32,
    pub supplier_name: String,
    pub contact_name:  Option<String>,
    pub email:         Option<String>,
    pub phone:         Option<String>,
    pub address:       Option<String>,
    pub city:          Option<String>,
    pub tax_id:        Option<String>,
    pub payment_terms: Option<String>,
    pub credit_limit:  Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSupplierDto {
    pub supplier_name: Option<String>,
    pub contact_name:  Option<String>,
    pub email:         Option<String>,
    pub phone:         Option<String>,
    pub address:       Option<String>,
    pub city:          Option<String>,
    pub tax_id:        Option<String>,
    pub payment_terms: Option<String>,
    pub credit_limit:  Option<f64>,
    pub is_active:     Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SupplierFilters {
    pub page:      Option<i64>,
    pub limit:     Option<i64>,
    pub store_id:  Option<i32>,
    pub search:    Option<String>,
    pub is_active: Option<bool>,
}
