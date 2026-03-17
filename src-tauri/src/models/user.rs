// ============================================================================
// USER MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct User {
    pub id:         i32,
    pub username:   String,
    pub email:      String,
    pub first_name: String,
    pub last_name:  String,
    pub phone:      Option<String>,
    pub role_id:    i32,
    pub role_slug:  String,
    pub role_name:  String,
    pub store_id:   Option<i32>,
    pub store_name: Option<String>,
    pub is_active:  bool,
    pub is_global:  bool,
    pub last_login: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserDto {
    pub username:   String,
    pub email:      String,
    pub password:   String,
    pub first_name: String,
    pub last_name:  String,
    pub phone:      Option<String>,
    pub role_id:    i32,
    pub store_id:   Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserDto {
    pub email:      Option<String>,
    pub first_name: Option<String>,
    pub last_name:  Option<String>,
    pub phone:      Option<String>,
    pub role_id:    Option<i32>,
    pub store_id:   Option<i32>,
    pub is_active:  Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UserFilters {
    pub page:     Option<i64>,
    pub limit:    Option<i64>,
    pub store_id: Option<i32>,
    pub role_id:  Option<i32>,
    pub is_active: Option<bool>,
    pub search:   Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Role {
    pub id:              i32,
    pub role_name:       String,
    pub role_slug:       String,
    pub description:     Option<String>,
    pub is_global:       bool,
    pub hierarchy_level: i32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Permission {
    pub id:              i32,
    pub permission_name: String,
    pub permission_slug: String,
    pub category:        Option<String>,
    pub description:     Option<String>,
}
