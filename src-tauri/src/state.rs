// ============================================================================
// APPLICATION STATE
// ============================================================================
// Shared state injected into every Tauri command via tauri::State<'_, AppState>
// ============================================================================

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicU16;
use tokio::sync::{Mutex, RwLock};
use sqlx::PgPool;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Session Data ──────────────────────────────────────────────────────────────
/// In-memory session entry; keyed by the JWT access token string.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub user_id:    i32,
    pub username:   String,
    pub email:      String,
    pub role_id:    i32,
    pub role_slug:  String,
    pub store_id:   Option<i32>,
    pub is_global:  bool,
    pub created_at: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

// ── Database Config (persisted via tauri-plugin-store) ────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbConfig {
    pub host:     String,
    pub port:     u16,
    pub username: String,
    pub password: String,
    pub database: String,
}

// ── Application State ─────────────────────────────────────────────────────────
// All fields are Arc-wrapped so Clone is cheap — used to share state between
// the Tauri command layer and the Axum HTTP server task.
#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL connection pool. Wrapped in Option because the DB is not
    /// connected until the user completes the setup screen.
    pub db: Arc<Mutex<Option<PgPool>>>,

    /// JWT signing secret loaded from the store on startup (or generated).
    pub jwt_secret: Arc<String>,

    /// In-memory session map: token → SessionData.
    pub sessions: Arc<RwLock<HashMap<String, SessionData>>>,

    /// The port the Axum HTTP server is listening on (0 = not started yet).
    pub api_port: Arc<AtomicU16>,

    /// Permission cache: role_id → Vec<permission_slug>.
    /// Populated on first permission check for a role; invalidated when
    /// set_role_permissions is called. Avoids a DB round-trip per RPC call.
    pub permissions_cache: Arc<RwLock<HashMap<i32, Vec<String>>>>,
}

impl AppState {
    pub fn new(jwt_secret: String) -> Self {
        Self {
            db:                Arc::new(Mutex::new(None)),
            jwt_secret:        Arc::new(jwt_secret),
            sessions:          Arc::new(RwLock::new(HashMap::new())),
            api_port:          Arc::new(AtomicU16::new(0)),
            permissions_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Convenience: get a clone of the pool or return AppError::NotConnected.
    pub async fn pool(&self) -> crate::error::AppResult<PgPool> {
        let guard = self.db.lock().await;
        guard
            .clone()
            .ok_or(crate::error::AppError::NotConnected)
    }
}
