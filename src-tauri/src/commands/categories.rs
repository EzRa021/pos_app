// ============================================================================
// CATEGORY COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::category::{Category, CreateCategoryDto, UpdateCategoryDto},
    state::AppState,
};
use super::auth::guard_permission;
use super::audit::write_audit_log;

// ── Shared SELECT (no store_code – column not yet in stores table) ────────────

pub(crate) async fn get_categories_inner(
    state:         &AppState,
    token:         String,
    store_id:      Option<i32>,
    department_id: Option<i32>,
) -> AppResult<Vec<Category>> {
    guard_permission(state, &token, "categories.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Category,
        r#"
        SELECT
          c.id,
          c.category_code                 AS "category_code?",
          c.category_name,
          c.description,
          c.store_id,
          c.department_id                 AS "department_id?",
          c.parent_category_id            AS "parent_category_id?",
          c.display_order,
          c.color                         AS "color?",
          c.icon                          AS "icon?",
          c.image_url                     AS "image_url?",
          c.is_visible_in_pos,
          c.requires_weighing,
          c.default_tax_rate              AS "default_tax_rate?",
          c.is_active,
          c.created_at,
          c.updated_at,
          s.store_name                    AS "store_name?",
          d.department_name               AS "department_name?",
          d.department_code               AS "department_code?",
          pc.category_name                AS "parent_category_name?",
          (
            SELECT COUNT(*)::bigint FROM items i WHERE i.category_id = c.id
          )                               AS "item_count?"
        FROM categories c
        JOIN stores s        ON c.store_id      = s.id
        LEFT JOIN departments d  ON c.department_id      = d.id
        LEFT JOIN categories pc  ON c.parent_category_id = pc.id
        WHERE ($1::int IS NULL OR c.store_id      = $1)
          AND ($2::int IS NULL OR c.department_id = $2)
        ORDER BY c.display_order ASC, c.category_name ASC
        "#,
        store_id,
        department_id
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn get_category_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Category> {
    guard_permission(state, &token, "categories.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Category,
        r#"
        SELECT
          c.id,
          c.category_code                 AS "category_code?",
          c.category_name,
          c.description,
          c.store_id,
          c.department_id                 AS "department_id?",
          c.parent_category_id            AS "parent_category_id?",
          c.display_order,
          c.color                         AS "color?",
          c.icon                          AS "icon?",
          c.image_url                     AS "image_url?",
          c.is_visible_in_pos,
          c.requires_weighing,
          c.default_tax_rate              AS "default_tax_rate?",
          c.is_active,
          c.created_at,
          c.updated_at,
          s.store_name                    AS "store_name?",
          d.department_name               AS "department_name?",
          d.department_code               AS "department_code?",
          pc.category_name                AS "parent_category_name?",
          (
            SELECT COUNT(*)::bigint FROM items i WHERE i.category_id = c.id
          )                               AS "item_count?"
        FROM categories c
        JOIN stores s        ON c.store_id      = s.id
        LEFT JOIN departments d  ON c.department_id      = d.id
        LEFT JOIN categories pc  ON c.parent_category_id = pc.id
        WHERE c.id = $1
        "#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Category {id} not found")))
}

pub(crate) async fn create_category_inner(
    state:   &AppState,
    token:   String,
    payload: CreateCategoryDto,
) -> AppResult<Category> {
    let claims = guard_permission(state, &token, "categories.create").await?;
    let pool = state.pool().await?;

    let tax_rate = payload.default_tax_rate
        .map(|v| Decimal::try_from(v).unwrap_or_default());

    let id: i32 = sqlx::query_scalar!(
        r#"
        INSERT INTO categories (
          store_id, department_id, category_code, category_name, description,
          parent_category_id, display_order, color, icon, image_url,
          is_visible_in_pos, requires_weighing, default_tax_rate, is_active
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          COALESCE($7, 0), $8, $9, $10,
          COALESCE($11, TRUE), COALESCE($12, FALSE), $13, COALESCE($14, TRUE)
        )
        RETURNING id
        "#,
        payload.store_id,
        payload.department_id,
        payload.category_code,
        payload.category_name,
        payload.description,
        payload.parent_category_id,
        payload.display_order,
        payload.color,
        payload.icon,
        payload.image_url,
        payload.is_visible_in_pos,
        payload.requires_weighing,
        tax_rate,
        payload.is_active
    )
    .fetch_one(&pool)
    .await?;

    write_audit_log(&pool, claims.user_id, Some(payload.store_id), "create", "category",
        &format!("Created category '{}'", payload.category_name), "info").await;

    crate::database::sync::queue_row(
        &pool, "categories", "INSERT", &id.to_string(),
        serde_json::json!({
            "id": id, "store_id": payload.store_id,
            "department_id": payload.department_id,
            "category_name": payload.category_name,
            "category_code": payload.category_code,
            "is_active": payload.is_active.unwrap_or(true),
        }),
        Some(payload.store_id),
    ).await;

    get_category_inner(state, token, id).await
}

pub(crate) async fn update_category_inner(
    state:   &AppState,
    token:   String,
    id:      i32,
    payload: UpdateCategoryDto,
) -> AppResult<Category> {
    let claims = guard_permission(state, &token, "categories.update").await?;
    let pool = state.pool().await?;

    let tax_rate = payload.default_tax_rate
        .map(|v| Decimal::try_from(v).unwrap_or_default());

    sqlx::query!(
        r#"
        UPDATE categories SET
           category_code      = COALESCE($1,  category_code),
           category_name      = COALESCE($2,  category_name),
           description        = COALESCE($3,  description),
           department_id      = COALESCE($4,  department_id),
           parent_category_id = COALESCE($5,  parent_category_id),
           display_order      = COALESCE($6,  display_order),
           color              = COALESCE($7,  color),
           icon               = COALESCE($8,  icon),
           image_url          = COALESCE($9,  image_url),
           is_visible_in_pos  = COALESCE($10, is_visible_in_pos),
           requires_weighing  = COALESCE($11, requires_weighing),
           default_tax_rate   = COALESCE($12, default_tax_rate),
           is_active          = COALESCE($13, is_active),
           updated_at         = NOW()
        WHERE id = $14
        "#,
        payload.category_code,
        payload.category_name,
        payload.description,
        payload.department_id,
        payload.parent_category_id,
        payload.display_order,
        payload.color,
        payload.icon,
        payload.image_url,
        payload.is_visible_in_pos,
        payload.requires_weighing,
        tax_rate,
        payload.is_active,
        id
    )
    .execute(&pool)
    .await?;

    write_audit_log(&pool, claims.user_id, None, "update", "category",
        &format!("Updated category id {id}"), "info").await;

    // Fetch store_id for scoping
    let store_id: Option<i32> = sqlx::query_scalar!("SELECT store_id FROM categories WHERE id = $1", id)
        .fetch_optional(&pool).await.ok().flatten();
    crate::database::sync::queue_row(
        &pool, "categories", "UPDATE", &id.to_string(),
        serde_json::json!({
            "id": id, "store_id": store_id,
            "category_name": payload.category_name,
            "category_code": payload.category_code,
            "department_id": payload.department_id,
            "is_active": payload.is_active,
        }),
        store_id,
    ).await;

    get_category_inner(state, token, id).await
}

pub(crate) async fn delete_category_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<()> {
    let claims = guard_permission(state, &token, "categories.delete").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "UPDATE categories SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id
    )
    .execute(&pool)
    .await?;
    write_audit_log(&pool, claims.user_id, None, "deactivate", "category",
        &format!("Deactivated category id {id}"), "warning").await;
    Ok(())
}

pub(crate) async fn hard_delete_category_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<()> {
    let claims = guard_permission(state, &token, "categories.delete").await?;
    let pool = state.pool().await?;
    sqlx::query!("DELETE FROM categories WHERE id = $1", id)
        .execute(&pool)
        .await?;
    write_audit_log(&pool, claims.user_id, None, "hard_delete", "category",
        &format!("Permanently deleted category id {id}"), "critical").await;
    Ok(())
}

pub(crate) async fn search_categories_inner(
    state:    &AppState,
    token:    String,
    query:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<Category>> {
    guard_permission(state, &token, "categories.read").await?;
    let pool = state.pool().await?;
    let lim  = limit.unwrap_or(10).clamp(1, 100);
    let pat  = format!("%{}%", query);

    sqlx::query_as!(
        Category,
        r#"
        SELECT
          c.id,
          c.category_code                 AS "category_code?",
          c.category_name,
          c.description,
          c.store_id,
          c.department_id                 AS "department_id?",
          c.parent_category_id            AS "parent_category_id?",
          c.display_order,
          c.color                         AS "color?",
          c.icon                          AS "icon?",
          c.image_url                     AS "image_url?",
          c.is_visible_in_pos,
          c.requires_weighing,
          c.default_tax_rate              AS "default_tax_rate?",
          c.is_active,
          c.created_at,
          c.updated_at,
          s.store_name                    AS "store_name?",
          d.department_name               AS "department_name?",
          d.department_code               AS "department_code?",
          pc.category_name                AS "parent_category_name?",
          (SELECT COUNT(*)::bigint FROM items i WHERE i.category_id = c.id) AS "item_count?"
        FROM categories c
        JOIN stores s       ON c.store_id      = s.id
        LEFT JOIN departments d  ON c.department_id      = d.id
        LEFT JOIN categories pc  ON c.parent_category_id = pc.id
        WHERE (c.category_code ILIKE $1 OR c.category_name ILIKE $1 OR c.description ILIKE $1)
          AND ($2::int IS NULL OR c.store_id = $2)
        ORDER BY c.category_name ASC
        LIMIT $3
        "#,
        pat,
        store_id,
        lim
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn get_category_by_code_inner(
    state:    &AppState,
    token:    String,
    code:     String,
    store_id: Option<i32>,
) -> AppResult<Option<Category>> {
    guard_permission(state, &token, "categories.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Category,
        r#"
        SELECT
          c.id,
          c.category_code                 AS "category_code?",
          c.category_name,
          c.description,
          c.store_id,
          c.department_id                 AS "department_id?",
          c.parent_category_id            AS "parent_category_id?",
          c.display_order,
          c.color                         AS "color?",
          c.icon                          AS "icon?",
          c.image_url                     AS "image_url?",
          c.is_visible_in_pos,
          c.requires_weighing,
          c.default_tax_rate              AS "default_tax_rate?",
          c.is_active,
          c.created_at,
          c.updated_at,
          s.store_name                    AS "store_name?",
          d.department_name               AS "department_name?",
          d.department_code               AS "department_code?",
          pc.category_name                AS "parent_category_name?",
          (SELECT COUNT(*)::bigint FROM items i WHERE i.category_id = c.id) AS "item_count?"
        FROM categories c
        JOIN stores s       ON c.store_id      = s.id
        LEFT JOIN departments d  ON c.department_id      = d.id
        LEFT JOIN categories pc  ON c.parent_category_id = pc.id
        WHERE c.category_code = $1
          AND ($2::int IS NULL OR c.store_id = $2)
        "#,
        code,
        store_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn get_pos_categories_inner(
    state:    &AppState,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<serde_json::Value>> {
    guard_permission(state, &token, "categories.read").await?;
    let pool = state.pool().await?;

    let rows = sqlx::query!(
        r#"
        SELECT
          c.id, c.category_code, c.category_name, c.description,
          c.department_id, c.display_order, c.color, c.icon, c.image_url,
          c.requires_weighing, c.default_tax_rate,
          d.department_name, d.department_code, d.color AS department_color
        FROM categories c
        LEFT JOIN departments d ON c.department_id = d.id
        WHERE c.store_id          = $1
          AND c.is_active         = TRUE
          AND c.is_visible_in_pos = TRUE
        ORDER BY d.display_order NULLS LAST, c.display_order ASC, c.category_name ASC
        "#,
        store_id
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "id":                r.id,
        "category_code":     r.category_code,
        "category_name":     r.category_name,
        "description":       r.description,
        "department_id":     r.department_id,
        "display_order":     r.display_order,
        "color":             r.color,
        "icon":              r.icon,
        "image_url":         r.image_url,
        "requires_weighing": r.requires_weighing,
        "default_tax_rate":  r.default_tax_rate,
        "department_name":   r.department_name,
        "department_code":   r.department_code,
        "department_color":  r.department_color,
    })).collect();

    Ok(result)
}

pub(crate) async fn get_subcategories_inner(
    state:     &AppState,
    token:     String,
    parent_id: i32,
    is_active: Option<bool>,
) -> AppResult<Vec<Category>> {
    guard_permission(state, &token, "categories.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Category,
        r#"
        SELECT
          c.id,
          c.category_code                 AS "category_code?",
          c.category_name,
          c.description,
          c.store_id,
          c.department_id                 AS "department_id?",
          c.parent_category_id            AS "parent_category_id?",
          c.display_order,
          c.color                         AS "color?",
          c.icon                          AS "icon?",
          c.image_url                     AS "image_url?",
          c.is_visible_in_pos,
          c.requires_weighing,
          c.default_tax_rate              AS "default_tax_rate?",
          c.is_active,
          c.created_at,
          c.updated_at,
          s.store_name                    AS "store_name?",
          d.department_name               AS "department_name?",
          d.department_code               AS "department_code?",
          NULL::text                      AS "parent_category_name?",
          (SELECT COUNT(*)::bigint FROM items i WHERE i.category_id = c.id) AS "item_count?"
        FROM categories c
        JOIN stores s       ON c.store_id = s.id
        LEFT JOIN departments d ON c.department_id = d.id
        WHERE c.parent_category_id = $1
          AND ($2::bool IS NULL OR c.is_active = $2)
        ORDER BY c.display_order ASC, c.category_name ASC
        "#,
        parent_id,
        is_active
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn get_category_items_inner(
    state:       &AppState,
    token:       String,
    category_id: i32,
    is_active:   Option<bool>,
) -> AppResult<Vec<serde_json::Value>> {
    guard_permission(state, &token, "categories.read").await?;
    let pool = state.pool().await?;

    let rows = sqlx::query!(
        r#"
        SELECT i.id, i.item_name, i.sku, i.barcode, i.selling_price, ist.is_active
        FROM   items i
        LEFT JOIN item_settings ist ON ist.item_id = i.id
        WHERE  i.category_id = $1
          AND ($2::bool IS NULL OR ist.is_active = $2)
        ORDER  BY i.item_name ASC
        "#,
        category_id,
        is_active
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "id":            r.id,
        "item_name":     r.item_name,
        "sku":           r.sku,
        "barcode":       r.barcode,
        "selling_price": r.selling_price,
        "is_active":     r.is_active,
    })).collect();

    Ok(result)
}

pub(crate) async fn activate_category_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Category> {
    guard_permission(state, &token, "categories.update").await?;
    let pool = state.pool().await?;
    sqlx::query!("UPDATE categories SET is_active = TRUE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool).await?;
    get_category_inner(state, token, id).await
}

pub(crate) async fn deactivate_category_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Category> {
    guard_permission(state, &token, "categories.update").await?;
    let pool = state.pool().await?;
    sqlx::query!("UPDATE categories SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool).await?;
    get_category_inner(state, token, id).await
}

pub(crate) async fn assign_category_department_inner(
    state:         &AppState,
    token:         String,
    category_id:   i32,
    department_id: Option<i32>,
) -> AppResult<Category> {
    guard_permission(state, &token, "categories.update").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "UPDATE categories SET department_id = $1, updated_at = NOW() WHERE id = $2",
        department_id, category_id
    )
    .execute(&pool)
    .await?;
    get_category_inner(state, token, category_id).await
}

pub(crate) async fn count_categories_inner(
    state:         &AppState,
    token:         String,
    store_id:      Option<i32>,
    department_id: Option<i32>,
    is_active:     Option<bool>,
) -> AppResult<i64> {
    guard_permission(state, &token, "categories.read").await?;
    let pool = state.pool().await?;
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM categories
           WHERE ($1::int  IS NULL OR store_id      = $1)
             AND ($2::int  IS NULL OR department_id = $2)
             AND ($3::bool IS NULL OR is_active     = $3)"#,
        store_id, department_id, is_active
    )
    .fetch_one(&pool)
    .await
    .map(|c| c.unwrap_or(0))
    .map_err(AppError::from)
}

// ── Tauri command wrappers ────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_categories(
    state:         State<'_, AppState>,
    token:         String,
    store_id:      Option<i32>,
    department_id: Option<i32>,
) -> AppResult<Vec<Category>> {
    get_categories_inner(&state, token, store_id, department_id).await
}

#[tauri::command]
pub async fn get_category(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Category> {
    get_category_inner(&state, token, id).await
}

#[tauri::command]
pub async fn create_category(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateCategoryDto,
) -> AppResult<Category> {
    create_category_inner(&state, token, payload).await
}

#[tauri::command]
pub async fn update_category(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateCategoryDto,
) -> AppResult<Category> {
    update_category_inner(&state, token, id, payload).await
}

#[tauri::command]
pub async fn delete_category(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    delete_category_inner(&state, token, id).await
}

#[tauri::command]
pub async fn hard_delete_category(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    hard_delete_category_inner(&state, token, id).await
}

#[tauri::command]
pub async fn search_categories(
    state:    State<'_, AppState>,
    token:    String,
    query:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<Category>> {
    search_categories_inner(&state, token, query, store_id, limit).await
}

#[tauri::command]
pub async fn get_category_by_code(
    state:    State<'_, AppState>,
    token:    String,
    code:     String,
    store_id: Option<i32>,
) -> AppResult<Option<Category>> {
    get_category_by_code_inner(&state, token, code, store_id).await
}

#[tauri::command]
pub async fn get_pos_categories(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<serde_json::Value>> {
    get_pos_categories_inner(&state, token, store_id).await
}

#[tauri::command]
pub async fn get_subcategories(
    state:     State<'_, AppState>,
    token:     String,
    parent_id: i32,
    is_active: Option<bool>,
) -> AppResult<Vec<Category>> {
    get_subcategories_inner(&state, token, parent_id, is_active).await
}

#[tauri::command]
pub async fn get_category_items(
    state:       State<'_, AppState>,
    token:       String,
    category_id: i32,
    is_active:   Option<bool>,
) -> AppResult<Vec<serde_json::Value>> {
    get_category_items_inner(&state, token, category_id, is_active).await
}

#[tauri::command]
pub async fn activate_category(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Category> {
    activate_category_inner(&state, token, id).await
}

#[tauri::command]
pub async fn deactivate_category(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Category> {
    deactivate_category_inner(&state, token, id).await
}

#[tauri::command]
pub async fn assign_category_department(
    state:         State<'_, AppState>,
    token:         String,
    category_id:   i32,
    department_id: Option<i32>,
) -> AppResult<Category> {
    assign_category_department_inner(&state, token, category_id, department_id).await
}

#[tauri::command]
pub async fn count_categories(
    state:         State<'_, AppState>,
    token:         String,
    store_id:      Option<i32>,
    department_id: Option<i32>,
    is_active:     Option<bool>,
) -> AppResult<i64> {
    count_categories_inner(&state, token, store_id, department_id, is_active).await
}
