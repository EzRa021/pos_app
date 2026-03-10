// ============================================================================
// TAX COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::tax::{TaxCategory, CreateTaxCategoryDto, UpdateTaxCategoryDto},
    state::AppState,
};
use super::auth::guard_permission;

#[tauri::command]
pub async fn get_tax_categories(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Vec<TaxCategory>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        TaxCategory,
        "SELECT id, name, code, rate, is_inclusive, description, is_active, created_at
         FROM   tax_categories ORDER BY name"
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn create_tax_category(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateTaxCategoryDto,
) -> AppResult<TaxCategory> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;
    let rate = Decimal::try_from(payload.rate)
        .map_err(|_| AppError::Validation("Invalid tax rate".into()))?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO tax_categories (name, code, rate, is_inclusive, description)
           VALUES ($1,$2,$3,$4,$5) RETURNING id"#,
        payload.name, payload.code, rate, payload.is_inclusive, payload.description,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        TaxCategory,
        "SELECT id, name, code, rate, is_inclusive, description, is_active, created_at
         FROM   tax_categories WHERE id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn update_tax_category(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateTaxCategoryDto,
) -> AppResult<TaxCategory> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;
    let rate = payload.rate
        .map(|r| Decimal::try_from(r).unwrap_or_default());

    sqlx::query!(
        r#"UPDATE tax_categories SET
           name         = COALESCE($1, name),
           rate         = COALESCE($2, rate),
           is_inclusive = COALESCE($3, is_inclusive),
           description  = COALESCE($4, description),
           is_active    = COALESCE($5, is_active)
           WHERE id = $6"#,
        payload.name, rate, payload.is_inclusive, payload.description, payload.is_active, id,
    )
    .execute(&pool)
    .await?;

    sqlx::query_as!(
        TaxCategory,
        "SELECT id, name, code, rate, is_inclusive, description, is_active, created_at
         FROM   tax_categories WHERE id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

// ── Delete (soft) ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn delete_tax_category(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        "UPDATE tax_categories SET is_active = FALSE WHERE id = $1", id
    )
    .execute(&pool)
    .await?;

    Ok(())
}
