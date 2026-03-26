// ============================================================================
// ONBOARDING COMMANDS
// ============================================================================
// Handles first-launch business setup. These functions are intentionally
// unauthenticated — they run before any user account exists on a fresh install.
//
// Exposed via /api/rpc as:
//   check_onboarding_status  → { complete, business_id, business_name }
//   create_business          → { id, name, business_type }
//   link_existing_business   → { id, name, business_type }
//   get_business_info        → { id, name, type, currency, timezone, ... }
//   update_business_info     → { id, name, ... }
// ============================================================================

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct OnboardingStatus {
    pub complete:       bool,
    pub business_id:    Option<String>,
    pub business_name:  Option<String>,
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

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Check whether onboarding has been completed on this machine.
/// Returns the business name if available so the UI can display it immediately.
pub async fn check_onboarding_status(pool: &PgPool) -> Result<OnboardingStatus, String> {
    let complete_row = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'onboarding_complete'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let is_complete = complete_row.as_deref() == Some("true");

    if !is_complete {
        return Ok(OnboardingStatus {
            complete:      false,
            business_id:   None,
            business_name: None,
        });
    }

    let business_id_str = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'business_id'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let business_name = match &business_id_str {
        Some(id_str) => {
            if let Ok(id) = id_str.parse::<Uuid>() {
                sqlx::query_scalar!("SELECT name FROM businesses WHERE id = $1", id)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                None
            }
        }
        None => None,
    };

    Ok(OnboardingStatus {
        complete:      true,
        business_id:   business_id_str,
        business_name,
    })
}

/// Create a brand-new business on first launch.
/// Inserts the business row and seeds app_config so onboarding won't repeat.
pub async fn create_business(
    pool: &PgPool,
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

    // Seed app_config — upsert so re-runs are safe
    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('business_id', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        id.to_string()
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

    // Write to sync_log
    sqlx::query!(
        "INSERT INTO sync_log (business_id, event_type, message)
         VALUES ($1, 'business_created', 'New business created during onboarding')",
        id
    )
    .execute(pool)
    .await
    .ok(); // Non-fatal

    Ok(BusinessResponse {
        id:            id.to_string(),
        name:          payload.name,
        business_type: payload.business_type,
        currency:      payload.currency,
        timezone:      payload.timezone,
    })
}

/// Link this installation to an existing business by UUID.
/// Used when the business was previously created on another device.
/// Does NOT pull data from a remote DB (that requires cloud sync, not yet implemented).
/// It simply records the business_id locally so the app knows which business it belongs to.
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

    // Seed app_config
    sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('business_id', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        id.to_string()
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
