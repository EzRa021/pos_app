// ============================================================================
// APP COMMANDS
// ============================================================================
// Database setup, connection test, app metadata.
// ============================================================================

use tauri::State;
use serde::Serialize;
use tauri_plugin_store::StoreExt;
use crate::{
    database::pool::{create_pool, ping},
    error::AppResult,
    state::{AppState, DbConfig},
};

const STORE_FILE:  &str = "settings.json";
const DB_CFG_KEY:  &str = "db_config";

// ── DB Connect ────────────────────────────────────────────────────────────────

/// Called from the frontend DatabaseSetup screen.
/// Creates the pool, runs all pending migrations, persists the config so the
/// app can auto-reconnect on the next launch without showing the setup wizard.
#[tauri::command]
pub async fn db_connect(
    app:    tauri::AppHandle,
    state:  State<'_, AppState>,
    config: DbConfig,
) -> AppResult<DbConnectResult> {
    tracing::info!(
        "db_connect called for {}:{}/{}",
        config.host, config.port, config.database
    );

    let pool = create_pool(&config).await?;

    // ── Persist config for auto-connect on next startup ───────────────────────
    // The password is stored in plaintext in a local OS-managed app-data file.
    // This is acceptable for a desktop POS (same model as any desktop DB client).
    match app.store(STORE_FILE) {
        Ok(store) => {
            match serde_json::to_value(&config) {
                Ok(val) => {
                    store.set(DB_CFG_KEY, val);
                    if let Err(e) = store.save() {
                        tracing::warn!("Could not persist DB config: {e}");
                    }
                }
                Err(e) => tracing::warn!("Could not serialize DB config: {e}"),
            }
        }
        Err(e) => tracing::warn!("Could not open settings store: {e}"),
    }

    // ── Store pool in AppState ────────────────────────────────────────────────
    {
        let mut guard = state.db.lock().await;
        *guard = Some(pool);
    } // release lock before async calls below

    // ── Cache business_id so triggers + handlers have it in-memory ────────────
    if let Ok(pool) = state.pool().await {
        state.load_business_id(&pool).await;
    }

    Ok(DbConnectResult {
        success: true,
        message: format!("Connected to {}:{}/{}", config.host, config.port, config.database),
    })
}

#[derive(Debug, Serialize)]
pub struct DbConnectResult {
    pub success: bool,
    pub message: String,
}

// ── DB Disconnect ─────────────────────────────────────────────────────────────

/// Drop the active pool and clear the persisted config so the next launch
/// shows the setup wizard again (useful for switching databases).
#[tauri::command]
pub async fn db_disconnect(
    app:   tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut guard = state.db.lock().await;
    *guard = None;

    if let Ok(store) = app.store(STORE_FILE) {
        store.delete(DB_CFG_KEY);
        let _ = store.save();
    }

    tracing::info!("Disconnected from database and cleared saved config.");
    Ok(())
}

// ── DB Status ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_status(state: State<'_, AppState>) -> AppResult<DbStatusResult> {
    let guard = state.db.lock().await;
    match guard.as_ref() {
        None => Ok(DbStatusResult { connected: false, latency_ms: None }),
        Some(pool) => {
            let start = std::time::Instant::now();
            let ok    = ping(pool).await;
            Ok(DbStatusResult {
                connected:  ok,
                latency_ms: Some(start.elapsed().as_millis() as u64),
            })
        }
    }
}

#[derive(Debug, Serialize)]
pub struct DbStatusResult {
    pub connected:  bool,
    pub latency_ms: Option<u64>,
}

// ── App Info ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn app_name() -> String {
    env!("CARGO_PKG_NAME").to_string()
}

// ── Network Info ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

#[tauri::command]
pub async fn find_available_port(preferred: u16) -> u16 {
    for port in preferred..=65535 {
        if tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
            .await
            .is_ok()
        {
            return port;
        }
    }
    preferred
}
