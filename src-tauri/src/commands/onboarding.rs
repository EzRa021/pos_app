// ============================================================================
// ONBOARDING COMMANDS
// ============================================================================
// Handles first-launch business setup. These functions are intentionally
// unauthenticated — they run before any user account exists on a fresh install.
//
// Onboarding phases:
//   Phase 1 — create_business        : inserts the business row + sets business_id
//   Phase 2 — setup_super_admin      : creates the owner account, then sets
//                                      super_admin_created + onboarding_complete
//
// Both phases must complete for onboarding to be considered done.
// Closing the app between phases resumes at Phase 2 on next launch.
//
// Exposed via /api/rpc as:
//   check_onboarding_status  → { complete, needs_super_admin, business_id, business_name }
//   create_business          → { id, name, business_type, currency, timezone }
//   setup_super_admin        → { id, username, first_name, last_name }
//   link_existing_business   → { id, name, business_type }
//   get_business_info        → { id, name, type, currency, timezone, ... }
//   update_business_info     → { id, name, ... }
// ============================================================================

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CheckBusinessResponse {
    pub exists: bool,
    pub name:   Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RestoreTableResult {
    pub table: String,
    pub rows:  i64,
}

#[derive(Debug, Serialize)]
pub struct RestoreResult {
    pub business_id: String,
    pub name:        String,
    pub tables:      Vec<RestoreTableResult>,
}

/// Returned by check_onboarding_status.
/// `complete`          — true only when both phases have finished.
/// `needs_super_admin` — business exists but admin account has not been created yet;
///                       the frontend should resume at Phase 2.
#[derive(Debug, Serialize)]
pub struct OnboardingStatus {
    pub complete:           bool,
    pub needs_super_admin:  bool,
    pub business_id:        Option<String>,
    pub business_name:      Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BusinessResponse {
    pub id:            String,
    pub name:          String,
    pub business_type: String,
    pub currency:      String,
    pub timezone:      String,
}

#[derive(Debug, Serialize)]
pub struct BusinessInfo {
    pub id:            String,
    pub name:          String,
    pub business_type: String,
    pub email:         Option<String>,
    pub phone:         Option<String>,
    pub address:       Option<String>,
    pub currency:      String,
    pub timezone:      String,
    pub logo_url:      Option<String>,
    pub logo_data:     Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SuperAdminResponse {
    pub id:         i32,
    pub username:   String,
    pub first_name: String,
    pub last_name:  String,
}

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateBusinessPayload {
    pub name:          String,
    pub business_type: String,
    pub email:         Option<String>,
    pub phone:         Option<String>,
    pub currency:      String,
    pub timezone:      String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBusinessPayload {
    pub name:          Option<String>,
    pub business_type: Option<String>,
    pub email:         Option<String>,
    pub phone:         Option<String>,
    pub address:       Option<String>,
    pub currency:      Option<String>,
    pub timezone:      Option<String>,
    pub logo_data:     Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetupSuperAdminPayload {
    pub first_name: String,
    pub last_name:  String,
    pub username:   String,
    pub email:      String,
    pub password:   String,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Check whether onboarding has been completed on this machine.
///
/// Possible states:
/// - `complete: true`                        → fully done, show login
/// - `complete: false, needs_super_admin: true`  → business created, resume admin step
/// - `complete: false, needs_super_admin: false` → fresh install, show welcome
pub async fn check_onboarding_status(pool: &PgPool) -> Result<OnboardingStatus, String> {
    // Fast path: onboarding_complete = 'true' means both phases finished.
    let complete_row = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'onboarding_complete'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if complete_row.as_deref() == Some("true") {
        return Ok(OnboardingStatus {
            complete:          true,
            needs_super_admin: false,
            business_id:       None,
            business_name:     None,
        });
    }

    // Check whether Phase 1 (business creation) has completed but Phase 2
    // (super admin creation) has not yet. This happens when the app is closed
    // between the two onboarding screens.
    let business_id_str = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'business_id'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let super_admin_done = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'super_admin_created'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .as_deref() == Some("true");

    match &business_id_str {
        Some(id_str) if !super_admin_done => {
            // Business exists but admin was never created — resume at Phase 2.
            let business_name = if let Ok(id) = id_str.parse::<Uuid>() {
                sqlx::query_scalar!("SELECT name FROM businesses WHERE id = $1", id)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                None
            };

            Ok(OnboardingStatus {
                complete:          false,
                needs_super_admin: true,
                business_id:       business_id_str,
                business_name,
            })
        }
        _ => {
            // Completely fresh — show the welcome screen.
            Ok(OnboardingStatus {
                complete:          false,
                needs_super_admin: false,
                business_id:       None,
                business_name:     None,
            })
        }
    }
}

/// Create a brand-new business on first launch (Phase 1).
///
/// NOTE: Does NOT set `onboarding_complete`. That flag is only set after
/// `setup_super_admin` (Phase 2) succeeds, so a mid-flow app close will
/// correctly resume at the admin-creation screen on next launch.
pub async fn create_business(
    pool: &PgPool,
    cloud_pool: Option<&PgPool>,
    payload: CreateBusinessPayload,
) -> Result<BusinessResponse, String> {
    if payload.name.trim().is_empty() {
        return Err("Business name is required".to_string());
    }

    let id = Uuid::new_v4();

    sqlx::query!(
        r#"
        INSERT INTO businesses (id, name, type, email, phone, currency, timezone)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        id,
        payload.name.trim(),
        payload.business_type,
        payload.email.as_deref().filter(|s| !s.is_empty()),
        payload.phone.as_deref().filter(|s| !s.is_empty()),
        payload.currency,
        payload.timezone,
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Record the business_id locally — but do NOT mark onboarding_complete.
    // onboarding_complete is only set after setup_super_admin succeeds.
    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('business_id', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        id.to_string()
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Write to sync_log
    sqlx::query!(
        "INSERT INTO sync_log (business_id, event_type, message)
         VALUES ($1, 'business_created', 'New business created during onboarding')",
        id
    )
    .execute(pool)
    .await
    .ok(); // Non-fatal

    // ── Push business row to Supabase cloud (non-fatal, write operation) ────────────────────
    // Gated on cloud_sync_enabled: if the user has not opted into background
    // replication, we do not push during creation either. This is a WRITE path;
    // it is separate from the onboarding READ paths (check_business_exists,
    // restore_business_from_cloud) which bypass this flag entirely and always
    // call the cloud pool directly whenever credentials are configured.
    if let Some(cloud) = cloud_pool {
        if crate::database::sync::is_cloud_sync_enabled(pool).await {
            let _ = sqlx::query!(
                r#"INSERT INTO businesses (id, name, type, email, phone, currency, timezone)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (id) DO UPDATE SET
                       name     = EXCLUDED.name,
                       type     = EXCLUDED.type,
                       email    = EXCLUDED.email,
                       phone    = EXCLUDED.phone,
                       currency = EXCLUDED.currency,
                       timezone = EXCLUDED.timezone"#,
                id,
                payload.name.trim(),
                payload.business_type,
                payload.email.as_deref().filter(|s| !s.is_empty()),
                payload.phone.as_deref().filter(|s| !s.is_empty()),
                payload.currency,
                payload.timezone,
            )
            .execute(cloud)
            .await
            .inspect_err(|e| tracing::warn!("Cloud push for new business failed (non-fatal): {e}"));
        }
    }

    Ok(BusinessResponse {
        id:            id.to_string(),
        name:          payload.name,
        business_type: payload.business_type,
        currency:      payload.currency,
        timezone:      payload.timezone,
    })
}

/// Create (or update) the super-admin user account — Phase 2 of onboarding.
///
/// Gates:
///   - `business_id` must already exist in app_config (Phase 1 complete).
///   - `super_admin_created` must NOT be 'true' (not yet done).
///     If the user somehow got created but the flag was never written
///     (e.g. process killed), the UPSERT below will update their credentials.
///
/// On success, sets both `super_admin_created = 'true'` and
/// `onboarding_complete = 'true'`.
pub async fn setup_super_admin(
    pool:    &PgPool,
    payload: SetupSuperAdminPayload,
) -> Result<SuperAdminResponse, String> {
    // ── Gate 1: Phase 1 must have completed ──────────────────────────────────
    let business_id_exists = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'business_id'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .is_some();

    if !business_id_exists {
        return Err(
            "Business must be created before setting up the super admin account.".to_string()
        );
    }

    // ── Gate 2: not already done ─────────────────────────────────────────────
    let already_done = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'super_admin_created'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .as_deref() == Some("true");

    if already_done {
        return Err(
            "Super admin account has already been created. Please log in.".to_string()
        );
    }

    // ── Validate & hash password ─────────────────────────────────────────────
    crate::utils::crypto::validate_password(&payload.password)
        .map_err(|e| e)?;

    let hash = crate::utils::crypto::hash_password(&payload.password)
        .map_err(|e| e.to_string())?;

    // ── Resolve super_admin role id ──────────────────────────────────────────
    let role_id: i32 = sqlx::query_scalar!(
        "SELECT id FROM roles WHERE role_slug = 'super_admin'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| {
        "super_admin role not found. Ensure all migrations have run.".to_string()
    })?;

    // ── UPSERT the user ───────────────────────────────────────────────────────
    // ON CONFLICT handles the edge case where the INSERT succeeded but the
    // flag write below was interrupted by a crash — the user can re-run the
    // step and their credentials will simply be updated.
    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO users
               (username, email, password_hash, first_name, last_name, role_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)
           ON CONFLICT (username) DO UPDATE SET
               email         = EXCLUDED.email,
               password_hash = EXCLUDED.password_hash,
               first_name    = EXCLUDED.first_name,
               last_name     = EXCLUDED.last_name,
               role_id       = EXCLUDED.role_id,
               is_active     = TRUE,
               updated_at    = NOW()
           RETURNING id"#,
        payload.username.trim(),
        payload.email.trim(),
        hash,
        payload.first_name.trim(),
        payload.last_name.trim(),
        role_id,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to create super admin user: {e}"))?;

    // ── Mark Phase 2 done and seal onboarding ────────────────────────────────
    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('super_admin_created', 'true')
         ON CONFLICT (key) DO UPDATE SET value = 'true'"
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('onboarding_complete', 'true')
         ON CONFLICT (key) DO UPDATE SET value = 'true'"
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "Super admin '{}' created during onboarding (user id = {id})",
        payload.username.trim()
    );

    Ok(SuperAdminResponse {
        id,
        username:   payload.username.trim().to_string(),
        first_name: payload.first_name.trim().to_string(),
        last_name:  payload.last_name.trim().to_string(),
    })
}

/// Link this installation to an existing business by UUID.
/// Used when the business was previously created on another device.
pub async fn link_existing_business(
    pool: &PgPool,
    business_id_str: &str,
) -> Result<BusinessResponse, String> {
    let id = business_id_str
        .trim()
        .parse::<Uuid>()
        .map_err(|_| "Invalid Business ID format. Please enter a valid UUID.".to_string())?;

    // Check if the business exists locally
    let biz = sqlx::query!(
        "SELECT id, name, type as business_type, currency, timezone
         FROM businesses WHERE id = $1",
        id
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| {
        "Business not found on this device. Cloud sync must be configured to \
         pull data from another device. Please set up a new business instead.".to_string()
    })?;

    finalize_link(pool, &id).await?;

    sqlx::query!(
        "INSERT INTO sync_log (business_id, event_type, message)
         VALUES ($1, 'business_linked', 'Existing business linked during onboarding')",
        id
    )
    .execute(pool)
    .await
    .ok();

    Ok(BusinessResponse {
        id:            biz.id.to_string(),
        name:          biz.name,
        business_type: biz.business_type,
        currency:      biz.currency,
        timezone:      biz.timezone,
    })
}

/// Return full business profile (for Settings page and title bar).
pub async fn get_business_info(pool: &PgPool) -> Result<Option<BusinessInfo>, String> {
    let id_str = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'business_id'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let id = match id_str.as_deref().and_then(|s| s.parse::<Uuid>().ok()) {
        Some(id) => id,
        None => return Ok(None),
    };

    let row = sqlx::query!(
        r#"
        SELECT id, name, type as business_type, email, phone, address,
               currency, timezone, logo_url, logo_data
        FROM businesses WHERE id = $1
        "#,
        id
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.map(|r| BusinessInfo {
        id:            r.id.to_string(),
        name:          r.name,
        business_type: r.business_type,
        email:         r.email,
        phone:         r.phone,
        address:       r.address,
        currency:      r.currency,
        timezone:      r.timezone,
        logo_url:      r.logo_url,
        logo_data:     r.logo_data,
    }))
}

/// Check whether a business UUID exists in the cloud database.
///
/// NOTE: This is an onboarding READ path. It calls the cloud pool directly
/// and is intentionally NOT gated on `app_config.cloud_sync_enabled`.
/// The sync toggle controls only background replication, not user-initiated
/// onboarding lookups.
pub async fn check_business_exists(
    cloud_pool: &PgPool,
    business_id_str: &str,
) -> Result<CheckBusinessResponse, String> {
    let id = business_id_str
        .trim()
        .parse::<Uuid>()
        .map_err(|_| "Invalid Business ID format. Please enter a valid UUID.".to_string())?;

    let row = sqlx::query!(
        "SELECT name FROM businesses WHERE id = $1",
        id
    )
    .fetch_optional(cloud_pool)
    .await
    .map_err(|e| format!("Could not reach cloud database: {e}"))?;

    Ok(CheckBusinessResponse {
        exists: row.is_some(),
        name:   row.map(|r| r.name),
    })
}

/// Pull all master data for a business from Supabase and restore it into the
/// local PostgreSQL database.
///
/// NOTE: This is an onboarding READ path. It calls the cloud pool directly
/// and is intentionally NOT gated on `app_config.cloud_sync_enabled`.
/// The sync toggle controls only background replication, not the initial
/// data restore triggered by the user during onboarding.
pub async fn restore_business_from_cloud(
    local_pool: &PgPool,
    cloud_pool: &PgPool,
    business_id_str: &str,
) -> Result<RestoreResult, String> {
    let id = business_id_str
        .trim()
        .parse::<Uuid>()
        .map_err(|_| "Invalid Business ID format.".to_string())?;

    let mut tables: Vec<RestoreTableResult> = Vec::new();

    // ── 1. Business row ────────────────────────────────────────────────────────
    let biz_rows = pull_json_by_uuid(cloud_pool, "businesses", "id", &id).await?;
    let biz_name = biz_rows
        .first()
        .and_then(|v| v.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            "Business not found in cloud. Please verify the Business ID.".to_string()
        })?;

    let count = upsert_json_rows(local_pool, "businesses", &biz_rows).await;
    tables.push(RestoreTableResult { table: "businesses".to_string(), rows: count });

    // ── 2. Stores ──────────────────────────────────────────────────────────────
    let store_rows = pull_json_by_uuid(cloud_pool, "stores", "business_id", &id).await?;
    let store_ids: Vec<i32> = store_rows
        .iter()
        .filter_map(|v| v.get("id").and_then(|i| i.as_i64()).map(|i| i as i32))
        .collect();
    let count = upsert_json_rows(local_pool, "stores", &store_rows).await;
    tables.push(RestoreTableResult { table: "stores".to_string(), rows: count });

    // ── 3. Store-scoped master data ────────────────────────────────────────────
    if !store_ids.is_empty() {
        let store_tables = [
            "users",
            "departments",
            "categories",
            "tax_categories",
            "items",
            "item_stock",
            "customers",
            "suppliers",
        ];

        for table in &store_tables {
            match pull_json_by_store_ids(cloud_pool, table, &store_ids).await {
                Ok(rows) => {
                    let count = upsert_json_rows(local_pool, table, &rows).await;
                    tables.push(RestoreTableResult { table: table.to_string(), rows: count });
                }
                Err(e) => {
                    tracing::warn!("Cloud restore: could not pull {table}: {e}");
                    tables.push(RestoreTableResult { table: table.to_string(), rows: 0 });
                }
            }
        }
    }

    // ── 4. Finalise ────────────────────────────────────────────────────────────
    // For a restore flow, users already exist in the pulled data, so we mark
    // super_admin_created = 'true' as well so the gate in setup_super_admin
    // correctly reflects reality.
    finalize_link(local_pool, &id).await?;

    sqlx::query!(
        "INSERT INTO sync_log (business_id, event_type, message)
         VALUES ($1, 'business_restored', 'Business data restored from cloud during onboarding')",
        id
    )
    .execute(local_pool)
    .await
    .ok();

    Ok(RestoreResult {
        business_id: id.to_string(),
        name:        biz_name,
        tables,
    })
}

// ── Private helpers ────────────────────────────────────────────────────────────

async fn pull_json_by_uuid(
    pool:   &PgPool,
    table:  &str,
    column: &str,
    id:     &Uuid,
) -> Result<Vec<Value>, String> {
    let sql = format!("SELECT row_to_json(t.*) FROM {table} t WHERE t.{column} = $1");
    sqlx::query_scalar::<_, Value>(&sql)
        .bind(*id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to pull {table}: {e}"))
}

async fn pull_json_by_store_ids(
    pool:      &PgPool,
    table:     &str,
    store_ids: &[i32],
) -> Result<Vec<Value>, String> {
    if store_ids.is_empty() {
        return Ok(vec![]);
    }
    let sql = format!("SELECT row_to_json(t.*) FROM {table} t WHERE t.store_id = ANY($1)");
    sqlx::query_scalar::<_, Value>(&sql)
        .bind(store_ids)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to pull {table}: {e}"))
}

async fn upsert_json_rows(pool: &PgPool, table: &str, rows: &[Value]) -> i64 {
    let mut count = 0i64;
    for row in rows {
        let obj = match row.as_object() {
            Some(o) => o,
            None    => continue,
        };
        if obj.is_empty() {
            continue;
        }

        let cols: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("${i}")).collect();
        let updates: Vec<String> = cols
            .iter()
            .enumerate()
            .filter(|(_, c)| **c != "id")
            .map(|(i, c)| format!("{c} = ${}", i + 1))
            .collect();

        let stmt = if updates.is_empty() {
            format!(
                "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT (id) DO NOTHING",
                cols.join(", "),
                placeholders.join(", "),
            )
        } else {
            format!(
                "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT (id) DO UPDATE SET {}",
                cols.join(", "),
                placeholders.join(", "),
                updates.join(", "),
            )
        };

        let mut query = sqlx::query(&stmt);
        for key in &cols {
            let val = obj.get(*key).cloned().unwrap_or(Value::Null);
            query = query.bind(val);
        }

        match query.execute(pool).await {
            Ok(_)  => count += 1,
            Err(e) => tracing::warn!("upsert_json_rows: {table} row skipped: {e}"),
        }
    }
    count
}

/// Write app_config entries to mark this device as belonging to `id`.
/// Also marks super_admin_created so the Phase-2 gate is correctly bypassed
/// for restore/link flows where users already exist in the restored data.
async fn finalize_link(pool: &PgPool, id: &Uuid) -> Result<(), String> {
    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('business_id', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        id.to_string()
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Mark admin as created (users came from the restored data)
    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('super_admin_created', 'true')
         ON CONFLICT (key) DO UPDATE SET value = 'true'"
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('onboarding_complete', 'true')
         ON CONFLICT (key) DO UPDATE SET value = 'true'"
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Update the business profile (name, contact, currency, etc.)
pub async fn update_business_info(
    pool: &PgPool,
    payload: UpdateBusinessPayload,
) -> Result<BusinessInfo, String> {
    let id_str = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'business_id'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "No business configured on this device".to_string())?;

    let id = id_str
        .parse::<Uuid>()
        .map_err(|_| "Stored business_id is invalid".to_string())?;

    sqlx::query!(
        r#"
        UPDATE businesses SET
            name          = COALESCE($2, name),
            type          = COALESCE($3, type),
            email         = COALESCE($4, email),
            phone         = COALESCE($5, phone),
            address       = COALESCE($6, address),
            currency      = COALESCE($7, currency),
            timezone      = COALESCE($8, timezone),
            logo_data     = COALESCE($9, logo_data),
            updated_at    = now()
        WHERE id = $1
        "#,
        id,
        payload.name.as_deref(),
        payload.business_type.as_deref(),
        payload.email.as_deref(),
        payload.phone.as_deref(),
        payload.address.as_deref(),
        payload.currency.as_deref(),
        payload.timezone.as_deref(),
        payload.logo_data.as_deref(),
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    get_business_info(pool)
        .await?
        .ok_or_else(|| "Business not found after update".to_string())
}
