// ============================================================================
// TRANSACTION MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use rust_decimal::Decimal;

// ── Sale Creation ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateTransactionDto {
    pub store_id:        i32,
    pub customer_id:     Option<i32>,
    pub payment_method:  String,
    pub amount_tendered: Option<f64>,
    pub notes:           Option<String>,
    pub items:           Vec<TransactionItemDto>,
    pub discount_amount: Option<f64>,
    pub held_tx_id:      Option<i32>,
    /// Offline/PWA support — client-generated UUID to prevent duplicate submissions
    pub client_uuid:     Option<String>,
    /// Whether this sale was created while the POS was offline
    pub offline_sale:    Option<bool>,
    /// Credit terms (e.g. "Net 30") — only used when payment_method = "credit"
    pub payment_terms:   Option<String>,
    /// ISO date string for credit due date — only used when payment_method = "credit"
    pub due_date:        Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TransactionItemDto {
    pub item_id:    Uuid,
    pub quantity:   f64,
    /// Frontend hint only — backend always recalculates price from DB.
    /// Backend warns (but does not fail) if there is a price mismatch.
    pub unit_price: Option<f64>,
    pub discount:   Option<f64>,
}

// ── Void ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct VoidTransactionDto {
    pub reason: String,
    pub notes:  Option<String>,
}

// ── Refund ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RefundItemDto {
    pub item_id:  Uuid,
    pub quantity: f64,
    pub reason:   Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PartialRefundDto {
    pub items: Vec<RefundItemDto>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FullRefundDto {
    pub reason: String,
    pub notes:  Option<String>,
}

// ── Response ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Transaction {
    pub id:              i32,
    pub reference_no:    String,
    pub store_id:        i32,
    pub cashier_id:      i32,
    pub cashier_name:    Option<String>,
    pub customer_id:     Option<i32>,
    pub customer_name:   Option<String>,
    pub subtotal:        Decimal,
    pub discount_amount: Decimal,
    pub tax_amount:      Decimal,
    pub total_amount:    Decimal,
    pub amount_tendered: Option<Decimal>,
    pub change_amount:   Option<Decimal>,
    pub payment_method:  String,
    pub payment_status:  String,
    pub status:          String,
    pub notes:           Option<String>,
    pub created_at:      DateTime<Utc>,
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct TransactionItem {
    pub id:          i32,
    pub tx_id:       i32,
    pub item_id:     Uuid,
    pub item_name:   String,
    pub sku:         String,
    pub quantity:    Decimal,
    pub unit_price:  Decimal,
    pub discount:    Decimal,
    pub tax_amount:  Decimal,
    pub line_total:  Decimal,
}

#[derive(Debug, Serialize)]
pub struct TransactionDetail {
    pub transaction: Transaction,
    pub items:       Vec<TransactionItem>,
}

#[derive(Debug, Serialize)]
pub struct RefundResult {
    pub success:        bool,
    pub tx_id:          i32,
    pub reference_no:   String,
    pub status:         String,
    pub payment_status: String,
    pub refund_amount:  Decimal,
    pub is_full_refund: bool,
    pub refunded_at:    DateTime<Utc>,
    pub message:        String,
}

// ── Filters ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TransactionFilters {
    pub page:        Option<i64>,
    pub limit:       Option<i64>,
    pub store_id:    Option<i32>,
    pub cashier_id:  Option<i32>,
    pub customer_id: Option<i32>,
    pub status:      Option<String>,
    pub date_from:   Option<String>,
    pub date_to:     Option<String>,
    pub search:      Option<String>,
}

// ── Held Transactions ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct HeldTransaction {
    pub id:          i32,
    pub store_id:    i32,
    pub cashier_id:  i32,
    pub label:       Option<String>,
    pub cart_data:   serde_json::Value,
    pub created_at:  DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct HoldTransactionDto {
    pub store_id:  i32,
    pub label:     Option<String>,
    pub cart_data: serde_json::Value,
}

// ── Internal fetch helper (not serialised) ────────────────────────────────────

/// Fetched per-item row used only inside create_transaction logic.
pub struct FetchedItem {
    pub id:                  Uuid,
    pub item_name:           String,
    pub sku:                 String,
    pub selling_price:       Decimal,
    pub discount_price:      Option<Decimal>,
    pub is_active:           bool,
    pub sellable:            bool,
    pub available_for_pos:   bool,
    pub track_stock:         bool,
    pub allow_negative_stock: bool,
    pub taxable:             bool,
    pub tax_rate:            Decimal,
    pub available_quantity:  Decimal,
}
