// ============================================================================
// BULK OPERATIONS MODELS
// ============================================================================

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct BulkPriceUpdateDto {
    pub store_id:      i32,
    pub category_id:   Option<i32>,
    pub department_id: Option<i32>,
    /// "percentage" | "fixed_increase" | "fixed_decrease" | "set_absolute"
    pub method:        String,
    pub value:         f64,
    pub round_to:      Option<f64>,
    pub update_cost:   Option<bool>,
    pub reason:        Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BulkStockItem {
    pub item_id:    String,
    pub adjustment: f64,
    pub reason:     Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BulkStockAdjustmentDto {
    pub store_id: i32,
    pub items:    Vec<BulkStockItem>,
}

#[derive(Debug, Deserialize)]
pub struct BulkToggleItemsDto {
    pub store_id:      i32,
    pub category_id:   Option<i32>,
    pub department_id: Option<i32>,
    pub item_ids:      Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct BulkApplyDiscountDto {
    pub store_id:      i32,
    pub category_id:   Option<i32>,
    pub department_id: Option<i32>,
    pub percent:       f64,
}

#[derive(Debug, Serialize)]
pub struct BulkOperationResult {
    pub affected: u64,
    pub message:  String,
}

// ── Bulk item import ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BulkItemRow {
    pub item_name:     String,
    pub sku:           Option<String>,
    pub barcode:       Option<String>,
    pub cost_price:    f64,
    pub selling_price: f64,
    pub category_id:   Option<i32>,
    pub department_id: Option<i32>,
    pub unit:          Option<String>,
    pub min_stock_level: Option<i32>,
    pub track_stock:   Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct BulkItemImportDto {
    pub store_id: i32,
    pub items:    Vec<BulkItemRow>,
}

#[derive(Debug, Serialize)]
pub struct BulkImportResult {
    pub created:  u64,
    pub updated:  u64,
    pub failed:   u64,
    pub errors:   Vec<String>,
}
