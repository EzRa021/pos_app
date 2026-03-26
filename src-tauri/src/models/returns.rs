// ============================================================================
// RETURNS & REFUNDS MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use rust_decimal::Decimal;

// ── Core domain structs ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Return {
    pub id:               i32,
    pub reference_no:     String,
    pub original_tx_id:   i32,
    pub original_ref_no:  Option<String>,
    pub store_id:         i32,
    pub cashier_id:       i32,
    pub cashier_name:     Option<String>,
    pub customer_id:      Option<i32>,
    pub customer_name:    Option<String>,
    /// "full" | "partial"
    pub return_type:      String,
    pub subtotal:         Decimal,
    pub tax_amount:       Decimal,
    pub total_amount:     Decimal,
    /// "cash" | "card" | "transfer" | "original_method" | "store_credit"
    pub refund_method:    String,
    pub refund_reference: Option<String>,
    /// "completed" | "voided"
    pub status:           String,
    pub reason:           Option<String>,
    pub notes:            Option<String>,
    pub created_at:       DateTime<Utc>,
    // Void audit trail
    pub voided_at:        Option<DateTime<Utc>>,
    pub voided_by:        Option<i32>,
    pub void_reason:      Option<String>,
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct ReturnItem {
    pub id:                i32,
    pub return_id:         i32,
    pub item_id:           Uuid,
    pub item_name:         String,
    pub sku:               String,
    pub quantity_returned: Decimal,
    pub unit_price:        Decimal,
    pub line_total:        Decimal,
    /// "good" | "damaged" | "defective"
    pub condition:         String,
    pub restocked:         bool,
    pub notes:             Option<String>,
    pub measurement_type:  Option<String>,
    pub unit_type:         Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReturnDetail {
    pub ret:   Return,
    pub items: Vec<ReturnItem>,
}

// ── Aggregate stats (from v_return_stats view) ────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReturnStats {
    pub total_count:     i64,
    pub full_count:      i64,
    pub partial_count:   i64,
    pub completed_count: i64,
    pub voided_count:    i64,
    pub total_refunded:  Decimal,
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateReturnDto {
    pub original_tx_id:   i32,
    pub refund_method:    String,
    pub refund_reference: Option<String>,
    /// Required — validated in command layer
    pub reason:           Option<String>,
    pub notes:            Option<String>,
    pub items:            Vec<ReturnItemDto>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ReturnItemDto {
    pub item_id:           Uuid,
    pub quantity_returned: f64,
    /// "good" | "damaged" | "defective"
    pub condition:         String,
    pub restock:           bool,
    pub notes:             Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VoidReturnDto {
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReturnFilters {
    pub page:        Option<i64>,
    pub limit:       Option<i64>,
    pub store_id:    Option<i32>,
    pub cashier_id:  Option<i32>,
    pub customer_id: Option<i32>,
    /// "completed" | "voided"
    pub status:      Option<String>,
    /// "full" | "partial"
    pub return_type: Option<String>,
    pub date_from:   Option<String>,
    pub date_to:     Option<String>,
    /// Free-text: reference_no, original_ref_no, customer_name, cashier_name
    pub search:      Option<String>,
}
