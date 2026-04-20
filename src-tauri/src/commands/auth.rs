// ============================================================================
// AUTH COMMANDS
// ============================================================================
// login · logout · refresh_token · verify_session · change_password
// ============================================================================

use tauri::State;
use chrono::Utc;
use crate::{
    error::{AppError, AppResult},
    models::auth::{LoginRequest, RefreshRequest, ChangePasswordRequest, TokenPair, AuthUser, UserAuthRow},
    state::{AppState, SessionData},
    utils::{
        jwt::{encode_access_token, encode_refresh_token, decode_token, access_expiry_secs},
        crypto::{verify_password, hash_password, validate_password},
    },
};
use super::audit::write_audit_log;

// ── LOGIN ─────────────────────────────────────────────────────────────────────

/// Inner function — shared between the Tauri command and the HTTP API handler.
pub(crate) async fn login_inner(state: &AppState, payload: LoginRequest) -> AppResult<TokenPair> {
    let pool = state.pool().await?;

    let row = sqlx::query_as!(
        UserAuthRow,
        r#"
        SELECT u.id, u.username, u.email, u.password_hash,
               u.first_name, u.last_name, u.is_active,
               u.failed_login_attempts, u.locked_until,
               r.id   AS role_id,
               r.role_slug,
               r.role_name,
               r.is_global,
               u.store_id
        FROM   users u
        JOIN   roles r ON r.id = u.role_id
        WHERE  u.username = $1
        "#,
        payload.username
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Invalid username or password".into()))?;

    if !row.is_active {
        return Err(AppError::Unauthorized("Account is disabled".into()));
    }

    if let Some(locked_until) = row.locked_until {
        if locked_until > Utc::now() {
            return Err(AppError::Unauthorized(format!(
                "Account locked until {}",
                locked_until.format("%H:%M:%S")
            )));
        }
    }

    if !verify_password(&payload.password, &row.password_hash)? {
        sqlx::query!(
            "UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
             locked_until = CASE WHEN failed_login_attempts + 1 >= 5
                            THEN NOW() + INTERVAL '30 minutes' ELSE NULL END
             WHERE id = $1",
            row.id
        )
        .execute(&pool)
        .await?;
        return Err(AppError::Unauthorized("Invalid username or password".into()));
    }

    sqlx::query!(
        "UPDATE users SET failed_login_attempts = 0, locked_until = NULL,
         last_login = NOW() WHERE id = $1",
        row.id
    )
    .execute(&pool)
    .await?;

    let secret        = state.jwt_secret.as_str();
    let access_token  = encode_access_token(
        row.id, &row.username, &row.email,
        row.role_id, &row.role_slug, row.store_id, row.is_global, secret,
    )?;
    let refresh_token = encode_refresh_token(row.id, secret)?;
    let expires_in    = access_expiry_secs();
    let expires_at    = Utc::now() + chrono::Duration::seconds(expires_in);

    let session = SessionData {
        user_id:     row.id,
        username:    row.username.clone(),
        email:       row.email.clone(),
        role_id:     row.role_id,
        role_slug:   row.role_slug.clone(),
        store_id:    row.store_id,
        is_global:   row.is_global,
        created_at:  Utc::now(),
        last_active: Utc::now(),
        expires_at,
    };
    state.sessions.write().await.insert(access_token.clone(), session);

    // Persist long-lived refresh session
    sqlx::query!(
        "INSERT INTO user_sessions (user_id, token, refresh_token, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')",
        row.id, access_token, refresh_token
    )
    .execute(&pool)
    .await?;

    // ── Register in active_sessions — one row per user (upsert by user_id) ──────
    // First expire all previous sessions for this user so the sessions panel
    // never shows duplicate rows for the same person.
    sqlx::query!(
        "UPDATE active_sessions SET expires_at = NOW() \
         WHERE user_id = $1 AND expires_at > NOW()",
        row.id,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query!(
        r#"INSERT INTO active_sessions
               (user_id, store_id, token_hash, expires_at, last_seen_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (token_hash) DO UPDATE
               SET last_seen_at = NOW(), expires_at = EXCLUDED.expires_at"#,
        row.id,
        row.store_id,
        crate::utils::crypto::hash_string(&access_token),
        expires_at,
    )
    .execute(&pool)
    .await
    .ok();

    write_audit_log(&pool, row.id, row.store_id, "login", "auth",
        &format!("User '{}' logged in", row.username), "info").await;

    // Fetch the role's permission slugs so the frontend usePermission() hook works
    let permissions: Vec<String> = sqlx::query_scalar!(
        r#"SELECT p.permission_slug
           FROM   role_permissions rp
           JOIN   permissions p ON p.id = rp.permission_id
           WHERE  rp.role_id = $1"#,
        row.role_id
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(TokenPair {
        access_token,
        refresh_token,
        expires_in,
        user: AuthUser {
            id:          row.id,
            username:    row.username,
            email:       row.email,
            first_name:  row.first_name,
            last_name:   row.last_name,
            role_id:     row.role_id,
            role_slug:   row.role_slug,
            role_name:   row.role_name,
            store_id:    row.store_id,
            is_global:   row.is_global,
            is_active:   row.is_active,
            permissions,
        },
    })
}

// ── Tauri command wrapper ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn login(
    state:   State<'_, AppState>,
    payload: LoginRequest,
) -> AppResult<TokenPair> {
    login_inner(&state, payload).await
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn logout(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<()> {
    logout_inner(&state, token).await
}

pub(crate) async fn logout_inner(state: &AppState, token: String) -> AppResult<()> {
    let session_info = state.sessions.read().await
        .get(&token).map(|s| (s.user_id, s.store_id, s.username.clone()));
    state.sessions.write().await.remove(&token);
    let pool = state.pool().await?;

    // Expire both session tables
    sqlx::query!(
        "UPDATE user_sessions  SET expires_at = NOW() WHERE token      = $1", &token
    ).execute(&pool).await.ok();

    sqlx::query!(
        "UPDATE active_sessions SET expires_at = NOW() WHERE token_hash = $1",
        crate::utils::crypto::hash_string(&token),
    ).execute(&pool).await.ok();

    if let Some((uid, sid, uname)) = session_info {
        write_audit_log(&pool, uid, sid, "logout", "auth",
            &format!("User '{}' logged out", uname), "info").await;
    }

    Ok(())
}

// ── REFRESH TOKEN ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn refresh_token(
    state:   State<'_, AppState>,
    payload: RefreshRequest,
) -> AppResult<TokenPair> {
    refresh_token_inner(&state, payload).await
}

pub(crate) async fn refresh_token_inner(state: &AppState, payload: RefreshRequest) -> AppResult<TokenPair> {
    let claims = decode_token(&payload.refresh_token, &state.jwt_secret)?;
    let pool   = state.pool().await?;

    // ── Verify the refresh token hasn't been revoked ──────────────────────────
    // Revoking a session or deactivating a user expires their user_sessions row.
    // A structurally valid JWT that has been administratively revoked must be
    // rejected here so the client cannot silently obtain a fresh access token.
    let session_valid: bool = sqlx::query_scalar!(
        "SELECT EXISTS(
            SELECT 1 FROM user_sessions
            WHERE refresh_token = $1 AND expires_at > NOW()
         )",
        payload.refresh_token
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(false);

    if !session_valid {
        return Err(AppError::Unauthorized(
            "Session has been revoked. Please log in again.".into()
        ));
    }
    let row = sqlx::query_as!(
        UserAuthRow,
        r#"
        SELECT u.id, u.username, u.email, u.password_hash,
               u.first_name, u.last_name, u.is_active,
               u.failed_login_attempts, u.locked_until,
               r.id   AS role_id,
               r.role_slug,
               r.role_name,
               r.is_global,
               u.store_id
        FROM   users u
        JOIN   roles r ON r.id = u.role_id
        WHERE  u.id = $1 AND u.is_active = TRUE
        "#,
        claims.user_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::Unauthorized("User not found or inactive".into()))?;

    let secret       = state.jwt_secret.as_str();
    let access_token = encode_access_token(
        row.id, &row.username, &row.email,
        row.role_id, &row.role_slug, row.store_id, row.is_global, secret,
    )?;
    let refresh_token = encode_refresh_token(row.id, secret)?;
    let expires_in    = access_expiry_secs();
    let expires_at    = Utc::now() + chrono::Duration::seconds(expires_in);

    let session = SessionData {
        user_id:     row.id,
        username:    row.username.clone(),
        email:       row.email.clone(),
        role_id:     row.role_id,
        role_slug:   row.role_slug.clone(),
        store_id:    row.store_id,
        is_global:   row.is_global,
        created_at:  Utc::now(),
        last_active: Utc::now(),
        expires_at,
    };
    state.sessions.write().await.insert(access_token.clone(), session);

    sqlx::query!(
        "INSERT INTO user_sessions (user_id, token, refresh_token, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')",
        row.id, access_token, refresh_token
    )
    .execute(&pool)
    .await?;

    // ── Keep active_sessions up to date on refresh — one row per user ────────
    // Expire the old session row for this user before inserting the refreshed one.
    sqlx::query!(
        "UPDATE active_sessions SET expires_at = NOW() \
         WHERE user_id = $1 AND expires_at > NOW()",
        row.id,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query!(
        r#"INSERT INTO active_sessions
               (user_id, store_id, token_hash, expires_at, last_seen_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (token_hash) DO UPDATE
               SET last_seen_at = NOW(), expires_at = EXCLUDED.expires_at"#,
        row.id,
        row.store_id,
        crate::utils::crypto::hash_string(&access_token),
        expires_at,
    )
    .execute(&pool)
    .await
    .ok();

    // Fetch the role's permission slugs so the frontend usePermission() hook works
    let permissions: Vec<String> = sqlx::query_scalar!(
        r#"SELECT p.permission_slug
           FROM   role_permissions rp
           JOIN   permissions p ON p.id = rp.permission_id
           WHERE  rp.role_id = $1"#,
        row.role_id
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(TokenPair {
        access_token,
        refresh_token,
        expires_in,
        user: AuthUser {
            id:          row.id,
            username:    row.username,
            email:       row.email,
            first_name:  row.first_name,
            last_name:   row.last_name,
            role_id:     row.role_id,
            role_slug:   row.role_slug,
            role_name:   row.role_name,
            store_id:    row.store_id,
            is_global:   row.is_global,
            is_active:   row.is_active,
            permissions,
        },
    })
}

// ── VERIFY SESSION ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn verify_session(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<serde_json::Value> {
    let claims = guard(&state, &token).await?;
    Ok(serde_json::json!({
        "valid":    true,
        "user_id":  claims.user_id,
        "username": claims.username,
        "role_slug":claims.role_slug,
    }))
}

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────

pub(crate) async fn change_password_inner(
    state:   &AppState,
    token:   String,
    payload: ChangePasswordRequest,
) -> AppResult<()> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    let hash: String = sqlx::query_scalar!(
        "SELECT password_hash FROM users WHERE id = $1", claims.user_id
    )
    .fetch_one(&pool)
    .await?;

    if !verify_password(&payload.current_password, &hash)? {
        return Err(AppError::Unauthorized("Current password is incorrect".into()));
    }

    validate_password(&payload.new_password).map_err(AppError::Validation)?;
    let new_hash = hash_password(&payload.new_password)?;

    sqlx::query!(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        new_hash, claims.user_id
    )
    .execute(&pool)
    .await?;

    write_audit_log(&pool, claims.user_id, claims.store_id, "change_password", "auth",
        "Password changed", "warning").await;

    Ok(())
}

#[tauri::command]
pub async fn change_password(
    state:   State<'_, AppState>,
    token:   String,
    payload: ChangePasswordRequest,
) -> AppResult<()> {
    change_password_inner(&state, token, payload).await
}

// ── REQUEST PASSWORD RESET ────────────────────────────────────────────────────

#[tauri::command]
pub async fn request_password_reset(
    state:    State<'_, AppState>,
    username: String,
) -> AppResult<String> {
    let pool = state.pool().await?;

    let user_id: Option<i32> = sqlx::query_scalar!(
        "SELECT id FROM users WHERE username = $1 AND is_active = TRUE",
        username
    )
    .fetch_optional(&pool)
    .await?;

    let Some(user_id) = user_id else {
        return Ok("If the account exists, a reset token has been generated.".into());
    };

    let token = crate::utils::crypto::random_token();
    let expires_at = Utc::now() + chrono::Duration::hours(1);

    sqlx::query!(
        "UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE",
        user_id
    )
    .execute(&pool)
    .await?;

    sqlx::query!(
        "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)",
        user_id, token, expires_at
    )
    .execute(&pool)
    .await?;

    Ok(token)
}

// ── RESET PASSWORD ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn reset_password(
    state:        State<'_, AppState>,
    token:        String,
    new_password: String,
) -> AppResult<()> {
    let pool = state.pool().await?;

    let row = sqlx::query!(
        r#"SELECT user_id, expires_at, used
           FROM   password_reset_tokens
           WHERE  token = $1"#,
        token
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Invalid or expired reset token".into()))?;

    if row.used {
        return Err(AppError::Unauthorized("Reset token has already been used".into()));
    }
    if row.expires_at < Utc::now() {
        return Err(AppError::Unauthorized("Reset token has expired".into()));
    }

    crate::utils::crypto::validate_password(&new_password)
        .map_err(AppError::Validation)?;

    let hash = crate::utils::crypto::hash_password(&new_password)?;

    sqlx::query!(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        hash, row.user_id
    )
    .execute(&pool)
    .await?;

    sqlx::query!(
        "UPDATE password_reset_tokens SET used = TRUE WHERE token = $1",
        token
    )
    .execute(&pool)
    .await?;

    Ok(())
}

// ── GUARD HELPER (used by other command modules) ──────────────────────────────

pub async fn guard(state: &AppState, token: &str) -> AppResult<crate::models::auth::Claims> {
    let claims = decode_token(token, &state.jwt_secret)?;

    if let Some(s) = state.sessions.write().await.get_mut(token) {
        if s.expires_at < Utc::now() {
            return Err(AppError::SessionExpired);
        }
        s.last_active = Utc::now();
    }

    Ok(claims)
}

pub async fn guard_permission(
    state:      &AppState,
    token:      &str,
    permission: &str,
) -> AppResult<crate::models::auth::Claims> {
    let claims = guard(state, token).await?;

    if claims.is_global {
        return Ok(claims);
    }

    // ── Cache lookup (avoids DB round-trip per RPC call) ──────────────────────
    {
        let cache = state.permissions_cache.read().await;
        if let Some(perms) = cache.get(&claims.role_id) {
            return if perms.iter().any(|p| p == permission) {
                Ok(claims)
            } else {
                Err(AppError::Forbidden)
            };
        }
    }

    // ── Cache miss: load all slugs for this role, then cache ──────────────────
    let pool = state.pool().await?;
    let slugs: Vec<String> = sqlx::query_scalar!(
        r#"
        SELECT p.permission_slug
        FROM   role_permissions rp
        JOIN   permissions p ON p.id = rp.permission_id
        WHERE  rp.role_id = $1
        "#,
        claims.role_id
    )
    .fetch_all(&pool)
    .await?;

    let has = slugs.iter().any(|p| p == permission);
    state.permissions_cache.write().await.insert(claims.role_id, slugs);

    if has {
        Ok(claims)
    } else {
        Err(AppError::Forbidden)
    }
}
