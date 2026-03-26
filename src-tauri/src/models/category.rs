// ============================================================================
// CATEGORY MODELS  (aligned with quantum-pos-app category.service.js)
// ============================================================================
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Full category row (includes JOIN data for HTTP/Tauri responses).
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Category {
    pub id:                   i32,
    pub category_code:        Option<String>,
    pub category_name:        String,
    pub description:          Option<String>,
    pub store_id:             i32,
    pub department_id:        Option<i32>,
    pub parent_category_id:   Option<i32>,
    pub display_order:        i32,
    pub color:                Option<String>,
    pub icon:                 Option<String>,
    pub image_url:            Option<String>,
    pub is_visible_in_pos:    bool,
    pub requires_weighing:    bool,
    pub default_tax_rate:     Option<rust_decimal::Decimal>,
    pub is_active:            bool,
    pub created_at:           DateTime<Utc>,
    pub updated_at:           DateTime<Utc>,
    // JOIN fields
    pub store_name:           Option<String>,
    pub department_name:      Option<String>,
    pub department_code:      Option<String>,
    pub parent_category_name: Option<String>,
    pub item_count:           Option<i64>,
}

/// Filters for `get_categories`
#[derive(Debug, Deserialize)]
pub struct CategoryFilters {
    pub page:                Option<i64>,
    pub limit:               Option<i64>,
    pub store_id:            Option<i32>,
    pub department_id:       Option<i32>,
    pub parent_id:           Option<i32>,
    pub is_active:           Option<bool>,
    pub is_visible_in_pos:   Option<bool>,
    pub requires_weighing:   Option<bool>,
    pub search:              Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCategoryDto {
    pub category_code:      Option<String>,
    pub category_name:      String,
    pub description:        Option<String>,
    pub store_id:           i32,
    pub department_id:      Option<i32>,
    pub parent_category_id: Option<i32>,
    pub display_order:      Option<i32>,
    pub color:              Option<String>,
    pub icon:               Option<String>,
    pub image_url:          Option<String>,
    pub is_visible_in_pos:  Option<bool>,
    pub requires_weighing:  Option<bool>,
    pub default_tax_rate:   Option<f64>,
    pub is_active:          Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCategoryDto {
    pub category_code:      Option<String>,
    pub category_name:      Option<String>,
    pub description:        Option<String>,
    pub department_id:      Option<i32>,
    pub parent_category_id: Option<i32>,
    pub display_order:      Option<i32>,
    pub color:              Option<String>,
    pub icon:               Option<String>,
    pub image_url:          Option<String>,
    pub is_visible_in_pos:  Option<bool>,
    pub requires_weighing:  Option<bool>,
    pub default_tax_rate:   Option<f64>,
    pub is_active:          Option<bool>,
}
