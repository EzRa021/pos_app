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

// ── next_series_ref_no ────────────────────────────────────────────────────────

/// Generate a reference number from the store's configured `number_series` row.
///
/// Atomically increments `next_number` and formats as:
///   - `{prefix}{n:0>pad_length}-{suffix}`  when suffix is non-empty  → `TNX-0001-LAG`
///   - `{prefix}{n:0>pad_length}`            when suffix is empty      → `RCP-00001`
///
/// Falls back to a timestamp string if no row exists (should never happen
/// after ensure_defaults runs, but safe either way).
///
/// Uses runtime queries (not macros) so the .sqlx offline cache is not required.
pub async fn next_series_ref_no(pool: &PgPool, store_id: i32, doc_type: &str) -> String {
    let mut conn = match pool.acquire().await {
        Ok(c)  => c,
        Err(_) => return fallback_ref(doc_type),
    };
    next_series_ref_no_exec(&mut conn, store_id, doc_type).await
}

/// Where each doc_type's numbers must be unique. The UNIQUE constraints on
/// these columns are GLOBAL (not per-store), so a per-store counter alone can
/// collide — e.g. a second store's fresh series starting at TNX-0001 when
/// store 1 already issued it, or a counter left behind existing rows after a
/// restore / cloud pull. `next_series_ref_no` verifies each candidate against
/// this table and keeps bumping until it finds a free number, permanently
/// fast-forwarding the counter past any taken range.
fn series_unique_target(doc_type: &str) -> Option<(&'static str, &'static str)> {
    match doc_type {
        "invoice"        => Some(("transactions",    "reference_no")),
        "return"         => Some(("returns",         "reference_no")),
        "purchase_order" => Some(("purchase_orders", "po_number")),
        _                => None, // no global-unique column to defend
    }
}

fn fallback_ref(doc_type: &str) -> String {
    let prefix = match doc_type {
        "return"         => "RTN-",
        "purchase_order" => "PO-",
        "receipt"        => "RCP-",
        _                => "TNX-",
    };
    format!("{}{}", prefix, Utc::now().timestamp())
}

async fn next_series_ref_no_exec(
    executor: &mut sqlx::PgConnection,
    store_id: i32,
    doc_type: &str,
) -> String {
    let (default_prefix, default_pad): (&str, i32) = match doc_type {
        "invoice"        => ("TNX-", 4),
        "return"         => ("RTN-", 5),
        "purchase_order" => ("PO-",  4),
        "receipt"        => ("RCP-", 5),
        _                => ("TNX-", 4),
    };

    // Default suffix = the store's slug (e.g. "TNX-0001-OSH"). Numbers from
    // different stores land in the same GLOBALLY-unique column, so a fresh
    // store restarting at 0001 with an empty suffix collides with store 1's
    // existing numbers. Only applies when the series row is first created —
    // admin-configured series are never touched.
    let default_suffix: String = sqlx::query_as::<_, (Option<String>, String)>(
        "SELECT store_code, store_name FROM stores WHERE id = $1",
    )
    .bind(store_id)
    .fetch_optional(&mut *executor)
    .await
    .ok()
    .flatten()
    .map(|(code, name)| store_txn_slug(code.as_deref(), &name))
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| format!("S{store_id}"));

    // Ensure a row exists so the UPDATE below always hits something.
    let _ = sqlx::query(
        "INSERT INTO number_series (store_id, doc_type, prefix, suffix, pad_length, next_number)
         VALUES ($1, $2, $3, $4, $5, 1)
         ON CONFLICT (store_id, doc_type) DO NOTHING",
    )
    .bind(store_id)
    .bind(doc_type)
    .bind(default_prefix)
    .bind(&default_suffix)
    .bind(default_pad)
    .execute(&mut *executor)
    .await;

    let unique_target = series_unique_target(doc_type);

    // Generate → verify → retry. Each iteration atomically bumps the counter,
    // so on collision the series fast-forwards past the taken range and never
    // collides there again (self-healing after restores / pulls / new stores).
    for attempt in 0..1000 {
        // Atomic increment — returns (value_used, prefix, suffix, pad_length).
        let row: Result<Option<(i64, String, String, i32)>, _> = sqlx::query_as(
            "UPDATE number_series
             SET next_number = next_number + 1, updated_at = NOW()
             WHERE store_id = $1 AND doc_type = $2
             RETURNING next_number - 1, prefix, suffix, pad_length",
        )
        .bind(store_id)
        .bind(doc_type)
        .fetch_optional(&mut *executor)
        .await;

        let Some((n, prefix, suffix, pad)) = row.ok().flatten() else {
            return fallback_ref(doc_type);
        };

        let seq = format!("{:0>width$}", n, width = pad as usize);
        let candidate = if suffix.is_empty() {
            format!("{}{}", prefix, seq)
        } else {
            format!("{}{}-{}", prefix, seq, suffix)
        };

        let Some((table, column)) = unique_target else {
            return candidate; // nothing to defend against — done
        };

        let taken: bool = sqlx::query_scalar::<_, bool>(&format!(
            "SELECT EXISTS(SELECT 1 FROM {table} WHERE {column} = $1)"
        ))
        .bind(&candidate)
        .fetch_one(&mut *executor)
        .await
        .unwrap_or(false);

        if !taken {
            if attempt > 0 {
                tracing::info!(
                    "Ref series {doc_type}/store {store_id}: skipped {attempt} taken number(s) — counter fast-forwarded to a free range."
                );
            }
            return candidate;
        }
    }

    // 1000 consecutive taken numbers — bail out with a guaranteed-unique ref.
    tracing::warn!("Ref series {doc_type}/store {store_id}: exhausted retry budget, using timestamp ref.");
    fallback_ref(doc_type)
}

/// Generate the next value for a free-form numbered document by deriving the
/// sequence from the data itself: MAX of the numeric tail of existing values
/// matching `prefix`, plus one, verified unique before use.
///
/// This replaces `COUNT(*) + 1` numbering, which produces duplicates as soon
/// as rows are deleted, restored, or pulled from the cloud (COUNT is not a
/// high-water mark). Deriving from MAX + verifying against the UNIQUE column
/// is immune to all of those.
pub async fn next_tail_number_exec(
    executor: &mut sqlx::PgConnection,
    table:    &str,
    column:   &str,
    prefix:   &str,
    pad:      usize,
) -> String {
    let base: i64 = sqlx::query_scalar::<_, Option<i64>>(&format!(
        "SELECT MAX((regexp_match({column}, '([0-9]+)$'))[1]::bigint)
         FROM {table} WHERE {column} LIKE $1 || '%'"
    ))
    .bind(prefix)
    .fetch_one(&mut *executor)
    .await
    .ok()
    .flatten()
    .unwrap_or(0);

    for offset in 1..=1000i64 {
        let candidate = format!("{}{:0>width$}", prefix, base + offset, width = pad);
        let taken: bool = sqlx::query_scalar::<_, bool>(&format!(
            "SELECT EXISTS(SELECT 1 FROM {table} WHERE {column} = $1)"
        ))
        .bind(&candidate)
        .fetch_one(&mut *executor)
        .await
        .unwrap_or(false);
        if !taken {
            return candidate;
        }
    }
    format!("{}{}", prefix, Utc::now().timestamp())
}

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
/// Format: `TNX-0001-{SLUG}`
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
///
/// Reads prefix, suffix and pad from the store's `number_series` row for
/// doc_type `"invoice"`.  Default format: `TNX-0001-{STORE_SLUG}`.
/// The `_slug` parameter is retained for call-site compatibility but is no
/// longer needed — the suffix now lives in the DB and is fully configurable
/// from Settings → Invoice Numbering.
pub async fn next_txn_ref_no(pool: &PgPool, store_id: i32, _slug: &str) -> String {
    next_series_ref_no(pool, store_id, "invoice").await
}

/// Same as [`next_txn_ref_no`], but uses an `Executor` so it can be called inside
/// a SQL transaction and roll back cleanly on abort.
pub async fn next_txn_ref_no_exec(
    executor: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    store_id: i32,
    _slug: &str,
) -> String {
    next_series_ref_no_exec(executor.as_mut(), store_id, "invoice").await
}

/// Generate the next return reference number for a store.
///
/// Delegates to `next_series_ref_no` with doc_type `"return"`.
/// The `_slug` parameter is kept for call-site compatibility but ignored.
pub async fn next_ret_ref_no(pool: &PgPool, store_id: i32, _slug: &str) -> String {
    next_series_ref_no(pool, store_id, "return").await
}

/// Same as [`next_ret_ref_no`], but uses an `Executor` so it can be called inside
/// a SQL transaction and roll back cleanly on abort.
pub async fn next_ret_ref_no_exec(
    executor: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    store_id: i32,
    _slug: &str,
) -> String {
    next_series_ref_no_exec(executor.as_mut(), store_id, "return").await
}

/// Generate the next purchase order reference number for a store, inside an
/// existing SQL transaction.
pub async fn next_po_ref_no_exec(
    executor: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    store_id: i32,
) -> String {
    next_series_ref_no_exec(executor.as_mut(), store_id, "purchase_order").await
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
