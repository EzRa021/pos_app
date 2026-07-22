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

    // Auto-resolve alerts whose stock has recovered above the reorder point.
    // Without this, a pending alert would linger forever after the item was
    // restocked, permanently inflating the notification-bell badge. This runs on
    // every post-sale check (usePos calls check_reorder_alerts after each sale),
    // so the pending count stays self-correcting with no manual "resolve" step.
    sqlx::query!(
        r#"UPDATE reorder_alerts ra
           SET status = 'resolved'
           FROM item_stock istock, item_settings ist
           WHERE ra.store_id = $1
             AND ra.status IN ('pending', 'acknowledged')
             AND istock.item_id = ra.item_id AND istock.store_id = ra.store_id
             AND ist.item_id = ra.item_id
             AND ist.min_stock_level IS NOT NULL
             AND istock.available_quantity > ist.min_stock_level::numeric"#,
        store_id,
    )
    .execute(&pool)
    .await?;

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

    // Queue any newly inserted alert rows to cloud sync
    if new_alerts > 0 {
        let new_rows = sqlx::query!(
            "SELECT id, item_id, store_id, current_qty, min_stock_level
             FROM reorder_alerts WHERE store_id = $1 AND status = 'pending'
             ORDER BY created_at DESC LIMIT $2",
            store_id,
            new_alerts as i64,
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        for row in new_rows {
            crate::database::sync::queue_row(
                &pool, "reorder_alerts", "INSERT", &row.id.to_string(),
                serde_json::json!({ "id": row.id, "item_id": row.item_id,
                                    "store_id": row.store_id,
                                    "current_qty": row.current_qty,
                                    "min_stock_level": row.min_stock_level,
                                    "status": "pending" }),
                Some(store_id),
            ).await;
        }
    }

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

