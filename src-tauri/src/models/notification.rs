// ============================================================================
// NOTIFICATION MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Notification {
    pub id:             i32,
    pub store_id:       i32,
    pub user_id:        Option<i32>,
    pub r#type:         String,
    pub title:          String,
    pub message:        String,
    pub reference_type: Option<String>,
    pub reference_id:   Option<String>,
    pub is_read:        bool,
    pub created_at:     DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateNotificationDto {
    pub store_id:       i32,
    pub user_id:        Option<i32>,
    pub r#type:         String,
    pub title:          String,
    pub message:        String,
    pub reference_type: Option<String>,
    pub reference_id:   Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NotificationFilters {
    pub store_id: i32,
    pub user_id:  Option<i32>,
    pub unread:   Option<bool>,
    pub r#type:   Option<String>,
    pub limit:    Option<i64>,
}
