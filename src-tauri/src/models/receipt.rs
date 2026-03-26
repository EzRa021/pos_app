// ============================================================================
// RECEIPT MODELS
// ============================================================================
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Receipt {
    pub id:             i32,
    pub transaction_id: i32,
    pub reference_no:   String,
    pub store_name:     String,
    pub cashier_name:   Option<String>,
    pub customer_name:  Option<String>,
    pub total_amount:   Decimal,
    pub payment_method: String,
    pub html_content:   Option<String>,
    pub printed_at:     Option<DateTime<Utc>>,
    pub created_at:     DateTime<Utc>,
}

// ── Receipt Settings ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct ReceiptSettings {
    pub id:                  i32,
    pub store_id:            i32,
    // Branding
    pub show_logo:           bool,
    pub logo_url:            Option<String>,
    pub logo_base64:         Option<String>,
    pub business_name:       Option<String>,
    pub business_address:    Option<String>,
    pub business_phone:      Option<String>,
    pub business_email:      Option<String>,
    pub tagline:             Option<String>,
    // Header / footer
    pub header_text:         Option<String>,
    pub footer_text:         Option<String>,
    // Visibility toggles
    pub show_cashier_name:   bool,
    pub show_customer_name:  bool,
    pub show_item_sku:       bool,
    pub show_tax_breakdown:  bool,
    pub show_qr_code:        bool,
    pub auto_print:          bool,
    // Paper & layout
    pub paper_width_mm:      i32,
    pub font_size:           i32,
    pub receipt_copies:      i32,
    pub currency_symbol:     Option<String>,
    pub updated_at:          DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateReceiptSettingsDto {
    pub store_id:           i32,
    // Branding
    pub show_logo:          bool,
    pub logo_url:           Option<String>,
    pub logo_base64:        Option<String>,
    pub business_name:      Option<String>,
    pub business_address:   Option<String>,
    pub business_phone:     Option<String>,
    pub business_email:     Option<String>,
    pub tagline:            Option<String>,
    // Header / footer
    pub header_text:        Option<String>,
    pub footer_text:        Option<String>,
    // Visibility toggles
    pub show_cashier_name:  bool,
    pub show_customer_name: bool,
    pub show_item_sku:      bool,
    pub show_tax_breakdown: bool,
    pub show_qr_code:       bool,
    pub auto_print:         bool,
    // Paper & layout
    pub paper_width_mm:     i32,
    pub font_size:          i32,
    pub receipt_copies:     i32,
    pub currency_symbol:    Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PrintReceiptDto {
    pub transaction_id: i32,
    pub printer_name:   Option<String>,
    pub paper_width_mm: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct PrinterInfo {
    pub name:        String,
    pub device_name: String,
    pub is_default:  bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PrinterSettings {
    pub default_printer:      String,
    pub auto_select_printer:  bool,
    pub paper_width_mm:       i32,
    pub test_print_on_startup: bool,
}

impl Default for PrinterSettings {
    fn default() -> Self {
        Self {
            default_printer:      String::new(),
            auto_select_printer:  true,
            paper_width_mm:       80,
            test_print_on_startup: false,
        }
    }
}
