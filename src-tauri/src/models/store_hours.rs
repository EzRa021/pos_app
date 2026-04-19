// ============================================================================
// STORE HOURS MODELS
// ============================================================================

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct StoreHour {
    pub id:          i32,
    pub store_id:    i32,
    pub day_of_week: i16,     // 0=Sun … 6=Sat
    pub is_open:     bool,
    pub open_time:   Option<String>,  // "HH:MM"
    pub close_time:  Option<String>,  // "HH:MM"
}

#[derive(Debug, Deserialize)]
pub struct UpsertStoreHourDto {
    pub store_id:    i32,
    pub day_of_week: i16,
    pub is_open:     bool,
    pub open_time:   Option<String>,
    pub close_time:  Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BulkUpsertStoreHoursDto {
    pub store_id: i32,
    pub hours:    Vec<UpsertStoreHourDto>,
}
