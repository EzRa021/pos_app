// ============================================================================
// STORE SETTINGS MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StoreSettings {
    pub store_id:                            i32,
    // Pricing
    pub allow_price_override:                bool,
    pub max_discount_percent:                Decimal,
    pub require_discount_reason:             bool,
    pub warn_sell_below_cost:                bool,
    pub allow_sell_below_cost:               bool,
    // Transaction
    pub require_customer_above_amount:       Option<Decimal>,
    pub void_same_day_only:                  bool,
    pub max_void_amount:                     Option<Decimal>,
    pub require_manager_approval_void_above: Option<Decimal>,
    // Receipt
    pub receipt_header_text:                 Option<String>,
    pub receipt_footer_text:                 Option<String>,
    pub show_vat_on_receipt:                 bool,
    pub show_cashier_on_receipt:             bool,
    pub receipt_copies:                      i32,
    // Stock
    pub auto_create_po_on_reorder:           bool,
    // Tax
    pub tax_inclusive:                       bool,
    // Cash
    pub opening_float_required:              bool,
    pub min_opening_float:                   Option<Decimal>,
    // Credit
    pub max_credit_days:                     i32,
    pub auto_flag_overdue_after_days:        i32,
    // Currency
    pub currency:                            String,
    pub locale:                              String,
    // Notifications
    pub notif_low_stock_enabled:             bool,
    pub notif_low_stock_threshold:           i32,
    pub notif_overdue_credit_enabled:        bool,
    pub notif_overdue_credit_days:           i32,
    pub notif_shift_end_reminder_enabled:    bool,
    pub notif_shift_end_minutes:             i32,
    pub notif_min_float_warning_enabled:     bool,
    pub notif_min_float_amount:              Option<Decimal>,
    pub notif_in_app_enabled:               bool,
    // Low stock defaults
    pub default_reorder_point:               i32,
    pub default_reorder_qty:                 i32,
    pub created_at:                          DateTime<Utc>,
    pub updated_at:                          DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStoreSettingsDto {
    pub store_id:                            i32,
    pub allow_price_override:                Option<bool>,
    pub max_discount_percent:                Option<f64>,
    pub require_discount_reason:             Option<bool>,
    pub warn_sell_below_cost:                Option<bool>,
    pub allow_sell_below_cost:               Option<bool>,
    pub require_customer_above_amount:       Option<f64>,
    pub void_same_day_only:                  Option<bool>,
    pub max_void_amount:                     Option<f64>,
    pub require_manager_approval_void_above: Option<f64>,
    pub receipt_header_text:                 Option<String>,
    pub receipt_footer_text:                 Option<String>,
    pub show_vat_on_receipt:                 Option<bool>,
    pub show_cashier_on_receipt:             Option<bool>,
    pub receipt_copies:                      Option<i32>,
    pub tax_inclusive:                       Option<bool>,
    pub auto_create_po_on_reorder:           Option<bool>,
    pub opening_float_required:              Option<bool>,
    pub min_opening_float:                   Option<f64>,
    pub max_credit_days:                     Option<i32>,
    pub auto_flag_overdue_after_days:        Option<i32>,
    pub currency:                            Option<String>,
    pub locale:                              Option<String>,
    // Notifications
    pub notif_low_stock_enabled:             Option<bool>,
    pub notif_low_stock_threshold:           Option<i32>,
    pub notif_overdue_credit_enabled:        Option<bool>,
    pub notif_overdue_credit_days:           Option<i32>,
    pub notif_shift_end_reminder_enabled:    Option<bool>,
    pub notif_shift_end_minutes:             Option<i32>,
    pub notif_min_float_warning_enabled:     Option<bool>,
    pub notif_min_float_amount:              Option<f64>,
    pub notif_in_app_enabled:               Option<bool>,
    // Low stock defaults
    pub default_reorder_point:               Option<i32>,
    pub default_reorder_qty:                 Option<i32>,
}
