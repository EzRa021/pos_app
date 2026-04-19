// ============================================================================
// NUMBER SERIES COMMANDS
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::number_series::{NumberSeries, UpdateNumberSeriesDto},
    state::AppState,
    utils::ref_no::store_txn_slug,
};
use super::auth::guard_permission;

// ── ensure_defaults ───────────────────────────────────────────────────────────

/// Ensures every required doc_type row exists for the given store.
/// For `invoice` the default prefix is now "TNX-" with 4-digit padding.
/// The suffix is auto-derived from the store's code / name via store_txn_slug().
pub async fn ensure_defaults(pool: &sqlx::PgPool, store_id: i32) -> AppResult<()> {
    // Look up store info once so we can build the suffix.
    let store_row = sqlx::query!(
        "SELECT store_name, store_code FROM stores WHERE id = $1",
        store_id
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let txn_suffix = store_txn_slug(
        store_row.as_ref().and_then(|r| r.store_code.as_deref()),
        store_row.as_ref().map(|r| r.store_name.as_str()).unwrap_or("STR"),
    );
    // Returns / receipts / POs use an empty suffix (sequential-only format).
    let empty = "";

    // (doc_type, prefix, suffix, pad)
    let defaults: &[(&str, &str, &str, i32)] = &[
        ("invoice",        "TNX-", &txn_suffix, 4),
        ("receipt",        "RCP-", empty,       5),
        ("purchase_order", "PO-",  empty,       4),
        ("return",         "RTN-", &txn_suffix, 5),
    ];

    for (doc_type, prefix, suffix, pad) in defaults {
        sqlx::query!(
            r#"INSERT INTO number_series (store_id, doc_type, prefix, suffix, pad_length, next_number)
               VALUES ($1, $2, $3, $4, $5, 1)
               ON CONFLICT (store_id, doc_type) DO NOTHING"#,
            store_id, doc_type, prefix, suffix, pad,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

// ── get ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_number_series(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<NumberSeries>> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;
    ensure_defaults(&pool, store_id).await?;

    sqlx::query_as!(
        NumberSeries,
        "SELECT id, store_id, doc_type, prefix, suffix, pad_length, next_number, created_at, updated_at
         FROM   number_series WHERE store_id = $1 ORDER BY doc_type",
        store_id,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── update ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_number_series(
    state:   State<'_, AppState>,
    token:   String,
    payload: UpdateNumberSeriesDto,
) -> AppResult<NumberSeries> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    // Validate pad_length
    if let Some(pad) = payload.pad_length {
        if !(1..=10).contains(&pad) {
            return Err(AppError::Validation("pad_length must be between 1 and 10".into()));
        }
    }
    // Validate next_number
    if let Some(n) = payload.next_number {
        if n < 1 {
            return Err(AppError::Validation("next_number must be >= 1".into()));
        }
    }
    // Validate suffix: max 8 chars, uppercase alphanumeric only
    let clean_suffix = payload.suffix.as_deref().map(|s| {
        s.trim()
            .to_uppercase()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(8)
            .collect::<String>()
    });

    sqlx::query!(
        r#"UPDATE number_series SET
           prefix      = COALESCE($1, prefix),
           suffix      = COALESCE($2, suffix),
           pad_length  = COALESCE($3, pad_length),
           next_number = COALESCE($4, next_number),
           updated_at  = NOW()
           WHERE store_id = $5 AND doc_type = $6"#,
        payload.prefix,
        clean_suffix,
        payload.pad_length,
        payload.next_number,
        payload.store_id,
        payload.doc_type,
    )
    .execute(&pool)
    .await?;

    sqlx::query_as!(
        NumberSeries,
        "SELECT id, store_id, doc_type, prefix, suffix, pad_length, next_number, created_at, updated_at
         FROM   number_series WHERE store_id = $1 AND doc_type = $2",
        payload.store_id,
        payload.doc_type,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

// ── preview ───────────────────────────────────────────────────────────────────
/// Returns what the next generated number will look like (read-only, no increment).
pub fn format_number(prefix: &str, suffix: &str, next: i64, pad: i32) -> String {
    let seq = format!("{:0>width$}", next, width = pad as usize);
    if suffix.is_empty() {
        format!("{}{}", prefix, seq)
    } else {
        format!("{}{}-{}", prefix, seq, suffix)
    }
}
