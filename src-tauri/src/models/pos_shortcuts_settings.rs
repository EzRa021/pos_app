// ============================================================================
// POS SHORTCUTS MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

/// Full shortcut row joined with item details for the settings UI
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PosShortcutDetail {
    pub id:          i32,
    pub store_id:    i32,
    pub item_id:     uuid::Uuid,
    pub position:    i16,
    pub item_name:   String,
    pub sku:         String,
    pub selling_price: Decimal,
    pub created_at:  DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct AddShortcutDto {
    pub store_id: i32,
    pub item_id:  uuid::Uuid,
    pub position: i16,   // 0-based, 0–11
}

#[derive(Debug, Deserialize)]
pub struct RemoveShortcutDto {
    pub store_id: i32,
    pub item_id:  uuid::Uuid,
}

#[derive(Debug, Deserialize)]
pub struct ReorderShortcutsDto {
    pub store_id: i32,
    /// item_id values in new position order (index = position)
    pub order:    Vec<uuid::Uuid>,
}
