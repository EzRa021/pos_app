// ============================================================================
// PIN-BASED POS SECURITY & SESSION MANAGEMENT
// ============================================================================

use tauri::State;
use chrono::{Utc, Duration};
use crate::{
    error::{AppError, AppResult},
    models::security::{ActiveSession, SetPinDto, VerifyPinDto},
    state::AppState,
    utils::crypto::hash_password,
};
use super::auth::guard_permission;

// ── set_pos_pin ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_pos_pin(
    state:   State<'_, AppState>,
    token:   String,
    payload: SetPinDto,
) -> AppResult<serde_json::Value> {
    let claims = super::auth::guard(&state, &token).await?;
    let pool   = state.pool().await?;

    if payload.pin.len() != 4 || !payload.pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation("PIN must be exactly 4 numeric digits".into()));
    }

    let hash = hash_password(&payload.pin)?;
    sqlx::query!(
        "UPDATE users SET pos_pin_hash=$1, updated_at=NOW() WHERE id=$2",
        hash, claims.user_id,
    )
    .execute(&pool)
    .await?;

    Ok(serde_json::json!({ "success": true, "message": "PIN set successfully" }))
}

// ── verify_pos_pin ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn verify_pos_pin(
    state:   State<'_, AppState>,
    payload: VerifyPinDto,
) -> AppResult<serde_json::Value> {
    let pool = state.pool().await?;

    if payload.pin.len() != 4 || !payload.pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Unauthorized("Invalid PIN format".into()));
    }

    let user = sqlx::query!(
        r#"SELECT id, pos_pin_hash, is_active, failed_login_count, locked_until, username
           FROM users WHERE id=$1"#,
        payload.user_id,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    if !user.is_active {
        return Err(AppError::Unauthorized("Account is inactive".into()));
    }
    if let Some(locked_until) = user.locked_until {
        if locked_until > Utc::now() {
            return Err(AppError::Unauthorized(format!(
                "Account locked until {}", locked_until.format("%H:%M")
            )));
        }
    }

    let pin_hash = user.pos_pin_hash.as_deref()
        .ok_or_else(|| AppError::Unauthorized("No PIN set — please set a PIN first".into()))?;

    let valid = crate::utils::crypto::verify_password(&payload.pin, pin_hash).unwrap_or(false);
    if !valid {
        sqlx::query!(
            r#"UPDATE users SET
               failed_login_count = failed_login_count + 1,
               locked_until = CASE WHEN failed_login_count + 1 >= 5
                   THEN NOW() + INTERVAL '30 minutes' ELSE locked_until END
               WHERE id=$1"#,
            user.id,
        )
        .execute(&pool)
        .await?;
        return Err(AppError::Unauthorized("Incorrect PIN".into()));
    }

    sqlx::query!("UPDATE users SET failed_login_count=0, locked_until=NULL WHERE id=$1", user.id)
        .execute(&pool)
        .await?;

    let expiry    = Utc::now() + Duration::minutes(15);
    let token_str = crate::utils::jwt::create_token(
        user.id, &user.username, expiry, &state.jwt_secret,
    )?;

    // Register session in active_sessions
    sqlx::query!(
        r#"INSERT INTO active_sessions (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (token_hash) DO NOTHING"#,
        user.id,
        crate::utils::crypto::hash_string(&token_str),
        expiry,
    )
    .execute(&pool)
    .await
    .ok(); // non-fatal

    Ok(serde_json::json!({
        "success":    true,
        "token":      token_str,
        "expires_at": expiry.to_rfc3339(),
        "user_id":    user.id,
    }))
}

// ── lock_pos_screen ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lock_pos_screen(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<serde_json::Value> {
    let claims = super::auth::guard(&state, &token).await?;
    let pool   = state.pool().await?;

    // Expire the session immediately
    let token_hash = crate::utils::crypto::hash_string(&token);
    sqlx::query!(
        "UPDATE active_sessions SET expires_at=NOW() WHERE token_hash=$1",
        token_hash,
    )
    .execute(&pool)
    .await
    .ok(); // non-fatal if session record doesn't exist

    // Also remove from in-memory sessions
    state.sessions.write().await.remove(&token);

    Ok(serde_json::json!({ "success": true, "locked": true, "user_id": claims.user_id }))
}

// ── get_active_sessions ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_active_sessions(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<Vec<ActiveSession>> {
    guard_permission(&state, &token, "users.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        ActiveSession,
        r#"SELECT s.id, s.user_id, u.username, s.store_id,
               s.device_info, s.ip_address,
               s.created_at, s.last_seen_at, s.expires_at
           FROM active_sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.expires_at > NOW()
             AND ($1::int IS NULL OR s.store_id=$1)
           ORDER BY s.last_seen_at DESC"#,
        store_id,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── revoke_session ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn revoke_session(
    state:      State<'_, AppState>,
    token:      String,
    session_id: i32,
) -> AppResult<serde_json::Value> {
    guard_permission(&state, &token, "users.update").await?;
    let pool = state.pool().await?;

    let affected = sqlx::query!(
        "UPDATE active_sessions SET expires_at=NOW() WHERE id=$1", session_id,
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound(format!("Session {session_id} not found")));
    }

    Ok(serde_json::json!({ "success": true, "revoked": session_id }))
}
