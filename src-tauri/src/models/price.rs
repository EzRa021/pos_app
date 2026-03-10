// ============================================================================
// PRICE MANAGEMENT MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct PriceList {
    pub id:         i32,
    pub store_id:   i32,
    pub list_name:  String,
    pub list_type:  String,  // standard | wholesale | retail | promotional | custom
    pub description: Option<String>,
    pub is_active:  bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct PriceListItem {
    pub id:             i32,
    pub price_list_id:  i32,
    pub item_id:        Uuid,
    pub item_name:      Option<String>,
    pub sku:            Option<String>,
    pub price:          Decimal,
    pub effective_from: Option<DateTime<Utc>>,
    pub effective_to:   Option<DateTime<Utc>>,
    pub created_at:     DateTime<Utc>,
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct PriceChange {
    pub id:            i32,
    pub store_id:      i32,
    pub item_id:       Uuid,
    pub item_name:     Option<String>,
    pub change_type:   String,  // manual | bulk | scheduled
    pub old_price:     Decimal,
    pub new_price:     Decimal,
    pub effective_at:  DateTime<Utc>,
    pub reason:        Option<String>,
    pub status:        String,  // pending | approved | rejected | applied
    pub requested_by:  i32,
    pub approved_by:   Option<i32>,
    pub created_at:    DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePriceListDto {
    pub store_id:    i32,
    pub list_name:   String,
    pub list_type:   String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddPriceListItemDto {
    pub price_list_id:  i32,
    pub item_id:        Uuid,
    pub price:          f64,
    pub effective_from: Option<String>,
    pub effective_to:   Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RequestPriceChangeDto {
    pub store_id:     i32,
    pub item_id:      Uuid,
    pub new_price:    f64,
    pub change_type:  String,
    pub effective_at: Option<String>,
    pub reason:       Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePriceListDto {
    pub list_name:   Option<String>,
    pub description: Option<String>,
    pub is_active:   Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PriceListFilters {
    pub page:     Option<i64>,
    pub limit:    Option<i64>,
    pub store_id: Option<i32>,
    pub list_type: Option<String>,
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct PriceHistory {
    pub id:         i32,
    pub item_id:    Uuid,
    pub item_name:  Option<String>,
    pub store_id:   i32,
    pub old_price:  Decimal,
    pub new_price:  Decimal,
    pub changed_by: i32,
    pub reason:     Option<String>,
    pub created_at: DateTime<Utc>,
}
