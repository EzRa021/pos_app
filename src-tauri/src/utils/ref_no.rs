// ============================================================================
// utils/ref_no.rs — Per-store reference number generator
// ============================================================================
// Uses the store_ref_counters table (migration 0071) for atomic, per-store
// sequential reference numbers. Each counter type is independent:
//   TXN   → TXN-000001 per store
//   RET   → RET-000001 per store
//   PO    → PO-000001  per store
//   SHIFT → SHF-000001 per store
//   CM    → CM-000001  per store
//
// The UPDATE … RETURNING pattern is a single round-trip and is safe under
// concurrent inserts without any advisory lock.
// ============================================================================

use sqlx::PgPool;
use chrono::Utc;

/// Atomically increment and return the next reference number for a store.
///
/// Falls back to a timestamp-based value if the row doesn't exist yet
/// (e.g. freshly created store before the seed INSERT runs).
pub async fn next_ref_no(
    pool:     &PgPool,
    store_id: i32,
    prefix:   &str,       // "TXN" | "RET" | "PO" | "SHIFT" | "CM"
    ref_type: &str,       // same value, used as the table key
    width:    usize,      // zero-pad width (6 for TXN, 5 for PO/SHIFT)
) -> String {
    // INSERT … ON CONFLICT always inserts or updates, so RETURNING always
    // yields exactly one row — use fetch_one, not fetch_optional.
    let result: Result<Option<i64>, _> = sqlx::query_scalar!(
        r#"
        INSERT INTO store_ref_counters (store_id, ref_type, next_val)
        VALUES ($1, $2, 2)
        ON CONFLICT (store_id, ref_type) DO UPDATE
            SET next_val = store_ref_counters.next_val + 1
        RETURNING next_val - 1
        "#,
        store_id,
        ref_type,
    )
    .fetch_one(pool)
    .await;

    match result.ok().flatten() {
        Some(n) => format!("{}-{:0>width$}", prefix, n, width = width),
        None    => format!("{}-{}", prefix, Utc::now().timestamp()),
    }
}

/// Build a clean store slug from `store_code` (preferred) or `store_name`.
/// Output: uppercase, spaces→hyphens, only [A-Z0-9-], max 12 chars.
///
/// Examples:
///   store_code "MB"               → "MB"
///   store_name "Lagos Main Store"  → "LAGOS-MAIN"
pub fn store_slug(code: Option<&str>, name: &str) -> String {
    let raw = match code.filter(|s| !s.trim().is_empty()) {
        Some(c) => c.trim().to_uppercase(),
        None    => name.trim().to_uppercase(),
    };

    // Replace whitespace/underscores with hyphen, keep only [A-Z0-9-]
    let mut slug = String::with_capacity(raw.len());
    let mut last_hyphen = true; // suppress leading hyphens
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_hyphen = false;
        } else if (ch == ' ' || ch == '_' || ch == '-') && !last_hyphen {
            slug.push('-');
            last_hyphen = true;
        }
        // anything else is dropped
    }

    // Trim trailing hyphen, cap at 12 chars, trim again
    let trimmed = slug.trim_end_matches('-');
    let capped: String = trimmed.chars().take(12).collect();
    capped.trim_end_matches('-').to_string()
}

/// Build a short store slug (max 4 chars) for use in transaction reference numbers.
/// Format: `TXN-0001-{SLUG}`
///
/// Priority:
///   1. `store_code` if set — stripped to alphanumeric, capped at 4 chars
///   2. Initials of each word in `store_name` (multi-word), max 4
///   3. First 3 alphanumeric chars of `store_name` (single word)
///
/// Examples:
///   store_code "LG"               → "LG"
///   store_code "MAIN"             → "MAIN"
///   store_name "Lagos Main Branch" → "LMB"
///   store_name "Lagos"            → "LAG"
pub fn store_txn_slug(code: Option<&str>, name: &str) -> String {
    // Prefer store_code — gives branch admins direct control over their slug
    if let Some(c) = code.filter(|s| !s.trim().is_empty()) {
        let clean: String = c.trim()
            .to_uppercase()
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric())
            .take(4)
            .collect();
        if !clean.is_empty() {
            return clean;
        }
    }

    // Fall back to store name
    let up = name.trim().to_uppercase();
    let words: Vec<&str> = up.split_whitespace().collect();

    if words.len() > 1 {
        // Multi-word: initials of each word (max 4 chars)
        words.iter()
            .filter_map(|w| w.chars().find(|ch| ch.is_ascii_alphanumeric()))
            .take(4)
            .collect()
    } else {
        // Single word: first 3 alphanumeric chars
        up.chars()
            .filter(|ch| ch.is_ascii_alphanumeric())
            .take(3)
            .collect()
    }
}

/// Generate the next transaction reference number for a store.
/// Format: `TXN-{N:04}-{SLUG}`  e.g. `TXN-0001-LG`, `TXN-0042-LMB`
///
/// Reuses the existing `TXN` row in `store_ref_counters` (seeded by migration 0071).
/// Counter is atomic — safe under concurrent checkouts.
pub async fn next_txn_ref_no(
    pool:     &PgPool,
    store_id: i32,
    slug:     &str,
) -> String {
    let result: Result<Option<i64>, _> = sqlx::query_scalar!(
        r#"
        INSERT INTO store_ref_counters (store_id, ref_type, next_val)
        VALUES ($1, 'TXN', 2)
        ON CONFLICT (store_id, ref_type) DO UPDATE
            SET next_val = store_ref_counters.next_val + 1
        RETURNING next_val - 1
        "#,
        store_id,
    )
    .fetch_one(pool)
    .await;

    match result.ok().flatten() {
        Some(n) => format!("TXN-{:04}-{}", n, slug),
        None    => format!("TXN-{}-{}", Utc::now().timestamp(), slug),
    }
}

/// Generate the next return reference number for a store.
/// Format: `RET-{N:04}-{SLUG}`  e.g. `RET-0001-LG`, `RET-0012-LMB`
///
/// Reuses the existing `RET` row in `store_ref_counters` (seeded by migration 0071).
pub async fn next_ret_ref_no(
    pool:     &PgPool,
    store_id: i32,
    slug:     &str,
) -> String {
    let result: Result<Option<i64>, _> = sqlx::query_scalar!(
        r#"
        INSERT INTO store_ref_counters (store_id, ref_type, next_val)
        VALUES ($1, 'RET', 2)
        ON CONFLICT (store_id, ref_type) DO UPDATE
            SET next_val = store_ref_counters.next_val + 1
        RETURNING next_val - 1
        "#,
        store_id,
    )
    .fetch_one(pool)
    .await;

    match result.ok().flatten() {
        Some(n) => format!("RET-{:04}-{}", n, slug),
        None    => format!("RET-{}-{}", Utc::now().timestamp(), slug),
    }
}

/// Generate the next unique item SKU for a store.
/// Format: `ITEM-{SLUG}-{N}` where SLUG is derived from the store's code or
/// name and N is a per-store atomic counter (no zero-padding — stays compact).
///
/// Examples:
///   ITEM-MB-1
///   ITEM-LAGOS-MAIN-42
pub async fn next_item_sku(
    pool:     &PgPool,
    store_id: i32,
    slug:     &str,
) -> String {
    let result: Result<Option<i64>, _> = sqlx::query_scalar!(
        r#"
        INSERT INTO store_ref_counters (store_id, ref_type, next_val)
        VALUES ($1, 'ITEM', 2)
        ON CONFLICT (store_id, ref_type) DO UPDATE
            SET next_val = store_ref_counters.next_val + 1
        RETURNING next_val - 1
        "#,
        store_id,
    )
    .fetch_one(pool)
    .await;

    match result.ok().flatten() {
        Some(n) => format!("ITEM-{}-{}", slug, n),
        None    => format!("ITEM-{}-{}", slug, Utc::now().timestamp()),
    }
}
