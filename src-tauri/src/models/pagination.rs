// ============================================================================
// PAGINATION MODELS
// ============================================================================
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub page:  Option<i64>,
    pub limit: Option<i64>,
}

impl PaginationParams {
    pub fn page(&self)   -> i64 { self.page.unwrap_or(1).max(1) }
    pub fn limit(&self)  -> i64 { self.limit.unwrap_or(20).clamp(1, 200) }
    pub fn offset(&self) -> i64 { (self.page() - 1) * self.limit() }
}

#[derive(Debug, Serialize)]
pub struct PagedResult<T: Serialize> {
    pub data:        Vec<T>,
    pub total:       i64,
    pub page:        i64,
    pub limit:       i64,
    pub total_pages: i64,
}

impl<T: Serialize> PagedResult<T> {
    pub fn new(data: Vec<T>, total: i64, page: i64, limit: i64) -> Self {
        let total_pages = if limit > 0 { (total + limit - 1) / limit } else { 0 };
        Self { data, total, page, limit, total_pages }
    }
}
