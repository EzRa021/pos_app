// ============================================================================
// PAYMENT METHOD SETTINGS MODEL
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct PaymentMethodSetting {
    pub id:                i32,
    pub store_id:          i32,
    pub method_key:        String,
    pub display_name:      String,
    pub is_enabled:        bool,
    pub require_reference: bool,
    pub reference_label:   Option<String>,
    pub sort_order:        i32,
    pub created_at:        DateTime<Utc>,
    pub updated_at:        DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertPaymentMethodDto {
    pub store_id:          i32,
    pub method_key:        String,
    pub display_name:      String,
    pub is_enabled:        bool,
    pub require_reference: bool,
    pub reference_label:   Option<String>,
    pub sort_order:        i32,
}

#[derive(Debug, Deserialize)]
pub struct ReorderPaymentMethodsDto {
    pub store_id: i32,
    /// Vec of method_key in desired order
    pub order:    Vec<String>,
}
