// ============================================================================
// BULK OPERATIONS MODELS
// ============================================================================
#![allow(dead_code)]

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

// ── Bulk label printing ───────────────────────────────────────────────────────
// Unified scope: explicit item_ids OR category/department scope.
// When item_ids is supplied the other two fields are ignored.

#[derive(Debug, Deserialize)]
pub struct BulkPrintLabelsDto {
    pub store_id:      i32,
    /// Explicit item UUIDs (multi-select flow). When present, category_id /
    /// department_id are ignored and the active-status filter is NOT applied
    /// (the user already chose these items deliberately).
    pub item_ids:      Option<Vec<String>>,
    /// Scope: every active item in this category.
    pub category_id:   Option<i32>,
    /// Scope: every active item in this department.
    pub department_id: Option<i32>,
    pub copies:        Option<i32>,
}
