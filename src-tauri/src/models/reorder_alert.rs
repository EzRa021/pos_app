// ============================================================================
// REORDER ALERT MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReorderAlert {
    pub id:              i32,
    pub item_id:         Uuid,
    pub store_id:        i32,
    pub item_name:       Option<String>,
    pub sku:             Option<String>,
    pub category_name:   Option<String>,
    pub triggered_at:    DateTime<Utc>,
    pub current_qty:     Decimal,
    pub min_stock_level: Decimal,
    pub status:          String,
    pub linked_po_id:    Option<i32>,
    pub acknowledged_by: Option<i32>,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub created_at:      DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct CheckAlertsResult {
    pub new_alerts:    i32,
    pub total_pending: i64,
}

#[derive(Debug, Deserialize)]
pub struct ReorderAlertFilters {
    pub store_id: Option<i32>,
    pub status:   Option<String>,
    pub limit:    Option<i64>,
}
