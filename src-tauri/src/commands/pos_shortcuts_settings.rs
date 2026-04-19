// ============================================================================
// POS SHORTCUTS SETTINGS COMMANDS
// (distinct from pos_favourites which is the cashier-facing quick-dial;
//  shortcuts here are admin-configured pinned items shown as large grid buttons)
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::pos_shortcuts_settings::{
        PosShortcutDetail, AddShortcutDto, RemoveShortcutDto, ReorderShortcutsDto,
    },
    state::AppState,
};
use super::auth::guard_permission;

const MAX_SHORTCUTS: i16 = 12;

// ── fetch helper ──────────────────────────────────────────────────────────────

async fn fetch_shortcuts(pool: &sqlx::PgPool, store_id: i32) -> AppResult<Vec<PosShortcutDetail>> {
    let rows = sqlx::query!(
        r#"SELECT ps.id, ps.store_id, ps.item_id, ps.position, ps.created_at,
                  i.item_name, i.sku, i.selling_price
           FROM   pos_shortcuts ps
           JOIN   items i ON i.id = ps.item_id
           LEFT JOIN item_settings ist ON ist.item_id = i.id AND ist.store_id = ps.store_id
           WHERE  ps.store_id = $1
             AND  COALESCE(ist.is_active, TRUE) = TRUE
           ORDER  BY ps.position"#,
        store_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|r| PosShortcutDetail {
        id:           r.id,
        store_id:     r.store_id,
        item_id:      r.item_id,
        position:     r.position,
        item_name:    r.item_name,
        sku:          r.sku,
        selling_price: r.selling_price,
        created_at:   r.created_at,
    }).collect())
}

// ── get ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_pos_shortcuts(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<PosShortcutDetail>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;
    fetch_shortcuts(&pool, store_id).await
}

// ── add ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn add_pos_shortcut(
    state:   State<'_, AppState>,
    token:   String,
    payload: AddShortcutDto,
) -> AppResult<Vec<PosShortcutDetail>> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    // Count existing
    let count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM pos_shortcuts WHERE store_id = $1",
        payload.store_id,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    if count >= MAX_SHORTCUTS as i64 {
        return Err(AppError::Validation(format!("Maximum {MAX_SHORTCUTS} shortcuts allowed per store")));
    }

    if payload.position < 0 || payload.position >= MAX_SHORTCUTS {
        return Err(AppError::Validation(format!("Position must be 0–{}", MAX_SHORTCUTS - 1)));
    }

    // Shift any existing item at that position out of the way
    sqlx::query!(
        "UPDATE pos_shortcuts SET position = position + 1
         WHERE store_id = $1 AND position >= $2",
        payload.store_id,
        payload.position,
    )
    .execute(&pool)
    .await?;

    sqlx::query!(
        "INSERT INTO pos_shortcuts (store_id, item_id, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (store_id, item_id) DO UPDATE SET position = EXCLUDED.position",
        payload.store_id,
        payload.item_id,
        payload.position,
    )
    .execute(&pool)
    .await?;

    fetch_shortcuts(&pool, payload.store_id).await
}

// ── remove ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn remove_pos_shortcut(
    state:   State<'_, AppState>,
    token:   String,
    payload: RemoveShortcutDto,
) -> AppResult<Vec<PosShortcutDetail>> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        "DELETE FROM pos_shortcuts WHERE store_id = $1 AND item_id = $2",
        payload.store_id,
        payload.item_id,
    )
    .execute(&pool)
    .await?;

    // Compact positions
    let remaining = sqlx::query!(
        "SELECT id FROM pos_shortcuts WHERE store_id = $1 ORDER BY position",
        payload.store_id,
    )
    .fetch_all(&pool)
    .await?;

    for (i, row) in remaining.iter().enumerate() {
        sqlx::query!(
            "UPDATE pos_shortcuts SET position = $1 WHERE id = $2",
            i as i16,
            row.id,
        )
        .execute(&pool)
        .await?;
    }

    fetch_shortcuts(&pool, payload.store_id).await
}

// ── reorder ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn reorder_pos_shortcuts(
    state:   State<'_, AppState>,
    token:   String,
    payload: ReorderShortcutsDto,
) -> AppResult<Vec<PosShortcutDetail>> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    for (i, item_id) in payload.order.iter().enumerate() {
        sqlx::query!(
            "UPDATE pos_shortcuts SET position = $1 WHERE store_id = $2 AND item_id = $3",
            i as i16,
            payload.store_id,
            item_id,
        )
        .execute(&pool)
        .await?;
    }

    fetch_shortcuts(&pool, payload.store_id).await
}
