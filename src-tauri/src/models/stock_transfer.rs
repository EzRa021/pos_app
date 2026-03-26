// ============================================================================
// STOCK TRANSFER MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize)]
pub struct StockTransfer {
    pub id:              i32,
    pub transfer_number: String,
    pub from_store_id:   i32,
    pub from_store_name: Option<String>,
    pub to_store_id:     i32,
    pub to_store_name:   Option<String>,
    pub status:          String,
    pub notes:           Option<String>,
    pub requested_at:    DateTime<Utc>,
    pub sent_at:         Option<DateTime<Utc>>,
    pub received_at:     Option<DateTime<Utc>>,
    pub items:           Vec<TransferItem>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TransferItem {
    pub id:            i32,
    pub transfer_id:   i32,
    pub item_id:       Uuid,
    pub item_name:     Option<String>,
    pub sku:           Option<String>,
    pub qty_requested: Decimal,
    pub qty_sent:      Option<Decimal>,
    pub qty_received:  Option<Decimal>,
    pub unit_type:     Option<String>,
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TransferItemDto {
    pub item_id:       Uuid,
    pub qty_requested: f64,
}

#[derive(Debug, Deserialize)]
pub struct CreateTransferDto {
    pub from_store_id: i32,
    pub to_store_id:   i32,
    pub notes:         Option<String>,
    pub items:         Vec<TransferItemDto>,
}

#[derive(Debug, Deserialize)]
pub struct SendTransferDto {
    pub items: Vec<TransferSendItemDto>,
}

#[derive(Debug, Deserialize)]
pub struct TransferSendItemDto {
    pub item_id:  Uuid,
    pub qty_sent: f64,
}

#[derive(Debug, Deserialize)]
pub struct ReceiveTransferDto {
    pub items: Vec<TransferReceiveItemDto>,
}

#[derive(Debug, Deserialize)]
pub struct TransferReceiveItemDto {
    pub item_id:      Uuid,
    pub qty_received: f64,
}

#[derive(Debug, Deserialize)]
pub struct TransferFilters {
    pub store_id: Option<i32>,
    pub status:   Option<String>,
    pub limit:    Option<i64>,
    pub page:     Option<i64>,
    /// Free-text search: transfer_number, from/to store name
    pub search:   Option<String>,
}
