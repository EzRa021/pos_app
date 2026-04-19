// ============================================================================
// NUMBER SERIES MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct NumberSeries {
    pub id:          i32,
    pub store_id:    i32,
    pub doc_type:    String,
    pub prefix:      String,
    /// Short store identifier appended after the counter, e.g. "LAG".
    /// When non-empty the final format is: {prefix}{padded_n}-{suffix}
    /// e.g. TNX-0001-LAG.  Empty string → {prefix}{padded_n} (legacy).
    pub suffix:      String,
    pub pad_length:  i32,
    pub next_number: i64,
    pub created_at:  DateTime<Utc>,
    pub updated_at:  DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNumberSeriesDto {
    pub store_id:    i32,
    pub doc_type:    String,
    pub prefix:      Option<String>,
    /// Override the auto-derived store suffix (max 8 chars, uppercase alphanumeric only).
    pub suffix:      Option<String>,
    pub pad_length:  Option<i32>,
    /// Only allowed to set if currently at 1 (fresh series) or explicitly requested reset.
    pub next_number: Option<i64>,
}
