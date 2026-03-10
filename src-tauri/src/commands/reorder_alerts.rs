// ============================================================================
// REORDER ALERTS
// ============================================================================

use tauri::State;
use uuid::Uuid;
use crate::{
    error::{AppError, AppResult},
    models::reorder_alert::{ReorderAlert, CheckAlertsResult, ReorderAlertFilters},
    state::AppState,
};
use super::auth::guard_permission;

// ── check_reorder_alerts ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn check_reorder_alerts(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<CheckAlertsResult> {
    guard_permission(&state, &token, "inventory.read").await?;
    let pool = state.pool().await?;

    let new_alerts: u64 = sqlx::query!(
        r#"
        INSERT INTO reorder_alerts (item_id, store_id, current_qty, min_stock_level)
        SELECT
            i.id,
            i.store_id,
            istock.available_quantity,
            ist.min_stock_level::numeric
        FROM items i
        JOIN item_settings  ist    ON ist.item_id = i.id
        JOIN item_stock     istock ON istock.item_id = i.id AND istock.store_id = i.store_id
        WHERE i.store_id = $1
          AND ist.track_stock     = TRUE
          AND ist.is_active       = TRUE
          AND ist.min_stock_level IS NOT NULL
          AND istock.available_quantity <= ist.min_stock_level::numeric
          AND NOT EXISTS (
              SELECT 1 FROM reorder_alerts ra
              WHERE ra.item_id  = i.id
                AND ra.store_id = i.store_id
                AND ra.status IN ('pending', 'acknowledged')
          )
        ON CONFLICT DO NOTHING
        "#,
        store_id,
    )
    .execute(&pool)
    .await?
    .rows_affected();

    let total_pending: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM reorder_alerts WHERE store_id = $1 AND status = 'pending'",
        store_id,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    Ok(CheckAlertsResult { new_alerts: new_alerts as i32, total_pending })
}

// ── get_reorder_alerts ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_reorder_alerts(
    state:   State<'_, AppState>,
    token:   String,
    filters: ReorderAlertFilters,
) -> AppResult<Vec<ReorderAlert>> {
    guard_permission(&state, &token, "inventory.read").await?;
    let pool  = state.pool().await?;
    let limit = filters.limit.unwrap_or(100).clamp(1, 500);

    sqlx::query_as!(
        ReorderAlert,
        r#"
        SELECT
            ra.id,
            ra.item_id         AS "item_id!: Uuid",
            ra.store_id,
            i.item_name,
            i.sku,
            COALESCE(c.category_name, 'Uncategorized') AS category_name,
            ra.triggered_at,
            ra.current_qty     AS "current_qty!: rust_decimal::Decimal",
            ra.min_stock_level AS "min_stock_level!: rust_decimal::Decimal",
            ra.status,
            ra.linked_po_id,
            ra.acknowledged_by,
            ra.acknowledged_at,
            ra.created_at
        FROM reorder_alerts ra
        JOIN items         i  ON i.id  = ra.item_id
        LEFT JOIN categories c ON c.id = i.category_id
        WHERE ($1::int  IS NULL OR ra.store_id = $1)
          AND ($2::text IS NULL OR ra.status   = $2)
        ORDER BY ra.triggered_at DESC
        LIMIT $3
        "#,
        filters.store_id,
        filters.status,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── acknowledge_reorder_alert ─────────────────────────────────────────────────

#[tauri::command]
pub async fn acknowledge_reorder_alert(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<ReorderAlert> {
    let claims = guard_permission(&state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;

    let status: String = sqlx::query_scalar!(
        "SELECT status FROM reorder_alerts WHERE id = $1", id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Reorder alert {id} not found")))?;

    if status != "pending" {
        return Err(AppError::Validation(
            format!("Alert is already '{status}' — only pending alerts can be acknowledged"),
        ));
    }

    sqlx::query!(
        r#"UPDATE reorder_alerts
           SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = NOW()
           WHERE id = $2"#,
        claims.user_id, id,
    )
    .execute(&pool)
    .await?;

    fetch_alert(&pool, id).await
}

// ── link_po_to_alert ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn link_po_to_alert(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
    po_id: i32,
) -> AppResult<ReorderAlert> {
    guard_permission(&state, &token, "inventory.adjust").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        "UPDATE reorder_alerts SET status = 'ordered', linked_po_id = $1 WHERE id = $2",
        po_id, id,
    )
    .execute(&pool)
    .await?;

    fetch_alert(&pool, id).await
}

// ── helper ────────────────────────────────────────────────────────────────────

async fn fetch_alert(pool: &sqlx::PgPool, id: i32) -> AppResult<ReorderAlert> {
    sqlx::query_as!(
        ReorderAlert,
        r#"
        SELECT
            ra.id,
            ra.item_id         AS "item_id!: Uuid",
            ra.store_id,
            i.item_name,
            i.sku,
            COALESCE(c.category_name, 'Uncategorized') AS category_name,
            ra.triggered_at,
            ra.current_qty     AS "current_qty!: rust_decimal::Decimal",
            ra.min_stock_level AS "min_stock_level!: rust_decimal::Decimal",
            ra.status,
            ra.linked_po_id,
            ra.acknowledged_by,
            ra.acknowledged_at,
            ra.created_at
        FROM reorder_alerts ra
        JOIN items         i  ON i.id  = ra.item_id
        LEFT JOIN categories c ON c.id = i.category_id
        WHERE ra.id = $1
        "#,
        id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Reorder alert {id} not found")))
}
