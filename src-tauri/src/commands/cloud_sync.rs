// ============================================================================
// CLOUD SYNC COMMANDS
// ============================================================================
// Tauri commands for configuring Supabase cloud sync and querying sync status.
// ============================================================================

use tauri::State;
use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;
use crate::{
    error::{AppError, AppResult},
    state::{AppState, SupabaseConfig},
};
use crate::commands::auth::guard_permission;
use crate::database::pool::create_cloud_pool_with_migrations;
use crate::database::sync::is_cloud_sync_enabled;
use uuid::Uuid;

const STORE_FILE:       &str = "settings.json";
const SUPABASE_CFG_KEY: &str = "supabase_config";

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveSupabaseConfigPayload {
    pub url:      String,
    pub anon_key: String,
    pub db_url:   String,
}

#[derive(Debug, Serialize)]
pub struct SupabaseConfigResponse {
    pub url:           String,
    pub anon_key:      String,
    pub is_configured: bool,
    pub is_connected:  bool,
    pub is_embedded:   bool,
}

#[derive(Debug, Serialize)]
pub struct SyncStatusResponse {
    pub pending:            i64,
    pub failed:             i64,
    pub synced_today:       i64,
    pub is_cloud_connected: bool,
    pub cloud_sync_enabled: bool,
    pub last_synced_at:     Option<String>,
}

/// A single failed sync_queue row surfaced to the frontend so the user can
/// see what failed and why without needing to read backend logs.
#[derive(Debug, Serialize)]
pub struct FailedSyncRow {
    pub id:         i64,   // sync_queue.id is BIGINT → i64
    pub table_name: String,
    pub operation:  String,
    pub row_id:     String,
    pub retries:    i32,   // retries is INT → i32
    pub error:      Option<String>,
}

// ── Helper ────────────────────────────────────────────────────────────────────

async fn load_biz_id(pool: &sqlx::PgPool) -> Option<Uuid> {
    sqlx::query_scalar!("SELECT value FROM app_config WHERE key = 'business_id'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|s| s.parse::<Uuid>().ok())
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Save Supabase credentials, persist them to settings.json, then connect
/// and automatically migrate the cloud schema.
///
/// Migrations run unconditionally — they are idempotent and fast when the
/// schema is already up to date. This guarantees the cloud DB is always in
/// sync with the binary regardless of how credentials were configured.
#[tauri::command]
pub async fn save_supabase_config(
    state:   State<'_, AppState>,
    token:   String,
    payload: SaveSupabaseConfigPayload,
) -> AppResult<SupabaseConfigResponse> {
    guard_permission(&state, &token, "settings.update").await?;

    if payload.url.trim().is_empty() || payload.db_url.trim().is_empty() {
        return Err(AppError::Validation("Supabase URL and DB URL are required".into()));
    }

    let config = SupabaseConfig {
        url:      payload.url.trim().to_string(),
        anon_key: payload.anon_key.trim().to_string(),
        db_url:   payload.db_url.trim().to_string(),
    };

    // ── Persist to settings.json ──────────────────────────────────────────────
    {
        let handle_guard = state.app_handle.lock().await;
        if let Some(ref handle) = *handle_guard {
            match handle.store(STORE_FILE) {
                Ok(store) => {
                    match serde_json::to_value(&config) {
                        Ok(val) => {
                            store.set(SUPABASE_CFG_KEY, val);
                            if let Err(e) = store.save() {
                                tracing::warn!("Could not persist Supabase config: {e}");
                            }
                        }
                        Err(e) => tracing::warn!("Could not serialize Supabase config: {e}"),
                    }
                }
                Err(e) => tracing::warn!("Could not open settings store: {e}"),
            }
        }
    }

    // ── Store config in AppState immediately ──────────────────────────────────
    {
        let mut cfg_guard = state.supabase_config.write().await;
        *cfg_guard = Some(config.clone());
    }

    // ── Connect AND auto-migrate the cloud schema ─────────────────────────────
    // Using create_cloud_pool_with_migrations (not create_cloud_pool) so the
    // schema is always consistent with the binary — no extra "run migrations"
    // step required from the user. Idempotent migrations make this safe.
    let is_connected = match create_cloud_pool_with_migrations(&config.db_url).await {
        Ok(cloud_pool) => {
            let mut cloud_guard = state.cloud_db.lock().await;
            *cloud_guard = Some(cloud_pool);
            tracing::info!("Supabase connected and schema migrated.");
            true
        }
        Err(e) => {
            tracing::warn!(
                "Supabase connect/migrate failed ({}). Config saved — sync worker will retry.",
                e
            );
            false
        }
    };

    Ok(SupabaseConfigResponse {
        url:           payload.url.trim().to_string(),
        anon_key:      payload.anon_key.trim().to_string(),
        is_configured: true,
        is_connected,
        is_embedded:   false,
    })
}

/// Disconnect and clear the current Supabase configuration.
#[tauri::command]
pub async fn clear_supabase_config(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<()> {
    guard_permission(&state, &token, "settings.update").await?;

    {
        let handle_guard = state.app_handle.lock().await;
        if let Some(ref handle) = *handle_guard {
            if let Ok(store) = handle.store(STORE_FILE) {
                store.delete(SUPABASE_CFG_KEY);
                let _ = store.save();
            }
        }
    }

    {
        let mut cloud_guard = state.cloud_db.lock().await;
        *cloud_guard = None;
    }
    {
        let mut cfg_guard = state.supabase_config.write().await;
        *cfg_guard = None;
    }

    tracing::info!("Supabase cloud sync disconnected and config cleared.");
    Ok(())
}

/// Return the Supabase URL and anon key so the frontend can initialise
/// the @supabase/supabase-js client for realtime subscriptions.
/// The db_url (contains password) is never returned.
#[tauri::command]
pub async fn get_supabase_config(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Option<SupabaseConfigResponse>> {
    let _ = crate::commands::auth::guard(&state, &token).await?;

    let cfg_guard = state.supabase_config.read().await;
    let is_conn   = state.cloud_pool().await.is_some();

    Ok(cfg_guard.as_ref().map(|c| SupabaseConfigResponse {
        url:           c.url.clone(),
        anon_key:      c.anon_key.clone(),
        is_configured: !c.url.is_empty() && !c.db_url.is_empty(),
        is_connected:  is_conn,
        is_embedded:   crate::EMBEDDED_SUPABASE_DB_URL.is_some(),
    }))
}

/// Return current sync queue statistics, filtered to the current business.
#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<SyncStatusResponse> {
    guard_permission(&state, &token, "settings.read").await?;
    let pool = state.pool().await?;

    let biz_id: Option<Uuid> = load_biz_id(&pool).await;

    let (pending, failed, synced_today, last_synced_at) = match biz_id {
        Some(bid) => {
            let pending: i64 = sqlx::query_scalar!(
                "SELECT COUNT(*) FROM sync_queue
                 WHERE status = 'pending'
                   AND (business_id = $1 OR business_id IS NULL)",
                bid,
            )
            .fetch_one(&pool)
            .await?
            .unwrap_or(0);

            let failed: i64 = sqlx::query_scalar!(
                "SELECT COUNT(*) FROM sync_queue
                 WHERE status = 'failed'
                   AND (business_id = $1 OR business_id IS NULL)",
                bid,
            )
            .fetch_one(&pool)
            .await?
            .unwrap_or(0);

            let synced_today: i64 = sqlx::query_scalar!(
                "SELECT COUNT(*) FROM sync_queue
                 WHERE status = 'synced'
                   AND synced_at >= CURRENT_DATE
                   AND (business_id = $1 OR business_id IS NULL)",
                bid,
            )
            .fetch_one(&pool)
            .await?
            .unwrap_or(0);

            let last_synced_at: Option<String> = sqlx::query_scalar!(
                "SELECT synced_at::text FROM sync_queue
                 WHERE status = 'synced'
                   AND synced_at >= CURRENT_DATE
                   AND (business_id = $1 OR business_id IS NULL)
                 ORDER BY synced_at DESC
                 LIMIT 1",
                bid,
            )
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
            .flatten();

            (pending, failed, synced_today, last_synced_at)
        }
        None => {
            let pending: i64 = sqlx::query_scalar!(
                "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'"
            )
            .fetch_one(&pool)
            .await?
            .unwrap_or(0);

            let failed: i64 = sqlx::query_scalar!(
                "SELECT COUNT(*) FROM sync_queue WHERE status = 'failed'"
            )
            .fetch_one(&pool)
            .await?
            .unwrap_or(0);

            let synced_today: i64 = sqlx::query_scalar!(
                "SELECT COUNT(*) FROM sync_queue
                 WHERE status = 'synced' AND synced_at >= CURRENT_DATE"
            )
            .fetch_one(&pool)
            .await?
            .unwrap_or(0);

            (pending, failed, synced_today, None)
        }
    };

    let is_cloud_connected = state.cloud_pool().await.is_some();
    let cloud_sync_enabled = is_cloud_sync_enabled(&pool).await;

    Ok(SyncStatusResponse {
        pending,
        failed,
        synced_today,
        is_cloud_connected,
        cloud_sync_enabled,
        last_synced_at,
    })
}

/// Enable or disable background cloud replication.
#[tauri::command]
pub async fn set_cloud_sync_enabled(
    state:   State<'_, AppState>,
    token:   String,
    enabled: bool,
) -> AppResult<()> {
    guard_permission(&state, &token, "settings.update").await?;
    let pool = state.pool().await?;
    let val  = if enabled { "true" } else { "false" };
    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('cloud_sync_enabled', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        val,
    )
    .execute(&pool)
    .await?;
    tracing::info!("cloud_sync_enabled set to {enabled}.");
    Ok(())
}

/// Backfill the sync_queue with any local rows that haven't been queued yet.
#[tauri::command]
pub async fn trigger_backfill_sync(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<serde_json::Value> {
    guard_permission(&state, &token, "settings.manage").await?;
    let pool = state.pool().await?;

    let queued = crate::database::sync::backfill_sync_queue(&pool)
        .await
        .map_err(AppError::from)?;

    Ok(serde_json::json!({ "queued": queued }))
}

/// Reset all 'failed' sync_queue rows back to 'pending' so they are retried.
#[tauri::command]
pub async fn retry_failed_sync(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<serde_json::Value> {
    guard_permission(&state, &token, "settings.manage").await?;
    let pool = state.pool().await?;

    let affected = sqlx::query!(
        "UPDATE sync_queue
         SET status = 'pending', retries = 0, error = NULL
         WHERE status = 'failed'"
    )
    .execute(&pool)
    .await?
    .rows_affected();

    Ok(serde_json::json!({ "retried": affected }))
}

/// Return the first 50 failed sync_queue rows with their error messages.
#[tauri::command]
pub async fn get_failed_sync_rows(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Vec<FailedSyncRow>> {
    guard_permission(&state, &token, "settings.read").await?;
    let pool = state.pool().await?;

    let rows = sqlx::query!(
        r#"SELECT id, table_name, operation, row_id, retries, error
           FROM sync_queue
           WHERE status = 'failed'
           ORDER BY retries DESC, id DESC
           LIMIT 50"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| FailedSyncRow {
            id:         r.id,
            table_name: r.table_name,
            operation:  r.operation,
            row_id:     r.row_id,
            retries:    r.retries,
            error:      r.error,
        })
        .collect())
}
