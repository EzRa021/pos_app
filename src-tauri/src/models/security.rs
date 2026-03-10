// ============================================================================
// SECURITY / SESSION MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ActiveSession {
    pub id:           i32,
    pub user_id:      i32,
    pub username:     Option<String>,
    pub store_id:     Option<i32>,
    pub device_info:  Option<String>,
    pub ip_address:   Option<String>,
    pub created_at:   DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub expires_at:   DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SetPinDto {
    pub pin: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyPinDto {
    pub user_id: i32,
    pub pin:     String,
}
