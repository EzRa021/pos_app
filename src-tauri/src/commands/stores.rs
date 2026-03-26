// ============================================================================
// STORE COMMANDS
// ============================================================================

use tauri::State;
use serde::Serialize;
use crate::{
    error::{AppError, AppResult},
    models::store::{Store, CreateStoreDto, UpdateStoreDto},
    state::AppState,
};
use super::auth::guard_permission;

// ── Shared SELECT fragment ────────────────────────────────────────────────────
// All queries include logo_data so the frontend always gets the full object.

// ── GET STORES ────────────────────────────────────────────────────────────────

pub(crate) async fn get_stores_inner(
    state:     &AppState,
    token:     String,
    is_active: Option<bool>,
) -> AppResult<Vec<Store>> {
    guard_permission(state, &token, "stores.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        Store,
        r#"SELECT id, store_name, address, city, state, country,
                  phone, email, currency, timezone, tax_rate, receipt_footer,
                  logo_data, is_active, created_at, updated_at
           FROM stores
           WHERE ($1::bool IS NULL OR is_active = $1)
           ORDER BY store_name ASC"#,
        is_active
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_stores(
    state:     State<'_, AppState>,
    token:     String,
    is_active: Option<bool>,
) -> AppResult<Vec<Store>> {
    get_stores_inner(&state, token, is_active).await
}

// ── GET STORE ─────────────────────────────────────────────────────────────────

pub(crate) async fn get_store_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Store> {
    let claims = super::auth::guard(state, &token).await?;

    let is_own_store = !claims.is_global && claims.store_id == Some(id);
    if !is_own_store {
        guard_permission(state, &token, "stores.read").await?;
    }

    let pool = state.pool().await?;
    sqlx::query_as!(
        Store,
        r#"SELECT id, store_name, address, city, state, country,
                  phone, email, currency, timezone, tax_rate, receipt_footer,
                  logo_data, is_active, created_at, updated_at
           FROM stores WHERE id = $1"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Store {id} not found")))
}

#[tauri::command]
pub async fn get_store(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Store> {
    get_store_inner(&state, token, id).await
}

// ── GET MY STORE ──────────────────────────────────────────────────────────────

pub(crate) async fn get_my_store_inner(
    state: &AppState,
    token: String,
) -> AppResult<Option<Store>> {
    let claims = super::auth::guard(state, &token).await?;

    let store_id = match claims.store_id {
        Some(id) => id,
        None     => return Ok(None),
    };

    let pool = state.pool().await?;
    let store = sqlx::query_as!(
        Store,
        r#"SELECT id, store_name, address, city, state, country,
                  phone, email, currency, timezone, tax_rate, receipt_footer,
                  logo_data, is_active, created_at, updated_at
           FROM stores WHERE id = $1"#,
        store_id
    )
    .fetch_optional(&pool)
    .await?;

    Ok(store)
}

#[tauri::command]
pub async fn get_my_store(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<Option<Store>> {
    get_my_store_inner(&state, token).await
}

// ── CREATE STORE ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_store(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateStoreDto,
) -> AppResult<Store> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    let tax = payload.tax_rate
        .map(|r| rust_decimal::Decimal::try_from(r).unwrap_or_default())
        .unwrap_or_default();

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO stores (store_name, address, city, state, country,
                               phone, email, currency, timezone, tax_rate,
                               receipt_footer, logo_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id"#,
        payload.store_name,
        payload.address,
        payload.city,
        payload.state,
        payload.country.unwrap_or("Nigeria".into()),
        payload.phone,
        payload.email,
        payload.currency.unwrap_or("NGN".into()),
        payload.timezone.unwrap_or("Africa/Lagos".into()),
        tax,
        payload.receipt_footer,
        payload.logo_data,
    )
    .fetch_one(&pool)
    .await?;

    get_store(state, token, id).await
}

// ── UPDATE STORE ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_store(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateStoreDto,
) -> AppResult<Store> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    let tax = payload.tax_rate
        .map(|r| rust_decimal::Decimal::try_from(r).unwrap_or_default());

    sqlx::query!(
        r#"UPDATE stores SET
           store_name     = COALESCE($1,  store_name),
           address        = COALESCE($2,  address),
           city           = COALESCE($3,  city),
           state          = COALESCE($4,  state),
           country        = COALESCE($5,  country),
           phone          = COALESCE($6,  phone),
           email          = COALESCE($7,  email),
           currency       = COALESCE($8,  currency),
           timezone       = COALESCE($9,  timezone),
           tax_rate       = COALESCE($10, tax_rate),
           receipt_footer = COALESCE($11, receipt_footer),
           is_active      = COALESCE($12, is_active),
           logo_data      = COALESCE($13, logo_data),
           updated_at     = NOW()
           WHERE id = $14"#,
        payload.store_name, payload.address, payload.city, payload.state,
        payload.country, payload.phone, payload.email,
        payload.currency, payload.timezone, tax, payload.receipt_footer,
        payload.is_active, payload.logo_data, id
    )
    .execute(&pool)
    .await?;

    get_store(state, token, id).await
}

// ── GET STORE USERS ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StoreUser {
    pub id:         i32,
    pub username:   String,
    pub first_name: String,
    pub last_name:  String,
    pub email:      String,
    pub phone:      Option<String>,
    pub role_name:  String,
    pub role_slug:  String,
    pub is_active:  bool,
    pub last_login: Option<chrono::DateTime<chrono::Utc>>,
}

pub(crate) async fn get_store_users_inner(
    state:    &AppState,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<StoreUser>> {
    guard_permission(state, &token, "stores.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        StoreUser,
        r#"SELECT u.id, u.username, u.first_name, u.last_name,
                  u.email, u.phone, r.role_name, r.role_slug,
                  u.is_active, u.last_login
           FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE u.store_id = $1
           ORDER BY r.hierarchy_level ASC, u.first_name ASC"#,
        store_id
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_store_users(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<StoreUser>> {
    get_store_users_inner(&state, token, store_id).await
}
