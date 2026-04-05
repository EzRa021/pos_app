// ============================================================================
// AUDIT COMMANDS
// ============================================================================

use tauri::State;
use serde::Deserialize;
use sqlx::PgPool;
use crate::{
    error::{AppError, AppResult},
    models::audit::{AuditLog, AuditFilters},
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::{guard, guard_permission};

// ── Internal helper — fire-and-forget, never fails the caller ─────────────────
pub(crate) async fn write_audit_log(
    pool:        &PgPool,
    user_id:     i32,
    store_id:    Option<i32>,
    action:      &str,
    resource:    &str,
    description: &str,
    severity:    &str,
) {
    let _ = sqlx::query!(
        r#"INSERT INTO audit_logs (user_id, store_id, action, resource, description, severity)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
        user_id,
        store_id,
        action,
        resource,
        description,
        severity,
    )
    .execute(pool)
    .await;
}

#[tauri::command]
pub async fn get_audit_logs(
    state:   State<'_, AppState>,
    token:   String,
    filters: AuditFilters,
) -> AppResult<PagedResult<AuditLog>> {
    guard_permission(&state, &token, "audit.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(50).clamp(1, 500);
    let offset = (page - 1) * limit;
    let df     = filters.date_from.as_deref();
    let dt     = filters.date_to.as_deref();

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM audit_logs
           WHERE ($1::int  IS NULL OR store_id  = $1)
             AND ($2::int  IS NULL OR user_id   = $2)
             AND ($3::text IS NULL OR action    = $3)
             AND ($4::text IS NULL OR resource  = $4)
             AND ($5::text IS NULL OR severity  = $5)
             AND ($6::text IS NULL OR created_at >= $6::timestamptz)
             AND ($7::text IS NULL OR created_at <= $7::timestamptz)"#,
        filters.store_id,
        filters.user_id,
        filters.action,
        filters.resource,
        filters.severity,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let logs = sqlx::query_as!(
        AuditLog,
        r#"SELECT al.id, al.user_id, u.username, al.action, al.resource,
                  al.description, al.details, al.ip_address, al.user_agent,
                  al.severity, al.created_at
           FROM   audit_logs al
           LEFT JOIN users u ON u.id = al.user_id
           WHERE ($1::int  IS NULL OR al.store_id  = $1)
             AND ($2::int  IS NULL OR al.user_id   = $2)
             AND ($3::text IS NULL OR al.action    = $3)
             AND ($4::text IS NULL OR al.resource  = $4)
             AND ($5::text IS NULL OR al.severity  = $5)
             AND ($6::text IS NULL OR al.created_at >= $6::timestamptz)
             AND ($7::text IS NULL OR al.created_at <= $7::timestamptz)
           ORDER BY al.created_at DESC
           LIMIT $8 OFFSET $9"#,
        filters.store_id,
        filters.user_id,
        filters.action,
        filters.resource,
        filters.severity,
        df,
        dt,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(logs, total, page, limit))
}

// ── get_audit_log_entry ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_audit_log_entry(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<AuditLog> {
    guard_permission(&state, &token, "audit.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        AuditLog,
        r#"SELECT al.id, al.user_id, u.username, al.action, al.resource,
                  al.description, al.details, al.ip_address, al.user_agent,
                  al.severity, al.created_at
           FROM audit_logs al
           LEFT JOIN users u ON u.id = al.user_id
           WHERE al.id = $1"#,
        id,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Audit log entry {id} not found")))
}

// ── log_action ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LogActionPayload {
    pub store_id:    Option<i32>,
    pub action:      String,
    pub resource:    String,
    pub description: Option<String>,
    pub severity:    Option<String>,
}

#[tauri::command]
pub async fn log_action(
    state:   State<'_, AppState>,
    token:   String,
    payload: LogActionPayload,
) -> AppResult<()> {
    let claims = guard(&state, &token).await?;
    let pool   = state.pool().await?;

    sqlx::query!(
        r#"INSERT INTO audit_logs (store_id, user_id, action, resource, description, severity)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6,'info'))"#,
        payload.store_id,
        claims.user_id,
        payload.action,
        payload.resource,
        payload.description,
        payload.severity,
    )
    .execute(&pool)
    .await?;

    Ok(())
}
