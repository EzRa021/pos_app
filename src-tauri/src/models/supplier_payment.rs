// ============================================================================
// SUPPLIER PAYMENT MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SupplierPayment {
    pub id:             i32,
    pub supplier_id:    i32,
    pub supplier_name:  Option<String>,
    pub store_id:       i32,
    pub po_id:          Option<i32>,
    pub po_number:      Option<String>,
    pub amount:         Decimal,
    pub payment_method: String,
    pub reference:      Option<String>,
    pub notes:          Option<String>,
    pub paid_by:        i32,
    pub paid_at:        DateTime<Utc>,
    pub created_at:     DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct SupplierBalance {
    pub supplier_id:     i32,
    pub supplier_name:   String,
    pub current_balance: Decimal,
    pub total_paid:      Decimal,
    pub total_po_value:  Decimal,
}

#[derive(Debug, Deserialize)]
pub struct RecordSupplierPaymentDto {
    pub supplier_id:    i32,
    pub store_id:       i32,
    pub po_id:          Option<i32>,
    pub amount:         f64,
    pub payment_method: Option<String>,
    pub reference:      Option<String>,
    pub notes:          Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SupplierPaymentFilters {
    pub supplier_id: Option<i32>,
    pub store_id:    Option<i32>,
    pub limit:       Option<i64>,
    pub page:        Option<i64>,
}
