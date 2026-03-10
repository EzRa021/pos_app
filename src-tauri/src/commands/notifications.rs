// ============================================================================
// NOTIFICATIONS
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::notification::{Notification, CreateNotificationDto, NotificationFilters},
    state::AppState,
};
use super::auth::guard_permission;

// ── create_notification ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_notification(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateNotificationDto,
) -> AppResult<Notification> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;
    insert_notification(&pool, payload).await
}

/// Internal helper — push a notification without a token (from other commands).
pub(crate) async fn push_notification(
    pool:    &sqlx::PgPool,
    payload: CreateNotificationDto,
) -> AppResult<Notification> {
    insert_notification(pool, payload).await
}

// ── get_notifications ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_notifications(
    state:   State<'_, AppState>,
    token:   String,
    filters: NotificationFilters,
) -> AppResult<Vec<Notification>> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool  = state.pool().await?;
    let limit = filters.limit.unwrap_or(50).clamp(1, 500);

    sqlx::query_as!(
        Notification,
        r#"SELECT id, store_id, user_id, type, title, message,
                  reference_type, reference_id, is_read, created_at
           FROM notifications
           WHERE store_id = $1
             AND ($2::int  IS NULL OR user_id  = $2 OR user_id IS NULL)
             AND ($3::bool IS NULL OR is_read != $3)
             AND ($4::text IS NULL OR type = $4)
           ORDER BY created_at DESC
           LIMIT $5"#,
        filters.store_id,
        filters.user_id,
        filters.unread,
        filters.r#type,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── get_unread_count ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_unread_count(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    user_id:  Option<i32>,
) -> AppResult<serde_json::Value> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;

    let count: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM notifications
           WHERE store_id = $1
             AND is_read  = FALSE
             AND ($2::int IS NULL OR user_id = $2 OR user_id IS NULL)"#,
        store_id,
        user_id,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    Ok(serde_json::json!({ "unread_count": count }))
}

// ── mark_notification_read ────────────────────────────────────────────────────

#[tauri::command]
pub async fn mark_notification_read(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Notification> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;

    sqlx::query!("UPDATE notifications SET is_read = TRUE WHERE id = $1", id)
        .execute(&pool)
        .await?;

    sqlx::query_as!(
        Notification,
        r#"SELECT id, store_id, user_id, type, title, message,
                  reference_type, reference_id, is_read, created_at
           FROM notifications WHERE id = $1"#,
        id,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Notification {id} not found")))
}

// ── mark_all_notifications_read ───────────────────────────────────────────────

#[tauri::command]
pub async fn mark_all_notifications_read(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    user_id:  Option<i32>,
) -> AppResult<serde_json::Value> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;

    let affected = sqlx::query!(
        r#"UPDATE notifications SET is_read = TRUE
           WHERE store_id = $1 AND is_read = FALSE
             AND ($2::int IS NULL OR user_id = $2 OR user_id IS NULL)"#,
        store_id,
        user_id,
    )
    .execute(&pool)
    .await?
    .rows_affected();

    Ok(serde_json::json!({ "marked_read": affected }))
}

// ── helper ────────────────────────────────────────────────────────────────────

async fn insert_notification(
    pool:    &sqlx::PgPool,
    payload: CreateNotificationDto,
) -> AppResult<Notification> {
    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO notifications
               (store_id, user_id, type, title, message, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id"#,
        payload.store_id,
        payload.user_id,
        payload.r#type,
        payload.title,
        payload.message,
        payload.reference_type,
        payload.reference_id,
    )
    .fetch_one(pool)
    .await?;

    sqlx::query_as!(
        Notification,
        r#"SELECT id, store_id, user_id, type, title, message,
                  reference_type, reference_id, is_read, created_at
           FROM notifications WHERE id = $1"#,
        id,
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}
