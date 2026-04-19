// ============================================================================
// EXPENSE CATEGORY MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct ExpenseCategory {
    pub id:          i32,
    pub store_id:    Option<i32>,
    pub name:        String,
    pub description: Option<String>,
    pub is_active:   bool,
    pub created_at:  DateTime<Utc>,
    pub updated_at:  DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateExpenseCategoryDto {
    pub store_id:    Option<i32>,
    pub name:        String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateExpenseCategoryDto {
    pub name:        Option<String>,
    pub description: Option<String>,
    pub is_active:   Option<bool>,
}
