// ============================================================================
// LABEL / BARCODE PRINTING MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;

#[derive(Debug, Serialize)]
pub struct ItemLabel {
    pub item_id:       String,
    pub item_name:     String,
    pub sku:           String,
    pub barcode:       Option<String>,
    pub selling_price: Decimal,
    pub cost_price:    Decimal,
    pub store_name:    String,
    pub category_name: Option<String>,
    pub quantity:      Option<i32>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LabelTemplate {
    pub id:          i32,
    pub store_id:    i32,
    pub name:        String,
    pub format:      String,
    pub show_price:  bool,
    pub show_sku:    bool,
    pub show_name:   bool,
    pub show_store:  bool,
    pub show_expiry: bool,
    pub is_default:  bool,
}

#[derive(Debug, Deserialize)]
pub struct GenerateLabelsDto {
    pub store_id: i32,
    pub item_ids: Vec<String>,
    pub copies:   Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct PrintPriceTagsDto {
    pub store_id:      i32,
    pub category_id:   Option<i32>,
    pub department_id: Option<i32>,
    pub copies:        Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct SaveLabelTemplateDto {
    pub store_id:    i32,
    pub name:        String,
    pub format:      String,
    pub show_price:  bool,
    pub show_sku:    bool,
    pub show_name:   bool,
    pub show_store:  bool,
    pub show_expiry: bool,
    pub is_default:  bool,
}
