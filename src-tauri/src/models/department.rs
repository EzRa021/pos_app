// ============================================================================
// DEPARTMENT MODELS  (aligned with quantum-pos-app department.service.js)
// ============================================================================
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Full department row (includes JOIN data for HTTP/Tauri responses).
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Department {
    pub id:                     i32,
    pub store_id:               Option<i32>,    // NULL = global department
    pub department_code:        Option<String>,
    pub department_name:        String,
    pub description:            Option<String>,
    pub parent_department_id:   Option<i32>,
    pub display_order:          i32,
    pub color:                  Option<String>,
    pub icon:                   Option<String>,
    pub is_active:              bool,
    pub created_at:             DateTime<Utc>,
    pub updated_at:             DateTime<Utc>,
    // JOIN fields (may be absent)
    pub store_name:             Option<String>,
    pub parent_department_name: Option<String>,
    pub category_count:         Option<i64>,
}

/// Filters for `get_departments` / `search_departments`
#[derive(Debug, Deserialize)]
pub struct DepartmentFilters {
    pub page:      Option<i64>,
    pub limit:     Option<i64>,
    pub store_id:  Option<i32>,
    pub parent_id: Option<i32>,
    pub is_active: Option<bool>,
    pub search:    Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDepartmentDto {
    pub department_code:      Option<String>,
    pub department_name:      String,
    pub description:          Option<String>,
    pub store_id:             Option<i32>,
    pub parent_department_id: Option<i32>,
    pub display_order:        Option<i32>,
    pub color:                Option<String>,
    pub icon:                 Option<String>,
    pub is_active:            Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDepartmentDto {
    pub department_code:      Option<String>,
    pub department_name:      Option<String>,
    pub description:          Option<String>,
    pub store_id:             Option<i32>,
    pub parent_department_id: Option<i32>,
    pub display_order:        Option<i32>,
    pub color:                Option<String>,
    pub icon:                 Option<String>,
    pub is_active:            Option<bool>,
}
