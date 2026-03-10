// ============================================================================
// CREDIT SALE MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct CreditSale {
    pub id:              i32,
    pub transaction_id:  i32,
    pub reference_no:    Option<String>,
    pub store_id:        i32,
    pub customer_id:     i32,
    pub customer_name:   Option<String>,
    pub total_amount:    Decimal,
    pub amount_paid:     Decimal,
    pub outstanding:     Decimal,
    pub due_date:        Option<DateTime<Utc>>,
    pub status:          String,
    pub notes:           Option<String>,
    pub created_at:      DateTime<Utc>,
    pub updated_at:      DateTime<Utc>,
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct CreditPayment {
    pub id:            i32,
    pub credit_sale_id: i32,
    pub amount:        Decimal,
    pub payment_method: String,
    pub reference:     Option<String>,
    pub paid_by:       i32,
    pub notes:         Option<String>,
    pub created_at:    DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct RecordCreditPaymentDto {
    pub credit_sale_id:  i32,
    pub amount:          f64,
    pub payment_method:  String,
    pub reference:       Option<String>,
    pub notes:           Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreditSaleFilters {
    pub page:        Option<i64>,
    pub limit:       Option<i64>,
    pub store_id:    Option<i32>,
    pub customer_id: Option<i32>,
    pub status:      Option<String>,
    pub date_from:   Option<String>,
    pub date_to:     Option<String>,
}
