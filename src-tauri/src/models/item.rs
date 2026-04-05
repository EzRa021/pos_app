// ============================================================================
// ITEM MODELS  (aligned with quantum-pos-app item.service.js)
// ============================================================================
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use rust_decimal::Decimal;

/// Full item row returned from queries.
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Item {
    pub id:             Uuid,
    pub store_id:       i32,
    pub category_id:    Option<i32>,
    pub department_id:  Option<i32>,
    pub sku:            String,
    pub barcode:        Option<String>,
    pub item_name:      String,
    pub description:    Option<String>,
    pub cost_price:             Decimal,
    pub selling_price:          Decimal,
    pub discount_price:         Option<Decimal>,
    pub discount_price_enabled: bool,
    pub created_at:     DateTime<Utc>,
    pub updated_at:     DateTime<Utc>,
    // JOINs
    pub branch_name:     Option<String>,
    pub category_name:   Option<String>,
    pub department_name: Option<String>,
    // item_settings
    pub is_active:             Option<bool>,
    pub sellable:              Option<bool>,
    pub available_for_pos:     Option<bool>,
    pub track_stock:           Option<bool>,
    pub taxable:               Option<bool>,
    pub allow_discount:        Option<bool>,
    pub max_discount_percent:  Option<Decimal>,
    /// How the item quantity is measured:
    /// 'quantity' = pieces/packs (default)
    /// 'weight'   = kg / g / lb / oz
    /// 'volume'   = litre / ml / cl
    /// 'length'   = m / cm / mm
    pub measurement_type:      Option<String>,
    pub unit_type:             Option<String>,
    pub unit_value:            Option<Decimal>,
    pub requires_weight:       Option<bool>,
    pub allow_negative_stock:  Option<bool>,
    pub min_stock_level:       Option<i32>,
    pub max_stock_level:       Option<i32>,
    pub min_increment:         Option<Decimal>,
    pub default_qty:           Option<Decimal>,
    pub archived_at:           Option<DateTime<Utc>>,
    // item_stock
    pub quantity:              Option<Decimal>,
    pub available_quantity:    Option<Decimal>,
    pub reserved_quantity:     Option<Decimal>,
    /// Base64 data URL of the item image — None if no image has been set.
    pub image_data:            Option<String>,
}

/// Filters for `get_items`
#[derive(Debug, Deserialize)]
pub struct ItemFilters {
    pub page:              Option<i64>,
    pub limit:             Option<i64>,
    pub store_id:          Option<i32>,
    pub category_id:       Option<i32>,
    pub department_id:     Option<i32>,
    pub is_active:         Option<bool>,
    pub available_for_pos: Option<bool>,
    pub low_stock:         Option<bool>,
    pub search:            Option<String>,
    /// Optional filter: only items of this measurement type
    pub measurement_type:  Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateItemDto {
    pub store_id:          i32,
    pub category_id:       i32,
    pub department_id:     Option<i32>,
    pub sku:               String,
    pub barcode:           Option<String>,
    pub item_name:         String,
    pub description:       Option<String>,
    pub cost_price:        f64,
    pub selling_price:     f64,
    pub discount_price:         Option<f64>,
    pub discount_price_enabled: Option<bool>,
    // settings
    pub is_active:             Option<bool>,
    pub sellable:              Option<bool>,
    pub available_for_pos:     Option<bool>,
    pub track_stock:           Option<bool>,
    pub taxable:               Option<bool>,
    pub allow_discount:        Option<bool>,
    pub max_discount_percent:  Option<f64>,
    /// Measurement type: 'quantity' | 'weight' | 'volume' | 'length'
    pub measurement_type:      Option<String>,
    pub unit_type:             Option<String>,
    pub unit_value:            Option<f64>,
    pub requires_weight:       Option<bool>,
    pub allow_negative_stock:  Option<bool>,
    pub min_stock_level:       Option<i32>,
    pub max_stock_level:       Option<i32>,
    /// Minimum quantity step — None means use system default for measurement_type.
    pub min_increment:         Option<f64>,
    /// Default quantity pre-filled in POS / inventory dialogs.
    pub default_qty:           Option<f64>,
    // initial stock
    pub initial_quantity:      Option<f64>,
    /// Optional base64 data URL (e.g. "data:image/jpeg;base64,...").
    /// Sent by the frontend after client-side resize/compression.
    pub image_data:            Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateItemDto {
    pub category_id:          Option<i32>,
    pub department_id:        Option<i32>,
    pub sku:                  Option<String>,
    pub barcode:              Option<String>,
    pub item_name:            Option<String>,
    pub description:          Option<String>,
    pub cost_price:           Option<f64>,
    pub selling_price:        Option<f64>,
    pub discount_price:         Option<f64>,
    pub discount_price_enabled: Option<bool>,
    // settings
    pub is_active:             Option<bool>,
    pub sellable:              Option<bool>,
    pub available_for_pos:     Option<bool>,
    pub track_stock:           Option<bool>,
    pub taxable:               Option<bool>,
    pub allow_discount:        Option<bool>,
    pub max_discount_percent:  Option<f64>,
    /// Measurement type: 'quantity' | 'weight' | 'volume' | 'length'
    pub measurement_type:      Option<String>,
    pub unit_type:             Option<String>,
    pub unit_value:            Option<f64>,
    pub requires_weight:       Option<bool>,
    pub allow_negative_stock:  Option<bool>,
    pub min_stock_level:       Option<i32>,
    pub max_stock_level:       Option<i32>,
    pub min_increment:         Option<f64>,
    pub default_qty:           Option<f64>,
    /// Set to Some(data) to update image; None leaves existing image unchanged.
    pub image_data:            Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AdjustStockDto {
    pub item_id:         Uuid,
    pub store_id:        i32,
    pub adjustment_type: Option<String>,  // ADJUSTMENT | RESTOCK | DAMAGE | etc.
    pub adjustment:      f64,             // quantity change (can be negative)
    pub reason:          Option<String>,
    pub notes:           Option<String>,
}

/// Lightweight search result (for POS barcode / autocomplete).
/// Includes measurement_type and unit_type so the POS can render the
/// correct quantity input (integer for pieces, decimal for weight/volume).
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemSearchResult {
    pub id:                     Uuid,
    pub sku:                    String,
    pub barcode:                Option<String>,
    pub item_name:              String,
    pub description:            Option<String>,
    pub selling_price:          Decimal,
    pub discount_price:         Option<Decimal>,
    pub discount_price_enabled: bool,
    pub is_active:          Option<bool>,
    pub available_for_pos:  Option<bool>,
    pub quantity:           Option<Decimal>,
    pub available_quantity: Option<Decimal>,
    pub category_name:      Option<String>,
    pub measurement_type:   Option<String>,
    pub unit_type:          Option<String>,
    pub min_increment:      Option<Decimal>,
    pub default_qty:        Option<Decimal>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemHistory {
    pub id:                 i32,
    pub item_id:            Uuid,
    pub store_id:           i32,
    // column names match quantum-pos-app item_history table
    pub event_type:         Option<String>,
    pub event_description:  Option<String>,
    pub quantity_before:    Option<Decimal>,
    pub quantity_after:     Option<Decimal>,
    pub quantity_change:    Option<Decimal>,
    pub price_before:       Option<Decimal>,
    pub price_after:        Option<Decimal>,
    pub reference_type:     Option<String>,
    pub reference_id:       Option<String>,
    pub performed_by:       Option<i32>,
    pub performed_at:       DateTime<Utc>,
    pub notes:              Option<String>,
    // joined
    pub user_name:          Option<String>,
    pub item_name:          Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ItemCountResult {
    pub count: i64,
}
