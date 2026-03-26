// ============================================================================
// PURCHASE ORDER MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct PurchaseOrder {
    pub id:            i32,
    pub po_number:     String,
    pub store_id:      i32,
    pub supplier_id:   i32,
    pub supplier_name: Option<String>,
    pub status:        String,
    pub subtotal:      Option<Decimal>,
    pub tax_amount:    Option<Decimal>,
    pub shipping_cost: Option<Decimal>,
    pub total_amount:  Decimal,
    pub notes:         Option<String>,
    pub ordered_by:    i32,
    pub approved_by:   Option<i32>,
    pub ordered_at:    DateTime<Utc>,
    pub received_at:   Option<DateTime<Utc>>,
    pub created_at:    DateTime<Utc>,
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct PurchaseOrderItem {
    pub id:               i32,
    pub po_id:            i32,
    pub item_id:          Uuid,
    pub item_name:        String,
    pub sku:              String,
    pub quantity_ordered:  Decimal,
    pub quantity_received: Option<Decimal>,
    pub unit_cost:        Decimal,
    pub line_total:       Decimal,
    pub unit_type:        Option<String>,
    pub measurement_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePurchaseOrderDto {
    pub store_id:    i32,
    pub supplier_id: i32,
    pub notes:       Option<String>,
    pub items:       Vec<PurchaseOrderItemDto>,
}

#[derive(Debug, Deserialize)]
pub struct PurchaseOrderItemDto {
    pub item_id:   Uuid,
    pub quantity:  f64,
    pub unit_cost: f64,
}

#[derive(Debug, Deserialize)]
pub struct ReceivePurchaseOrderDto {
    pub items: Vec<ReceiveItemDto>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReceiveItemDto {
    pub po_item_id:        i32,
    pub quantity_received: f64,
}

#[derive(Debug, Deserialize)]
pub struct PurchaseOrderFilters {
    pub page:        Option<i64>,
    pub limit:       Option<i64>,
    pub store_id:    Option<i32>,
    pub supplier_id: Option<i32>,
    pub status:      Option<String>,
    pub date_from:   Option<String>,
    pub date_to:     Option<String>,
    /// Free-text search: po_number, supplier_name, notes
    pub search:      Option<String>,
}
