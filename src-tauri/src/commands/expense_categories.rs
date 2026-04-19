// ============================================================================
// EXPENSE CATEGORY COMMANDS
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::expense_category::{
        ExpenseCategory, CreateExpenseCategoryDto, UpdateExpenseCategoryDto,
    },
    state::AppState,
};
use super::auth::guard_permission;

// ── list ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_expense_categories(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<Vec<ExpenseCategory>> {
    guard_permission(&state, &token, "expenses.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        ExpenseCategory,
        r#"SELECT id, store_id, name, description, is_active, created_at, updated_at
           FROM   expense_categories
           WHERE  (store_id IS NULL OR store_id = $1)
           ORDER  BY is_active DESC, name ASC"#,
        store_id,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── create ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_expense_category(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateExpenseCategoryDto,
) -> AppResult<ExpenseCategory> {
    guard_permission(&state, &token, "expenses.create").await?;
    let pool = state.pool().await?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO expense_categories (store_id, name, description)
           VALUES ($1, $2, $3) RETURNING id"#,
        payload.store_id,
        payload.name.trim(),
        payload.description,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        ExpenseCategory,
        "SELECT id, store_id, name, description, is_active, created_at, updated_at
         FROM   expense_categories WHERE id = $1",
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

// ── update ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_expense_category(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateExpenseCategoryDto,
) -> AppResult<ExpenseCategory> {
    guard_permission(&state, &token, "expenses.update").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        r#"UPDATE expense_categories SET
           name        = COALESCE($1, name),
           description = COALESCE($2, description),
           is_active   = COALESCE($3, is_active),
           updated_at  = NOW()
           WHERE id = $4"#,
        payload.name,
        payload.description,
        payload.is_active,
        id,
    )
    .execute(&pool)
    .await?;

    sqlx::query_as!(
        ExpenseCategory,
        "SELECT id, store_id, name, description, is_active, created_at, updated_at
         FROM   expense_categories WHERE id = $1",
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

// ── delete (soft) ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn delete_expense_category(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    guard_permission(&state, &token, "expenses.update").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "UPDATE expense_categories SET is_active = FALSE, updated_at = NOW() WHERE id = $1",
        id
    )
    .execute(&pool)
    .await?;
    Ok(())
}
