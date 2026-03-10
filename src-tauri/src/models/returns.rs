// ============================================================================
// RETURNS & REFUNDS MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Return {
    pub id:               i32,
    pub reference_no:     String,
    pub original_tx_id:   i32,
    pub original_ref_no:  Option<String>,
    pub store_id:         i32,
    pub cashier_id:       i32,
    pub cashier_name:     Option<String>,
    pub customer_id:      Option<i32>,
    pub customer_name:    Option<String>,
    pub return_type:      String,   // full | partial
    pub subtotal:         Decimal,
    pub tax_amount:       Decimal,
    pub total_amount:     Decimal,
    pub refund_method:    String,   // cash | card | original_method | store_credit
    pub refund_reference: Option<String>,
    pub status:           String,   // completed | voided
    pub reason:           Option<String>,
    pub notes:            Option<String>,
    pub created_at:       DateTime<Utc>,
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct ReturnItem {
    pub id:               i32,
    pub return_id:        i32,
    pub item_id:          Uuid,
    pub item_name:        String,
    pub sku:              String,
    pub quantity_returned: Decimal,
    pub unit_price:       Decimal,
    pub line_total:       Decimal,
    pub condition:        String,   // good | damaged | defective
    pub restocked:        bool,
    pub notes:            Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReturnDetail {
    pub ret:   Return,
    pub items: Vec<ReturnItem>,
}

#[derive(Debug, Deserialize)]
pub struct CreateReturnDto {
    pub original_tx_id:  i32,
    pub refund_method:   String,
    pub refund_reference: Option<String>,
    pub reason:          Option<String>,
    pub notes:           Option<String>,
    pub items:           Vec<ReturnItemDto>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ReturnItemDto {
    pub item_id:          Uuid,
    pub quantity_returned: f64,
    pub condition:        String,  // good | damaged | defective
    pub restock:          bool,
    pub notes:            Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReturnFilters {
    pub page:        Option<i64>,
    pub limit:       Option<i64>,
    pub store_id:    Option<i32>,
    pub cashier_id:  Option<i32>,
    pub customer_id: Option<i32>,
    pub status:      Option<String>,
    pub return_type: Option<String>,  // full | partial
    pub date_from:   Option<String>,
    pub date_to:     Option<String>,
}
