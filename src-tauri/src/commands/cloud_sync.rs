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
use crate::database::pool::create_cloud_pool;
use crate::database::sync::is_cloud_sync_enabled;

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
    /// db_url is intentionally omitted — it contains a password and must never
    /// be returned to the frontend. The frontend only needs url + anon_key.
    pub is_configured: bool,
    /// Whether the cloud DB pool is currently reachable.
    pub is_connected:  bool,
    /// True when credentials were embedded at build time (SUPABASE_DB_URL env).
    /// False = credentials came from user-configured settings.json.
    pub is_embedded:   bool,
}

#[derive(Debug, Serialize)]
pub struct SyncStatusResponse {
    pub pending:            i64,
    pub failed:             i64,
    pub synced_today:       i64,
    pub is_cloud_connected: bool,
    /// Background push/pull to Supabase — off by default (`app_config.cloud_sync_enabled`).
    pub cloud_sync_enabled: bool,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Save Supabase credentials, persist them to settings.json, then attempt to
/// connect. If the host is unreachable right now the config is still saved —
/// the background sync worker will retry every 5 seconds.
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

    // ── Persist to settings.json (via stored AppHandle) ───────────────────────
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
        } else {
            tracing::warn!("AppHandle not yet set — Supabase config will not persist across restarts.");
        }
    }

    // ── Store config in AppState immediately ──────────────────────────────────
    {
        let mut cfg_guard = state.supabase_config.write().await;
        *cfg_guard = Some(config.clone());
    }

    // ── Try to connect — non-fatal if unreachable right now ───────────────────
    let is_connected = match create_cloud_pool(&config.db_url).await {
        Ok(cloud_pool) => {
            let mut cloud_guard = state.cloud_db.lock().await;
            *cloud_guard = Some(cloud_pool);
            tracing::info!("Supabase cloud DB connected.");
            true
        }
        Err(e) => {
            tracing::warn!(
                "Supabase cloud connect failed ({}). Config saved — sync worker will retry.",
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
        is_embedded:   false, // user-configured, not embedded
    })
}

/// Disconnect and clear the current Supabase configuration.
#[tauri::command]
pub async fn clear_supabase_config(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<()> {
    guard_permission(&state, &token, "settings.update").await?;

    // Remove from settings.json
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
    // Any authenticated user can retrieve the anon key — it's a public key
    let _ = crate::commands::auth::guard(&state, &token).await?;

    let cfg_guard   = state.supabase_config.read().await;
    let is_conn     = state.cloud_pool().await.is_some();

    Ok(cfg_guard.as_ref().map(|c| SupabaseConfigResponse {
        url:           c.url.clone(),
        anon_key:      c.anon_key.clone(),
        is_configured: !c.url.is_empty() && !c.db_url.is_empty(),
        is_connected:  is_conn,
        is_embedded:   crate::EMBEDDED_SUPABASE_DB_URL.is_some(),
    }))
}

/// Return current sync queue statistics.
#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<SyncStatusResponse> {
    guard_permission(&state, &token, "settings.read").await?;
    let pool = state.pool().await?;

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
        "SELECT COUNT(*) FROM sync_queue WHERE status = 'synced' AND synced_at >= CURRENT_DATE"
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let is_cloud_connected = state.cloud_pool().await.is_some();
    let cloud_sync_enabled = is_cloud_sync_enabled(&pool).await;

    Ok(SyncStatusResponse {
        pending,
        failed,
        synced_today,
        is_cloud_connected,
        cloud_sync_enabled,
    })
}

/// Persist whether background cloud replication is allowed (`app_config.cloud_sync_enabled`).
/// This flag gates the push worker (sync_queue → Supabase) and the pull worker
/// (Supabase → local). It does NOT affect onboarding read paths — those call the
/// cloud pool directly and are always available when credentials are configured.
#[tauri::command]
pub async fn set_cloud_sync_enabled(
    state:   State<'_, AppState>,
    token:   String,
    enabled: bool,
) -> AppResult<()> {
    guard_permission(&state, &token, "settings.update").await?;
    let pool = state.pool().await?;
    let val = if enabled { "true" } else { "false" };
    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('cloud_sync_enabled', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        val,
    )
    .execute(&pool)
    .await?;
    tracing::info!("cloud_sync_enabled set to {enabled} by authenticated user.");
    Ok(())
}

/// Backfill the sync_queue with any local rows that haven't been queued yet.
/// Call this once after a fresh install, a migration, or a sync reset.
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
        "UPDATE sync_queue SET status = 'pending', retries = 0, error = NULL WHERE status = 'failed'"
    )
    .execute(&pool)
    .await?
    .rows_affected();

    Ok(serde_json::json!({ "retried": affected }))
}
