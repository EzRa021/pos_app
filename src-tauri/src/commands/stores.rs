// ============================================================================
// STORE COMMANDS
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::store::{Store, CreateStoreDto, UpdateStoreDto},
    state::AppState,
};
use super::auth::guard_permission;

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
                  is_active, created_at, updated_at
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
// Permission rules:
//   • Any authenticated user may fetch their OWN store (store_id in their JWT).
//   • Fetching any other store requires the `stores.read` permission.
//   • Global users (is_global = true) bypass permission checks via guard_permission.

pub(crate) async fn get_store_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Store> {
    // Step 1: require a valid, unexpired session (any role).
    let claims = super::auth::guard(state, &token).await?;

    // Step 2: permission gate.
    //   - Global users → guard_permission will pass (is_global bypasses checks).
    //   - Non-global user requesting their OWN store → allow unconditionally.
    //   - Non-global user requesting a DIFFERENT store → require stores.read.
    let is_own_store = !claims.is_global && claims.store_id == Some(id);
    if !is_own_store {
        guard_permission(state, &token, "stores.read").await?;
    }

    let pool = state.pool().await?;
    sqlx::query_as!(
        Store,
        r#"SELECT id, store_name, address, city, state, country,
                  phone, email, currency, timezone, tax_rate, receipt_footer,
                  is_active, created_at, updated_at
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
// Fetches the store assigned to the calling user from their JWT.
// Works for every role — no extra permission needed.
// Returns null (None serialised as JSON null) if the user has no assigned store
// (i.e. they are a global user who hasn't picked a store).

pub(crate) async fn get_my_store_inner(
    state: &AppState,
    token: String,
) -> AppResult<Option<Store>> {
    let claims = super::auth::guard(state, &token).await?;

    let store_id = match claims.store_id {
        Some(id) => id,
        None     => return Ok(None),   // global user — no fixed store
    };

    let pool = state.pool().await?;
    let store = sqlx::query_as!(
        Store,
        r#"SELECT id, store_name, address, city, state, country,
                  phone, email, currency, timezone, tax_rate, receipt_footer,
                  is_active, created_at, updated_at
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
                               phone, email, currency, timezone, tax_rate, receipt_footer)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id"#,
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
           updated_at     = NOW()
           WHERE id = $13"#,
        payload.store_name, payload.address, payload.city, payload.state,
        payload.country, payload.phone, payload.email,
        payload.currency, payload.timezone, tax, payload.receipt_footer,
        payload.is_active, id
    )
    .execute(&pool)
    .await?;

    get_store(state, token, id).await
}
