// ============================================================================
// PAGINATION HELPERS
// ============================================================================

use crate::models::pagination::{PagedResult, PaginationParams};
use serde::Serialize;

/// Build a PagedResult from a vec of data + a total count.
pub fn build_page<T: Serialize>(
    data:  Vec<T>,
    total: i64,
    p:     &PaginationParams,
) -> PagedResult<T> {
    PagedResult::new(data, total, p.page(), p.limit())
}
