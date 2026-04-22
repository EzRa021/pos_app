// ============================================================================
// USER COMMANDS
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::user::{User, CreateUserDto, UpdateUserDto, UserFilters, Role, Permission},
    models::pagination::PagedResult,
    state::AppState,
    utils::crypto::{hash_password, validate_password},
};
use super::auth::guard_permission;
use super::audit::write_audit_log;

#[tauri::command]
pub async fn get_users(
    state:   State<'_, AppState>,
    token:   String,
    filters: UserFilters,
) -> AppResult<PagedResult<User>> {
    guard_permission(&state, &token, "users.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE ($1::int IS NULL OR u.store_id = $1)
             AND ($2::int IS NULL OR u.role_id  = $2)
             AND ($3::bool IS NULL OR u.is_active = $3)
             AND ($4::text IS NULL OR u.username ILIKE $4 OR u.email ILIKE $4
                  OR u.first_name ILIKE $4 OR u.last_name ILIKE $4)"#,
        filters.store_id,
        filters.role_id,
        filters.is_active,
        filters.search.as_ref().map(|s| format!("%{s}%"))
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let users = sqlx::query_as!(
        User,
        r#"SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.phone,
                  u.role_id, r.role_slug, r.role_name, r.is_global,
                  u.store_id, s.store_name AS "store_name?",
                  u.is_active, u.last_login, u.created_at, u.updated_at,
                  u.avatar
           FROM   users u
           JOIN   roles r ON r.id = u.role_id
           LEFT JOIN stores s ON s.id = u.store_id
           WHERE ($1::int IS NULL OR u.store_id = $1)
             AND ($2::int IS NULL OR u.role_id  = $2)
             AND ($3::bool IS NULL OR u.is_active = $3)
             AND ($4::text IS NULL OR u.username ILIKE $4 OR u.email ILIKE $4
                  OR u.first_name ILIKE $4 OR u.last_name ILIKE $4)
           ORDER BY u.created_at DESC
           LIMIT $5 OFFSET $6"#,
        filters.store_id,
        filters.role_id,
        filters.is_active,
        filters.search.as_ref().map(|s| format!("%{s}%")),
        limit,
        offset
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(users, total, page, limit))
}

#[tauri::command]
pub async fn get_user(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<User> {
    guard_permission(&state, &token, "users.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        User,
        r#"SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.phone,
                  u.role_id, r.role_slug, r.role_name, r.is_global,
                  u.store_id, s.store_name AS "store_name?",
                  u.is_active, u.last_login, u.created_at, u.updated_at,
                  u.avatar
           FROM   users u
           JOIN   roles r ON r.id = u.role_id
           LEFT JOIN stores s ON s.id = u.store_id
           WHERE  u.id = $1"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("User {id} not found")))
}

#[tauri::command]
pub async fn create_user(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateUserDto,
) -> AppResult<User> {
    let claims = guard_permission(&state, &token, "users.create").await?;
    validate_password(&payload.password).map_err(AppError::Validation)?;
    let pool = state.pool().await?;
    let hash = hash_password(&payload.password)?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO users (username, email, password_hash, first_name, last_name,
                              phone, role_id, store_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id"#,
        payload.username, payload.email, hash,
        payload.first_name, payload.last_name,
        payload.phone, payload.role_id, payload.store_id
    )
    .fetch_one(&pool)
    .await?;

    write_audit_log(&pool, claims.user_id, claims.store_id, "create", "user",
        &format!("Created user '{}'", payload.username), "info").await;

    crate::database::sync::queue_row(
        &pool, "users", "INSERT", &id.to_string(),
        serde_json::json!({
            "id": id, "username": payload.username, "email": payload.email,
            "password_hash": hash, "first_name": payload.first_name,
            "last_name": payload.last_name, "phone": payload.phone,
            "role_id": payload.role_id, "store_id": payload.store_id,
            "is_active": true,
        }),
        payload.store_id,
    ).await;

    get_user(state, token, id).await
}

#[tauri::command]
pub async fn update_user(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateUserDto,
) -> AppResult<User> {
    let claims = guard_permission(&state, &token, "users.update").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        r#"UPDATE users SET
           email      = COALESCE($1, email),
           first_name = COALESCE($2, first_name),
           last_name  = COALESCE($3, last_name),
           phone      = COALESCE($4, phone),
           role_id    = COALESCE($5, role_id),
           store_id   = $6,
           is_active  = COALESCE($7, is_active),
           updated_at = NOW()
           WHERE id = $8"#,
        payload.email, payload.first_name, payload.last_name,
        payload.phone, payload.role_id, payload.store_id,
        payload.is_active, id
    )
    .execute(&pool)
    .await?;

    write_audit_log(&pool, claims.user_id, claims.store_id, "update", "user",
        &format!("Updated user id {id}"), "info").await;

    crate::database::sync::queue_row(
        &pool, "users", "UPDATE", &id.to_string(),
        serde_json::json!({
            "id": id, "email": payload.email, "first_name": payload.first_name,
            "last_name": payload.last_name, "phone": payload.phone,
            "role_id": payload.role_id, "store_id": payload.store_id,
            "is_active": payload.is_active,
        }),
        payload.store_id,
    ).await;

    get_user(state, token, id).await
}

#[tauri::command]
pub async fn delete_user(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    let claims = guard_permission(&state, &token, "users.delete").await?;
    let pool = state.pool().await?;

    sqlx::query!("UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool)
        .await?;
    write_audit_log(&pool, claims.user_id, claims.store_id, "delete", "user",
        &format!("Deactivated user id {id}"), "warning").await;
    Ok(())
}

#[tauri::command]
pub async fn get_roles(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Vec<Role>> {
    guard_permission(&state, &token, "users.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Role,
        "SELECT id, role_name, role_slug, description, is_global, hierarchy_level
         FROM roles ORDER BY hierarchy_level"
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Search ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn search_users(
    state: State<'_, AppState>,
    token: String,
    query: String,
    limit: Option<i64>,
) -> AppResult<Vec<User>> {
    guard_permission(&state, &token, "users.read").await?;
    let pool    = state.pool().await?;
    let lim     = limit.unwrap_or(10).clamp(1, 50);
    let pattern = format!("%{query}%");

    sqlx::query_as!(
        User,
        r#"SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.phone,
                  u.role_id, r.role_slug, r.role_name, r.is_global,
                  u.store_id, s.store_name AS "store_name?",
                  u.is_active, u.last_login, u.created_at, u.updated_at,
                  u.avatar
           FROM   users u
           JOIN   roles r ON r.id = u.role_id
           LEFT JOIN stores s ON s.id = u.store_id
           WHERE  u.username   ILIKE $1
              OR  u.email      ILIKE $1
              OR  u.first_name ILIKE $1
              OR  u.last_name  ILIKE $1
           ORDER BY u.username
           LIMIT $2"#,
        pattern, lim
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Activate / Deactivate ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn activate_user(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<User> {
    guard_permission(&state, &token, "users.update").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        "UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE id = $1", id
    )
    .execute(&pool)
    .await?;

    get_user(state, token, id).await
}

#[tauri::command]
pub async fn deactivate_user(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<User> {
    guard_permission(&state, &token, "users.update").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        "UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id
    )
    .execute(&pool)
    .await?;

    // ── Force immediate logout for the deactivated user ──────────────────────
    // 1. Expire their active_sessions rows so the sessions panel clears.
    sqlx::query!(
        "UPDATE active_sessions SET expires_at = NOW() WHERE user_id = $1 AND expires_at > NOW()",
        id
    )
    .execute(&pool)
    .await
    .ok();

    // 2. Expire their user_sessions (refresh tokens). refresh_token_inner now
    //    validates these, so the client cannot silently obtain a new access token.
    sqlx::query!(
        "UPDATE user_sessions SET expires_at = NOW() WHERE user_id = $1 AND expires_at > NOW()",
        id
    )
    .execute(&pool)
    .await
    .ok();

    // 3. Evict from the in-memory session cache so their very next API call
    //    returns 401 without waiting for the JWT to naturally expire.
    state.sessions.write().await.retain(|_, s| s.user_id != id);

    get_user(state, token, id).await
}

// ── Admin password reset ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn reset_user_password(
    state:        State<'_, AppState>,
    token:        String,
    id:           i32,
    new_password: String,
) -> AppResult<()> {
    guard_permission(&state, &token, "users.update").await?;
    validate_password(&new_password).map_err(AppError::Validation)?;
    let pool = state.pool().await?;
    let hash = hash_password(&new_password)?;

    sqlx::query!(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        hash, id
    )
    .execute(&pool)
    .await?;

    Ok(())
}

// ── Avatar ───────────────────────────────────────────────────────────────────

/// Upload or replace the user's profile photo.
/// A user may update their own avatar; updating another user's requires users.update.
#[tauri::command]
pub async fn upload_user_avatar(
    state:  State<'_, AppState>,
    token:  String,
    id:     i32,
    avatar: String,   // base64 data URI, e.g. "data:image/webp;base64,…"
) -> AppResult<User> {
    // Validate format
    let valid_prefix = ["data:image/jpeg;base64,", "data:image/png;base64,",
                        "data:image/webp;base64,", "data:image/gif;base64,"];
    if !valid_prefix.iter().any(|p| avatar.starts_with(p)) {
        return Err(AppError::Validation("Invalid image format. Allowed: jpeg, png, webp, gif".into()));
    }
    // Guard size: base64 of a 256×256 WebP should be well under 300 KB
    const MAX_B64_LEN: usize = 400_000;
    if avatar.len() > MAX_B64_LEN {
        return Err(AppError::Validation("Avatar too large (max ~200 KB after resize)".into()));
    }
    // Auth: self OR users.update
    let claims = super::auth::guard(&state, &token).await?;
    if claims.user_id != id {
        guard_permission(&state, &token, "users.update").await?;
    }
    let pool = state.pool().await?;
    sqlx::query!(
        "UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2",
        avatar, id
    )
    .execute(&pool)
    .await?;
    get_user(state, token, id).await
}

/// Remove a user's profile photo (sets avatar back to NULL).
/// A user may remove their own avatar; removing another user's requires users.update.
#[tauri::command]
pub async fn remove_user_avatar(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<User> {
    let claims = super::auth::guard(&state, &token).await?;
    if claims.user_id != id {
        guard_permission(&state, &token, "users.update").await?;
    }
    let pool = state.pool().await?;
    sqlx::query!(
        "UPDATE users SET avatar = NULL, updated_at = NOW() WHERE id = $1",
        id
    )
    .execute(&pool)
    .await?;
    get_user(state, token, id).await
}

// ── Permissions ───────────────────────────────────────────────────────────────

/// Returns all permissions, ordered by category then name.
#[tauri::command]
pub async fn get_permissions(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Vec<Permission>> {
    guard_permission(&state, &token, "users.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Permission,
        "SELECT id, permission_name, permission_slug, category, description
         FROM   permissions
         ORDER  BY category NULLS LAST, permission_name"
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

/// Returns the list of permission IDs currently assigned to a role.
#[tauri::command]
pub async fn get_role_permissions(
    state:   State<'_, AppState>,
    token:   String,
    role_id: i32,
) -> AppResult<Vec<i32>> {
    guard_permission(&state, &token, "users.read").await?;
    let pool = state.pool().await?;

    let ids = sqlx::query_scalar!(
        "SELECT permission_id FROM role_permissions WHERE role_id = $1 ORDER BY permission_id",
        role_id
    )
    .fetch_all(&pool)
    .await?;

    Ok(ids)
}

/// Replaces all permissions for a role in a single transaction.
/// The super_admin role (is_global = TRUE) is protected and cannot be modified.
#[tauri::command]
pub async fn set_role_permissions(
    state:          State<'_, AppState>,
    token:          String,
    role_id:        i32,
    permission_ids: Vec<i32>,
) -> AppResult<()> {
    guard_permission(&state, &token, "users.update").await?;
    let pool = state.pool().await?;

    // Prevent editing the super_admin role's permissions
    let is_global: bool = sqlx::query_scalar!(
        "SELECT is_global FROM roles WHERE id = $1",
        role_id
    )
    .fetch_optional(&pool)
    .await?
    .unwrap_or(false);

    if is_global {
        return Err(AppError::Forbidden);
    }

    let mut tx = pool.begin().await?;

    sqlx::query!("DELETE FROM role_permissions WHERE role_id = $1", role_id)
        .execute(&mut *tx)
        .await?;

    for perm_id in &permission_ids {
        sqlx::query!(
            "INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
            role_id, perm_id
        )
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    // Invalidate the permission cache for this role so the next request re-loads
    // the updated permission set from the DB.
    state.permissions_cache.write().await.remove(&role_id);

    Ok(())
}
