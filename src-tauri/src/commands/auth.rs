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
               u.avatar,
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
            avatar:      row.avatar,
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

    // ── Enforce token type ────────────────────────────────────────────────────
    // Only tokens minted as refresh tokens (role_slug == "refresh") may be
    // exchanged here. This prevents an access token — which carries real role
    // and permission claims — from being replayed against the refresh endpoint.
    if claims.role_slug != "refresh" {
        return Err(AppError::Unauthorized("Not a refresh token".into()));
    }

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

    // ── Rotate: retire the presented refresh token ────────────────────────────
    // A refresh token is single-use. Expiring the old user_sessions row here means
    // a leaked/replayed refresh token cannot mint a second access token, and a
    // stolen-then-rotated token is detectably dead on next use.
    sqlx::query!(
        "UPDATE user_sessions SET expires_at = NOW() WHERE refresh_token = $1",
        payload.refresh_token
    )
    .execute(&pool)
    .await
    .ok();

    let row = sqlx::query_as!(
        UserAuthRow,
        r#"
        SELECT u.id, u.username, u.email, u.password_hash,
               u.first_name, u.last_name, u.is_active,
               u.avatar,
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
            avatar:      row.avatar,
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

    // ── Revoke every OTHER session for this user ──────────────────────────────
    // A password change should log the account out everywhere except the device
    // that performed it. Expire all durable sessions that aren't the current one,
    // then evict the matching in-memory sessions so revocation is immediate.
    let current_hash = crate::utils::crypto::hash_string(&token);
    sqlx::query!(
        "UPDATE active_sessions SET expires_at = NOW() \
         WHERE user_id = $1 AND token_hash <> $2 AND expires_at > NOW()",
        claims.user_id, current_hash,
    )
    .execute(&pool)
    .await
    .ok();
    sqlx::query!(
        "UPDATE user_sessions SET expires_at = NOW() \
         WHERE user_id = $1 AND token <> $2 AND expires_at > NOW()",
        claims.user_id, token,
    )
    .execute(&pool)
    .await
    .ok();
    state.sessions.write().await
        .retain(|t, s| s.user_id != claims.user_id || t == &token);

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

pub(crate) async fn request_password_reset_inner(
    state:    &AppState,
    token:    String,
    username: String,
) -> AppResult<String> {
    // Generating a reset token hands the caller the ability to set ANY user's
    // password. This is an administrative action and must be gated — previously
    // it was unauthenticated and reachable over the LAN HTTP RPC, allowing full
    // account takeover (including admin) by anyone who could reach the port.
    guard_permission(state, &token, "users.update").await?;

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

#[tauri::command]
pub async fn request_password_reset(
    state:    State<'_, AppState>,
    token:    String,
    username: String,
) -> AppResult<String> {
    request_password_reset_inner(&state, token, username).await
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

    // A refresh token is structurally a valid JWT but must never authorize an
    // API call — it may only be exchanged at the /refresh endpoint. Rejecting it
    // here closes the "use the long-lived refresh token as an access token" hole.
    if claims.role_slug == "refresh" {
        return Err(AppError::Unauthorized("Invalid access token".into()));
    }

    // ── Fast path: session present in the in-memory map ───────────────────────
    {
        let mut sessions = state.sessions.write().await;
        if let Some(s) = sessions.get_mut(token) {
            if s.expires_at < Utc::now() {
                return Err(AppError::SessionExpired);
            }
            s.last_active = Utc::now();
            return Ok(claims);
        }
    }

    // ── Slow path: memory miss (e.g. after an app restart) ────────────────────
    // The in-memory map is volatile, so after a restart it is empty even though
    // valid access tokens are still circulating. Without this check guard() would
    // fall through and accept ANY structurally valid JWT — meaning a revoked or
    // deactivated user's 7-day token keeps working until it naturally expires.
    // Fall back to the durable active_sessions table (logout / deactivate_user /
    // lock_pos_screen all expire the matching row) and rehydrate the memory map
    // on a hit so subsequent calls take the fast path.
    let pool = state.pool().await?;
    let token_hash = crate::utils::crypto::hash_string(token);
    let row = sqlx::query!(
        "SELECT user_id, store_id, expires_at
         FROM   active_sessions
         WHERE  token_hash = $1 AND expires_at > NOW()",
        token_hash,
    )
    .fetch_optional(&pool)
    .await?;

    let Some(row) = row else {
        return Err(AppError::SessionExpired);
    };

    // Rehydrate the in-memory session from the durable record + token claims.
    let session = SessionData {
        user_id:     row.user_id,
        username:    claims.username.clone(),
        email:       claims.email.clone(),
        role_id:     claims.role_id,
        role_slug:   claims.role_slug.clone(),
        store_id:    row.store_id,
        is_global:   claims.is_global,
        created_at:  Utc::now(),
        last_active: Utc::now(),
        expires_at:  row.expires_at,
    };
    state.sessions.write().await.insert(token.to_string(), session);

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
