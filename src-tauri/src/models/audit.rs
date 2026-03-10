// ============================================================================
// AUDIT MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct AuditLog {
    pub id:          i32,
    pub user_id:     Option<i32>,
    pub username:    Option<String>,
    pub action:      String,
    pub resource:    String,
    pub description: Option<String>,
    pub details:     Option<serde_json::Value>,
    pub ip_address:  Option<String>,
    pub user_agent:  Option<String>,
    pub severity:    Option<String>,
    pub created_at:  DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct AuditFilters {
    pub page:      Option<i64>,
    pub limit:     Option<i64>,
    pub store_id:  Option<i32>,
    pub user_id:   Option<i32>,
    pub action:    Option<String>,
    pub resource:  Option<String>,
    pub severity:  Option<String>,
    pub date_from: Option<String>,
    pub date_to:   Option<String>,
}
