// ============================================================================
// POS FAVOURITES MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use uuid::Uuid;
use chrono::{DateTime, Utc};

/// Full item row returned when fetching a store's favourites list.
/// Shape mirrors the Item struct so the frontend `handleAddToCart` function
/// can use it without any remapping.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PosFavouriteItem {
    pub id:                     Uuid,            // items.id
    pub store_id:               i32,
    pub sku:                    String,
    pub barcode:                Option<String>,
    pub item_name:              String,
    pub selling_price:          Decimal,
    pub discount_price:         Option<Decimal>,
    pub discount_price_enabled: bool,
    // item_settings
    pub taxable:                Option<bool>,
    pub measurement_type:       Option<String>,
    pub unit_type:              Option<String>,
    pub requires_weight:        Option<bool>,
    pub min_increment:          Option<Decimal>,
    pub default_qty:            Option<Decimal>,
    pub track_stock:            Option<bool>,
    pub min_stock_level:        Option<i32>,
    // item_stock
    pub available_quantity:     Option<Decimal>,
    // joins
    pub category_name:          Option<String>,
    pub image_data:             Option<String>,
    // favourite metadata
    pub fav_created_at:         DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct AddFavouriteDto {
    pub store_id: i32,
    pub item_id:  Uuid,
}

#[derive(Debug, Deserialize)]
pub struct RemoveFavouriteDto {
    pub store_id: i32,
    pub item_id:  Uuid,
}
