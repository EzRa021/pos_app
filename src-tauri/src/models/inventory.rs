// ============================================================================
// INVENTORY MODELS  (aligned with quantum-pos-app inventory.service.js)
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use rust_decimal::Decimal;

// ── Inventory Record ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct InventoryRecord {
    pub item_id:            Uuid,
    pub store_id:           i32,
    pub item_name:          String,
    pub sku:                String,
    pub barcode:            Option<String>,
    pub category_name:      Option<String>,
    pub department_name:    Option<String>,
    pub quantity:           Decimal,
    pub available_quantity: Decimal,
    pub reserved_quantity:  Option<Decimal>,
    pub min_stock_level:    Option<i32>,
    pub max_stock_level:    Option<i32>,
    pub cost_price:         Decimal,
    pub selling_price:      Decimal,
    pub is_active:          Option<bool>,
    pub track_stock:        Option<bool>,
    pub last_count_date:    Option<DateTime<Utc>>,
    pub updated_at:         DateTime<Utc>,
    pub stock_status:       Option<String>,
}

// ── Inventory Item Detail ─────────────────────────────────────────────────────

/// Full inventory record for a single item (used by `get_inventory_item`).
/// Fields from LEFT JOINed tables (item_settings, item_stock) are Option<T>
/// because those rows might not exist yet.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct InventoryItemRecord {
    pub id:                   Uuid,
    pub store_id:             i32,
    pub sku:                  String,
    pub barcode:              Option<String>,
    pub item_name:            String,
    pub description:          Option<String>,
    pub cost_price:           Decimal,
    pub selling_price:        Decimal,
    // LEFT JOIN categories → NOT NULL pk, but INNER join so always present
    pub category_id:          Option<i32>,
    pub category_name:        Option<String>,
    // LEFT JOIN departments
    pub department_id:        Option<i32>,
    pub department_name:      Option<String>,
    // LEFT JOIN item_settings
    pub track_stock:          Option<bool>,
    pub min_stock_level:      Option<i32>,
    pub max_stock_level:      Option<i32>,
    pub allow_negative_stock: Option<bool>,
    // LEFT JOIN item_stock — COALESCE'd but SQLx still reports nullable via LEFT JOIN
    pub quantity:             Option<Decimal>,
    pub reserved_quantity:    Option<Decimal>,
    pub available_quantity:   Option<Decimal>,
    pub last_count_date:      Option<DateTime<Utc>>,
    pub updated_at:           Option<DateTime<Utc>>,
    pub stock_status:         Option<String>,
}

#[derive(Debug, Serialize)]
pub struct InventoryItemDetail {
    #[serde(flatten)]
    pub item:             InventoryItemRecord,
    pub movement_history: Vec<MovementRecord>,
}

// ── Low-Stock Item ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LowStockItem {
    pub item_id:            Uuid,
    pub store_id:           i32,
    pub item_name:          String,
    pub sku:                String,
    pub barcode:            Option<String>,
    pub category_name:      Option<String>,
    pub min_stock_level:    Option<i32>,
    pub quantity:           Decimal,
    pub available_quantity: Decimal,
    pub cost_price:         Decimal,
    pub selling_price:      Decimal,
    pub units_to_reorder:   Option<Decimal>,
}

// ── Movement Record ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MovementRecord {
    pub id:                    i32,
    pub item_id:               Uuid,
    pub item_name:             Option<String>,
    pub sku:                   Option<String>,
    pub event_type:            Option<String>,
    pub event_description:     Option<String>,
    pub quantity_before:       Option<Decimal>,
    pub quantity_after:        Option<Decimal>,
    pub quantity_change:       Option<Decimal>,
    pub reference_type:        Option<String>,
    pub reference_id:          Option<String>,
    pub performed_by:          Option<i32>,
    pub performed_by_username: Option<String>,
    pub performed_at:          DateTime<Utc>,
    pub notes:                 Option<String>,
}

// ── Inventory Summary ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct InventorySummary {
    pub total_items:            i64,
    pub low_stock_count:        i64,
    pub out_of_stock_count:     i64,
    pub total_inventory_value:  Decimal,
    pub avg_stock_level:        Decimal,
    pub min_stock_level_actual: Decimal,
    pub max_stock_level_actual: Decimal,
}

// ── Operation Results ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct RestockResult {
    pub item_id:         Uuid,
    pub store_id:        i32,
    pub item_name:       String,
    pub quantity_before: Decimal,
    pub quantity_after:  Decimal,
    pub quantity_added:  Decimal,
}

#[derive(Debug, Serialize)]
pub struct AdjustInventoryResult {
    pub item_id:           Uuid,
    pub store_id:          i32,
    pub item_name:         String,
    pub adjustment_reason: String,
    pub quantity_before:   Decimal,
    pub quantity_after:    Decimal,
    pub quantity_adjusted: Decimal,
}

#[derive(Debug, Serialize)]
pub struct StockDeductResult {
    pub item_id:         Uuid,
    pub quantity_before: Decimal,
    pub quantity_after:  Decimal,
}

// ── Stock Count Models ────────────────────────────────────────────────────────

/// Full stock-count session row (includes JOIN columns).
/// total_items / items_counted / items_with_variance are Option<i32> so that
/// `query_as!` can accommodate them whether the migration has run or not.
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct StockCount {
    pub id:                    i32,
    pub session_number:        Option<String>,
    pub store_id:              i32,
    pub count_type:            Option<String>,
    pub started_by:            Option<i32>,
    pub completed_by:          Option<i32>,
    pub status:                String,
    pub notes:                 Option<String>,
    pub total_items:           Option<i32>,
    pub items_counted:         Option<i32>,
    pub items_with_variance:   Option<i32>,
    pub total_variance_value:  Option<Decimal>,
    pub started_at:            DateTime<Utc>,
    pub completed_at:          Option<DateTime<Utc>>,
    pub created_at:            DateTime<Utc>,
    // JOINs
    pub started_by_username:   Option<String>,
    pub completed_by_username: Option<String>,
    pub store_name:            Option<String>,
}

/// Individual item inside a stock-count session.
/// store_id is Option<i32> because the column was added via ALTER TABLE
/// without NOT NULL, so PostgreSQL reports it as nullable.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StockCountItem {
    pub id:                  i32,
    pub session_id:          i32,
    pub item_id:             Uuid,
    pub store_id:            Option<i32>,   // nullable: ALTER TABLE ADD COLUMN without NOT NULL
    pub system_quantity:     Decimal,
    pub counted_quantity:    Decimal,
    pub variance_quantity:   Option<Decimal>,
    pub variance_value:      Option<Decimal>,
    pub variance_percentage: Option<Decimal>,
    pub cost_price:          Option<Decimal>,
    pub counted_by:          Option<i32>,
    pub counted_at:          Option<DateTime<Utc>>,
    pub notes:               Option<String>,
    pub is_adjusted:         Option<bool>,
    pub adjustment_id:       Option<i32>,
    // JOINs
    pub item_name:           Option<String>,
    pub sku:                 Option<String>,
    pub barcode:             Option<String>,
    pub category_name:       Option<String>,
}

// ── Variance Report ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct StockCountSession {
    pub id:             i32,
    pub session_number: Option<String>,
    pub status:         String,
    pub started_at:     DateTime<Utc>,
    pub completed_at:   Option<DateTime<Utc>>,
}

/// Summary block inside a VarianceReport.
/// total_items / items_counted / items_with_variance are i32 because they are
/// read from a raw `sqlx::query!()` whose columns are NOT NULL DEFAULT 0.
#[derive(Debug, Serialize)]
pub struct VarianceSummary {
    pub total_items:            i32,     // NOT NULL in DB → i32 from query!()
    pub items_counted:          i32,     // NOT NULL in DB → i32 from query!()
    pub items_with_variance:    i32,     // NOT NULL in DB → i32 from query!()
    pub items_without_variance: i64,
    pub total_variance_value:   Decimal,
    pub overage_count:          i64,
    pub shortage_count:         i64,
    pub overage_value:          Decimal,
    pub shortage_value:         Decimal,
}

#[derive(Debug, Serialize)]
pub struct VarianceReport {
    pub session: StockCountSession,
    pub summary: VarianceSummary,
    pub items:   Vec<StockCountItem>,
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct InventoryFilters {
    pub page:          Option<i64>,
    pub limit:         Option<i64>,
    pub store_id:      Option<i32>,
    pub category_id:   Option<i32>,
    pub department_id: Option<i32>,
    pub low_stock:     Option<bool>,
    pub search:        Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MovementHistoryFilters {
    pub page:         Option<i64>,
    pub limit:        Option<i64>,
    pub item_id:      Option<Uuid>,
    pub event_type:   Option<String>,
    pub performed_by: Option<i32>,
    pub start_date:   Option<DateTime<Utc>>,
    pub end_date:     Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct RestockDto {
    pub item_id:  Uuid,
    pub store_id: i32,
    pub quantity: f64,
    pub note:     Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AdjustInventoryDto {
    pub item_id:             Uuid,
    pub store_id:            i32,
    pub adjustment_quantity: f64,
    pub reason:              String,
    pub notes:               Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StartCountSessionDto {
    pub count_type: Option<String>,
    pub notes:      Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RecordCountDto {
    pub item_id:          Uuid,
    pub counted_quantity: f64,
    pub notes:            Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CountSessionFilters {
    pub page:       Option<i64>,
    pub limit:      Option<i64>,
    pub store_id:   Option<i32>,
    pub status:     Option<String>,
    pub count_type: Option<String>,
}
