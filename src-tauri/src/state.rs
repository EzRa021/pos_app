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
use tauri::AppHandle;
use uuid::Uuid;

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

// ── Supabase Config (persisted alongside db_config) ───────────────────────────
/// Holds the project URL and anon key for Supabase cloud sync.
/// The anon key is safe to expose to the frontend (read-only realtime).
/// The service-role key is never stored here — only the anon key.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SupabaseConfig {
    /// e.g. "https://xyzcompany.supabase.co"
    pub url:      String,
    /// The public anon key (safe to expose to frontend)
    pub anon_key: String,
    /// PostgreSQL connection string for direct backend writes
    /// e.g. "postgresql://postgres.xyzcompany:password@aws-0-eu-west-2.pooler.supabase.com:6543/postgres"
    pub db_url:   String,
}

// ── Application State ─────────────────────────────────────────────────────────
// All fields are Arc-wrapped so Clone is cheap — used to share state between
// the Tauri command layer and the Axum HTTP server task.
#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL connection pool. Wrapped in Option because the DB is not
    /// connected until the user completes the setup screen.
    pub db: Arc<Mutex<Option<PgPool>>>,

    /// Supabase cloud pool for background sync replication.
    /// None until the user configures Supabase credentials.
    pub cloud_db: Arc<Mutex<Option<PgPool>>>,

    /// Supabase project config (URL + anon key + cloud DB URL).
    pub supabase_config: Arc<RwLock<Option<SupabaseConfig>>>,

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

    /// Tauri AppHandle — set once in setup(), used for plugin-store persistence.
    pub app_handle: Arc<Mutex<Option<AppHandle>>>,

    /// Cached business_id loaded from app_config after DB connects.
    /// Updated when a business is created or linked during onboarding.
    /// Used by handlers that need to stamp business_id on sync payloads.
    pub business_id: Arc<RwLock<Option<Uuid>>>,
}

impl AppState {
    pub fn new(jwt_secret: String) -> Self {
        Self {
            db:                Arc::new(Mutex::new(None)),
            cloud_db:          Arc::new(Mutex::new(None)),
            supabase_config:   Arc::new(RwLock::new(None)),
            jwt_secret:        Arc::new(jwt_secret),
            sessions:          Arc::new(RwLock::new(HashMap::new())),
            api_port:          Arc::new(AtomicU16::new(0)),
            permissions_cache: Arc::new(RwLock::new(HashMap::new())),
            app_handle:        Arc::new(Mutex::new(None)),
            business_id:       Arc::new(RwLock::new(None)),
        }
    }

    /// Store the AppHandle so commands called via HTTP (no Tauri injection)
    /// can still access tauri-plugin-store for persistence.
    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.lock().await = Some(handle);
    }

    /// Convenience: get a clone of the local pool or return AppError::NotConnected.
    pub async fn pool(&self) -> crate::error::AppResult<PgPool> {
        let guard = self.db.lock().await;
        guard
            .clone()
            .ok_or(crate::error::AppError::NotConnected)
    }

    /// Convenience: get the cloud pool if configured (None = not configured).
    pub async fn cloud_pool(&self) -> Option<PgPool> {
        self.cloud_db.lock().await.clone()
    }

    /// Returns the cached business UUID, or None if not yet onboarded.
    pub async fn get_business_id(&self) -> Option<Uuid> {
        *self.business_id.read().await
    }

    /// Load business_id from app_config and cache it in AppState.
    /// Called after db_connect succeeds and after create/link business.
    pub async fn load_business_id(&self, pool: &PgPool) {
        let result = sqlx::query_scalar!(
            "SELECT value FROM app_config WHERE key = 'business_id'"
        )
        .fetch_optional(pool)
        .await;

        match result {
            Ok(Some(id_str)) => {
                if let Ok(id) = id_str.parse::<Uuid>() {
                    *self.business_id.write().await = Some(id);
                    tracing::info!("business_id loaded into AppState: {id}");
                }
            }
            Ok(None) => tracing::debug!("No business_id in app_config yet"),
            Err(e)   => tracing::warn!("Failed to load business_id: {e}"),
        }
    }
}
