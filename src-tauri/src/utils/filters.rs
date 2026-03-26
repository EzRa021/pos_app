// ============================================================================
// SQL FILTER HELPERS
// ============================================================================
// Small helpers to build dynamic WHERE clauses safely with positional params.
// ============================================================================

#[allow(dead_code)]
/// Append a text-search condition across multiple columns.
/// Returns the SQL fragment (e.g. "(col1 ILIKE $3 OR col2 ILIKE $3)") and
/// increments `p` so the caller knows the next param index.
pub fn text_search_sql(columns: &[&str], search: &Option<String>, p: &mut i32) -> Option<String> {
    search.as_ref().map(|_| {
        let cond = columns
            .iter()
            .map(|c| format!("{c} ILIKE ${p}"))
            .collect::<Vec<_>>()
            .join(" OR ");
        *p += 1;
        format!("({cond})")
    })
}

#[allow(dead_code)]
/// Build a LIMIT / OFFSET clause from page + limit values.
pub fn limit_offset_sql(_limit: i64, _offset: i64, p: &mut i32) -> String {
    let s = format!("LIMIT ${p} OFFSET ${}", *p + 1);
    *p += 2;
    s
}
