// ============================================================================
// DEPARTMENT COMMANDS
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::department::{Department, CreateDepartmentDto, UpdateDepartmentDto},
    state::AppState,
};
use super::auth::guard_permission;
use super::audit::write_audit_log;

// ── Shared SELECT fragment (no store_code – column not yet in stores table) ───

pub(crate) async fn get_departments_inner(
    state:    &AppState,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<Vec<Department>> {
    guard_permission(state, &token, "departments.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Department,
        r#"
        SELECT
          d.id,
          d.store_id                        AS "store_id?",
          d.department_code                 AS "department_code?",
          d.department_name,
          d.description,
          d.parent_department_id            AS "parent_department_id?",
          d.display_order,
          d.color                           AS "color?",
          d.icon                            AS "icon?",
          d.is_active,
          d.created_at,
          d.updated_at,
          s.store_name                      AS "store_name?",
          pd.department_name                AS "parent_department_name?",
          (
            SELECT COUNT(*)::bigint
            FROM categories c
            WHERE c.department_id = d.id
          )                                 AS "category_count?"
        FROM departments d
        LEFT JOIN stores      s  ON d.store_id             = s.id
        LEFT JOIN departments pd ON d.parent_department_id = pd.id
        WHERE ($1::int IS NULL OR d.store_id = $1)
        ORDER BY d.display_order ASC, d.department_name ASC
        "#,
        store_id
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn get_department_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Department> {
    guard_permission(state, &token, "departments.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Department,
        r#"
        SELECT
          d.id,
          d.store_id                        AS "store_id?",
          d.department_code                 AS "department_code?",
          d.department_name,
          d.description,
          d.parent_department_id            AS "parent_department_id?",
          d.display_order,
          d.color                           AS "color?",
          d.icon                            AS "icon?",
          d.is_active,
          d.created_at,
          d.updated_at,
          s.store_name                      AS "store_name?",
          pd.department_name                AS "parent_department_name?",
          (
            SELECT COUNT(*)::bigint
            FROM categories c
            WHERE c.department_id = d.id
          )                                 AS "category_count?"
        FROM departments d
        LEFT JOIN stores      s  ON d.store_id             = s.id
        LEFT JOIN departments pd ON d.parent_department_id = pd.id
        WHERE d.id = $1
        "#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Department {id} not found")))
}

pub(crate) async fn create_department_inner(
    state:   &AppState,
    token:   String,
    payload: CreateDepartmentDto,
) -> AppResult<Department> {
    let claims = guard_permission(state, &token, "departments.create").await?;
    let pool = state.pool().await?;

    let id: i32 = sqlx::query_scalar!(
        r#"
        INSERT INTO departments (
          store_id, department_code, department_name, description,
          parent_department_id, display_order, color, icon, is_active
        )
        VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), $7, $8, COALESCE($9, TRUE))
        RETURNING id
        "#,
        payload.store_id,
        payload.department_code,
        payload.department_name,
        payload.description,
        payload.parent_department_id,
        payload.display_order,
        payload.color,
        payload.icon,
        payload.is_active
    )
    .fetch_one(&pool)
    .await?;

    write_audit_log(&pool, claims.user_id, payload.store_id, "create", "department",
        &format!("Created department '{}'", payload.department_name), "info").await;

    crate::database::sync::queue_row(
        &pool, "departments", "INSERT", &id.to_string(),
        serde_json::json!({
            "id": id, "store_id": payload.store_id,
            "department_name": payload.department_name,
            "department_code": payload.department_code,
            "is_active": payload.is_active.unwrap_or(true),
        }),
        payload.store_id,
    ).await;

    get_department_inner(state, token, id).await
}

pub(crate) async fn update_department_inner(
    state:   &AppState,
    token:   String,
    id:      i32,
    payload: UpdateDepartmentDto,
) -> AppResult<Department> {
    let claims = guard_permission(state, &token, "departments.update").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        r#"
        UPDATE departments SET
           department_code      = COALESCE($1, department_code),
           department_name      = COALESCE($2, department_name),
           description          = COALESCE($3, description),
           store_id             = COALESCE($4, store_id),
           parent_department_id = COALESCE($5, parent_department_id),
           display_order        = COALESCE($6, display_order),
           color                = COALESCE($7, color),
           icon                 = COALESCE($8, icon),
           is_active            = COALESCE($9, is_active),
           updated_at           = NOW()
        WHERE id = $10
        "#,
        payload.department_code,
        payload.department_name,
        payload.description,
        payload.store_id,
        payload.parent_department_id,
        payload.display_order,
        payload.color,
        payload.icon,
        payload.is_active,
        id
    )
    .execute(&pool)
    .await?;

    write_audit_log(&pool, claims.user_id, None, "update", "department",
        &format!("Updated department id {id}"), "info").await;

    let store_id: Option<i32> = sqlx::query_scalar!("SELECT store_id FROM departments WHERE id = $1", id)
        .fetch_optional(&pool).await.ok().flatten().flatten();
    crate::database::sync::queue_row(
        &pool, "departments", "UPDATE", &id.to_string(),
        serde_json::json!({
            "id": id, "store_id": store_id,
            "department_name": payload.department_name,
            "department_code": payload.department_code,
            "is_active": payload.is_active,
        }),
        store_id,
    ).await;

    get_department_inner(state, token, id).await
}

pub(crate) async fn hard_delete_department_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<()> {
    let claims = guard_permission(state, &token, "departments.delete").await?;
    let pool = state.pool().await?;
    sqlx::query!("DELETE FROM departments WHERE id = $1", id)
        .execute(&pool)
        .await?;
    write_audit_log(&pool, claims.user_id, None, "hard_delete", "department",
        &format!("Permanently deleted department id {id}"), "critical").await;
    Ok(())
}

pub(crate) async fn search_departments_inner(
    state: &AppState,
    token: String,
    query: String,
    limit: Option<i64>,
) -> AppResult<Vec<Department>> {
    guard_permission(state, &token, "departments.read").await?;
    let pool = state.pool().await?;
    let lim  = limit.unwrap_or(10).clamp(1, 100);
    let pat  = format!("%{}%", query);

    sqlx::query_as!(
        Department,
        r#"
        SELECT
          d.id,
          d.store_id                        AS "store_id?",
          d.department_code                 AS "department_code?",
          d.department_name,
          d.description,
          d.parent_department_id            AS "parent_department_id?",
          d.display_order,
          d.color                           AS "color?",
          d.icon                            AS "icon?",
          d.is_active,
          d.created_at,
          d.updated_at,
          s.store_name                      AS "store_name?",
          pd.department_name                AS "parent_department_name?",
          (SELECT COUNT(*)::bigint FROM categories c WHERE c.department_id = d.id) AS "category_count?"
        FROM departments d
        LEFT JOIN stores      s  ON d.store_id             = s.id
        LEFT JOIN departments pd ON d.parent_department_id = pd.id
        WHERE d.department_code ILIKE $1
           OR d.department_name ILIKE $1
           OR d.description     ILIKE $1
        ORDER BY d.department_name ASC
        LIMIT $2
        "#,
        pat,
        lim
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn get_departments_by_store_inner(
    state:          &AppState,
    token:          String,
    store_id:       i32,
    is_active:      Option<bool>,
    include_global: Option<bool>,
) -> AppResult<Vec<Department>> {
    guard_permission(state, &token, "departments.read").await?;
    let pool   = state.pool().await?;
    let global = include_global.unwrap_or(true);

    sqlx::query_as!(
        Department,
        r#"
        SELECT
          d.id,
          d.store_id                        AS "store_id?",
          d.department_code                 AS "department_code?",
          d.department_name,
          d.description,
          d.parent_department_id            AS "parent_department_id?",
          d.display_order,
          d.color                           AS "color?",
          d.icon                            AS "icon?",
          d.is_active,
          d.created_at,
          d.updated_at,
          s.store_name                      AS "store_name?",
          pd.department_name                AS "parent_department_name?",
          (SELECT COUNT(*)::bigint FROM categories c WHERE c.department_id = d.id) AS "category_count?"
        FROM departments d
        LEFT JOIN stores      s  ON d.store_id             = s.id
        LEFT JOIN departments pd ON d.parent_department_id = pd.id
        WHERE (d.store_id = $1 OR ($2 AND d.store_id IS NULL))
          AND ($3::bool IS NULL OR d.is_active = $3)
        ORDER BY d.display_order ASC, d.department_name ASC
        "#,
        store_id,
        global,
        is_active
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn activate_department_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Department> {
    guard_permission(state, &token, "departments.update").await?;
    let pool = state.pool().await?;
    sqlx::query!("UPDATE departments SET is_active = TRUE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool).await?;
    get_department_inner(state, token, id).await
}

pub(crate) async fn deactivate_department_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Department> {
    guard_permission(state, &token, "departments.update").await?;
    let pool = state.pool().await?;
    sqlx::query!("UPDATE departments SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool).await?;
    get_department_inner(state, token, id).await
}

// ── Tauri command wrappers ────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_departments(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<Vec<Department>> {
    get_departments_inner(&state, token, store_id).await
}

#[tauri::command]
pub async fn create_department(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateDepartmentDto,
) -> AppResult<Department> {
    create_department_inner(&state, token, payload).await
}

#[tauri::command]
pub async fn update_department(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateDepartmentDto,
) -> AppResult<Department> {
    update_department_inner(&state, token, id, payload).await
}

#[tauri::command]
pub async fn hard_delete_department(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    hard_delete_department_inner(&state, token, id).await
}

#[tauri::command]
pub async fn search_departments(
    state: State<'_, AppState>,
    token: String,
    query: String,
    limit: Option<i64>,
) -> AppResult<Vec<Department>> {
    search_departments_inner(&state, token, query, limit).await
}

#[tauri::command]
pub async fn get_departments_by_store(
    state:          State<'_, AppState>,
    token:          String,
    store_id:       i32,
    is_active:      Option<bool>,
    include_global: Option<bool>,
) -> AppResult<Vec<Department>> {
    get_departments_by_store_inner(&state, token, store_id, is_active, include_global).await
}

#[tauri::command]
pub async fn activate_department(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Department> {
    activate_department_inner(&state, token, id).await
}

#[tauri::command]
pub async fn deactivate_department(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Department> {
    deactivate_department_inner(&state, token, id).await
}

