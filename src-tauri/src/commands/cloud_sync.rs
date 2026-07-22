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
    /// The binary ships built-in default credentials (compile-time .env).
    pub is_embedded:   bool,
    /// The user has saved their own credentials, which override the embedded
    /// defaults (settings.json wins over .env since the priority fix).
    pub is_override:   bool,
}

#[derive(Debug, Serialize)]
pub struct SyncStatusResponse {
    pub pending:            i64,
    pub failed:             i64,
    pub synced_today:       i64,
    pub conflicts:          i64,
    pub is_cloud_connected: bool,
    pub cloud_sync_enabled: bool,
    pub last_synced_at:     Option<String>,
    /// Most recently completed sync_queue rows (newest first) so the panel
    /// can show a live "recent activity" feed, not just counters.
    pub recent:             Vec<RecentSyncRow>,
}

#[derive(Debug, Serialize)]
pub struct RecentSyncRow {
    pub table_name: String,
    pub operation:  String,
    pub row_id:     String,
    pub synced_at:  Option<String>,
}

/// One row-level outcome from the sync_event_log event log (migration 0105).
///
/// `cycle_id` groups every row processed in a single worker pass, so the UI can
/// collapse "pushed 40 rows" into one expandable entry instead of 40 lines.
#[derive(Debug, Serialize)]
pub struct SyncLogRow {
    pub id:           i64,
    pub cycle_id:     String,
    pub direction:    String,
    pub table_name:   String,
    pub row_id:       Option<String>,
    pub operation:    Option<String>,
    pub outcome:      String,
    pub error_code:   Option<String>,
    pub error_detail: Option<String>,
    pub duration_ms:  Option<i32>,
    pub attempt:      i32,
    pub created_at:   Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncLogResponse {
    pub entries: Vec<SyncLogRow>,
    /// Total matching the filter, so the UI can show "showing 50 of 1,284".
    pub total:   i64,
}

/// One row from the sync_conflicts audit table (migration 0096), surfaced so
/// resolved conflicts are visible in Settings → Sync instead of only in logs.
#[derive(Debug, Serialize)]
pub struct SyncConflictRow {
    pub id:                  i64,
    pub table_name:          String,
    pub row_id:              String,
    pub direction:           String,
    pub incoming_version:    Option<i64>,
    pub current_version:     Option<i64>,
    pub resolution:          String,
    pub resolved_at:         Option<String>,
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
        db_url:   crate::database::sync::normalize_supabase_db_url(payload.db_url.trim()),
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

    // ── Sync-state reset after a successful (re)connect ───────────────────────
    // Previously nothing here was reset, so after switching to a new database
    // the panel kept showing the OLD database's failed rows/error and — because
    // the push worker only claims status='pending' — sync never started.
    if is_connected {
        if let Ok(pool) = state.pool().await {
            // 1. Rows that failed against the previous DB (or previous code
            //    bugs) deserve a fresh attempt against this connection.
            match sqlx::query!(
                "UPDATE sync_queue
                 SET status = 'pending', retries = 0, error = NULL
                 WHERE status = 'failed'"
            )
            .execute(&pool)
            .await
            {
                Ok(r) if r.rows_affected() > 0 =>
                    tracing::info!("Sync reset: {} previously-failed rows re-queued.", r.rows_affected()),
                Ok(_)  => {}
                Err(e) => tracing::warn!("Sync reset: could not re-queue failed rows: {e}"),
            }

            // 2. Database-change detection + bookkeeping reset is centralized
            //    in ensure_cloud_identity (also called at startup, so switches
            //    made via .env/embedded credentials are covered too).
            crate::database::sync::ensure_cloud_identity(&pool, &config.db_url).await;

            // 3. Seed the (possibly empty) cloud DB without requiring the user
            //    to know the Backfill button exists. Dedupe-aware: only rows
            //    not already queued are added.
            if is_cloud_sync_enabled(&pool).await {
                match crate::database::sync::backfill_sync_queue(&pool).await {
                    Ok(n) if n > 0 => tracing::info!("Sync reset: backfill queued {n} rows."),
                    Ok(_)          => {}
                    Err(e)         => tracing::warn!("Sync reset: backfill failed: {e}"),
                }
            }
        }
    }

    Ok(SupabaseConfigResponse {
        url:           payload.url.trim().to_string(),
        anon_key:      payload.anon_key.trim().to_string(),
        is_configured: true,
        is_connected,
        is_embedded:   crate::EMBEDDED_SUPABASE_DB_URL.is_some(),
        is_override:   true,
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

    // With the settings-over-embedded priority, "clear" means "remove my
    // override". If the binary ships embedded defaults, fall back to them and
    // reconnect — a dead None state would contradict what the next restart
    // does anyway (startup would pick the embedded defaults back up).
    if let Some(db_url) = crate::EMBEDDED_SUPABASE_DB_URL {
        let embedded = SupabaseConfig {
            url:      crate::EMBEDDED_SUPABASE_URL.unwrap_or_default().to_string(),
            anon_key: crate::EMBEDDED_SUPABASE_ANON_KEY.unwrap_or_default().to_string(),
            db_url:   db_url.to_string(),
        };
        {
            let mut cfg_guard = state.supabase_config.write().await;
            *cfg_guard = Some(embedded.clone());
        }
        match create_cloud_pool_with_migrations(&embedded.db_url).await {
            Ok(pool) => {
                *state.cloud_db.lock().await = Some(pool);
                tracing::info!("Supabase override cleared — reverted to embedded credentials.");
            }
            Err(e) => {
                *state.cloud_db.lock().await = None;
                tracing::warn!("Reverted to embedded credentials but connect failed: {e}");
            }
        }
    } else {
        {
            let mut cloud_guard = state.cloud_db.lock().await;
            *cloud_guard = None;
        }
        {
            let mut cfg_guard = state.supabase_config.write().await;
            *cfg_guard = None;
        }
        tracing::info!("Supabase cloud sync disconnected and config cleared.");
    }
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

    // A saved settings.json entry means the user has overridden the embedded
    // defaults — the panel needs this to render the credentials form truthfully.
    let is_override = {
        let handle_guard = state.app_handle.lock().await;
        handle_guard
            .as_ref()
            .and_then(|h| h.store(STORE_FILE).ok())
            .and_then(|s| s.get(SUPABASE_CFG_KEY))
            .is_some()
    };

    Ok(cfg_guard.as_ref().map(|c| SupabaseConfigResponse {
        url:           c.url.clone(),
        anon_key:      c.anon_key.clone(),
        is_configured: !c.url.is_empty() && !c.db_url.is_empty(),
        is_connected:  is_conn,
        is_embedded:   crate::EMBEDDED_SUPABASE_DB_URL.is_some(),
        is_override,
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

    let conflicts: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM sync_conflicts")
        .fetch_one(&pool)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

    let recent: Vec<RecentSyncRow> = sqlx::query!(
        r#"SELECT table_name, operation, row_id, synced_at::text AS synced_at
           FROM sync_queue
           WHERE status = 'synced' AND synced_at IS NOT NULL
           ORDER BY synced_at DESC
           LIMIT 8"#
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|r| RecentSyncRow {
        table_name: r.table_name,
        operation:  r.operation,
        row_id:     r.row_id,
        synced_at:  r.synced_at,
    })
    .collect();

    Ok(SyncStatusResponse {
        pending,
        failed,
        synced_today,
        conflicts,
        is_cloud_connected,
        cloud_sync_enabled,
        last_synced_at,
        recent,
    })
}

/// Query the sync event log (migration 0105).
///
/// All filters are optional and applied server-side; passing None for every
/// filter returns the newest entries across both directions. The
/// `($n::text IS NULL OR col = $n)` form keeps this a compile-time-checked
/// `query!` while still being dynamic.
#[tauri::command]
pub async fn get_sync_log(
    state:      State<'_, AppState>,
    token:      String,
    direction:  Option<String>,
    outcome:    Option<String>,
    table_name: Option<String>,
    limit:      Option<i64>,
    offset:     Option<i64>,
) -> AppResult<SyncLogResponse> {
    guard_permission(&state, &token, "settings.read").await?;
    let pool = state.pool().await?;

    // Clamp so a malformed client can't ask for the entire table.
    let limit  = limit.unwrap_or(100).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM sync_event_log
            WHERE ($1::text IS NULL OR direction  = $1)
              AND ($2::text IS NULL OR outcome    = $2)
              AND ($3::text IS NULL OR table_name = $3)"#,
        direction,
        outcome,
        table_name,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let rows = sqlx::query!(
        r#"SELECT id, cycle_id, direction, table_name, row_id, operation,
                  outcome, error_code, error_detail, duration_ms, attempt,
                  created_at::text AS created_at
             FROM sync_event_log
            WHERE ($1::text IS NULL OR direction  = $1)
              AND ($2::text IS NULL OR outcome    = $2)
              AND ($3::text IS NULL OR table_name = $3)
            ORDER BY created_at DESC, id DESC
            LIMIT $4 OFFSET $5"#,
        direction,
        outcome,
        table_name,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(SyncLogResponse {
        total,
        entries: rows
            .into_iter()
            .map(|r| SyncLogRow {
                id:           r.id,
                cycle_id:     r.cycle_id.to_string(),
                direction:    r.direction,
                table_name:   r.table_name,
                row_id:       r.row_id,
                operation:    r.operation,
                outcome:      r.outcome,
                error_code:   r.error_code,
                error_detail: r.error_detail,
                duration_ms:  r.duration_ms,
                attempt:      r.attempt,
                created_at:   r.created_at,
            })
            .collect(),
    })
}

/// Distinct table names present in the log, for populating the filter dropdown
/// with only the tables that actually have activity.
#[tauri::command]
pub async fn get_sync_log_tables(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Vec<String>> {
    guard_permission(&state, &token, "settings.read").await?;
    let pool = state.pool().await?;

    Ok(sqlx::query_scalar!(
        "SELECT DISTINCT table_name FROM sync_event_log ORDER BY table_name"
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default())
}

/// Return the most recent resolved sync conflicts (audit log, migration 0096).
#[tauri::command]
pub async fn get_sync_conflicts(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Vec<SyncConflictRow>> {
    guard_permission(&state, &token, "settings.read").await?;
    let pool = state.pool().await?;

    let rows = sqlx::query!(
        r#"SELECT id, table_name, row_id, direction,
                  incoming_version, current_version,
                  resolution, resolved_at::text AS resolved_at
           FROM sync_conflicts
           ORDER BY resolved_at DESC
           LIMIT 20"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| SyncConflictRow {
            id:               r.id,
            table_name:       r.table_name,
            row_id:           r.row_id,
            direction:        r.direction,
            incoming_version: r.incoming_version,
            current_version:  r.current_version,
            resolution:       r.resolution,
            resolved_at:      r.resolved_at,
        })
        .collect())
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
