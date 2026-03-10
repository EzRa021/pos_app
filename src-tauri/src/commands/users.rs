// ============================================================================
// USER COMMANDS
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::user::{User, CreateUserDto, UpdateUserDto, UserFilters, Role},
    models::pagination::{PagedResult, PaginationParams},
    state::AppState,
    utils::crypto::{hash_password, validate_password},
};
use super::auth::guard_permission;

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
                  u.store_id, s.store_name,
                  u.is_active, u.last_login, u.created_at, u.updated_at
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
                  u.store_id, s.store_name,
                  u.is_active, u.last_login, u.created_at, u.updated_at
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
    guard_permission(&state, &token, "users.create").await?;
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

    get_user(state, token, id).await
}

#[tauri::command]
pub async fn update_user(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateUserDto,
) -> AppResult<User> {
    guard_permission(&state, &token, "users.update").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        r#"UPDATE users SET
           email      = COALESCE($1, email),
           first_name = COALESCE($2, first_name),
           last_name  = COALESCE($3, last_name),
           phone      = COALESCE($4, phone),
           role_id    = COALESCE($5, role_id),
           store_id   = COALESCE($6, store_id),
           is_active  = COALESCE($7, is_active),
           updated_at = NOW()
           WHERE id = $8"#,
        payload.email, payload.first_name, payload.last_name,
        payload.phone, payload.role_id, payload.store_id,
        payload.is_active, id
    )
    .execute(&pool)
    .await?;

    get_user(state, token, id).await
}

#[tauri::command]
pub async fn delete_user(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    guard_permission(&state, &token, "users.delete").await?;
    let pool = state.pool().await?;

    sqlx::query!("UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool)
        .await?;
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
                  u.store_id, s.store_name,
                  u.is_active, u.last_login, u.created_at, u.updated_at
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
