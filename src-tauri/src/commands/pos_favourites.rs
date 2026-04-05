// ============================================================================
// POS FAVOURITES — quick-access item pins per store
// ============================================================================

use tauri::State;
use crate::{
    error::AppResult,
    models::pos_favourites::{PosFavouriteItem, AddFavouriteDto, RemoveFavouriteDto},
    state::AppState,
};
use super::auth::guard_permission;

// ── get_pos_favourites ────────────────────────────────────────────────────────

pub(crate) async fn get_pos_favourites_inner(
    state:    &AppState,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<PosFavouriteItem>> {
    guard_permission(state, &token, "items.read").await?;
    let pool = state.pool().await?;
    sqlx::query_as!(
        PosFavouriteItem,
        r#"SELECT
               i.id,
               i.store_id,
               i.sku,
               i.barcode,
               i.item_name,
               i.selling_price,
               i.discount_price,
               i.discount_price_enabled,
               ist.taxable               AS "taxable: bool",
               ist.measurement_type,
               ist.unit_type,
               ist.requires_weight       AS "requires_weight: bool",
               ist.min_increment,
               ist.default_qty,
               ist.track_stock           AS "track_stock: bool",
               ist.min_stock_level,
               istock.available_quantity,
               c.category_name,
               i.image_data,
               pf.created_at             AS fav_created_at
           FROM pos_favourites pf
           JOIN items           i      ON i.id        = pf.item_id
           LEFT JOIN item_settings ist ON ist.item_id  = i.id
           LEFT JOIN item_stock  istock ON istock.item_id = i.id
                                      AND istock.store_id  = pf.store_id
           LEFT JOIN categories  c     ON c.id         = i.category_id
           WHERE pf.store_id = $1
           ORDER BY pf.created_at ASC"#,
        store_id,
    )
    .fetch_all(&pool)
    .await
    .map_err(Into::into)
}

// ── add_pos_favourite ─────────────────────────────────────────────────────────

pub(crate) async fn add_pos_favourite_inner(
    state:   &AppState,
    token:   String,
    payload: AddFavouriteDto,
) -> AppResult<()> {
    guard_permission(state, &token, "items.read").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "INSERT INTO pos_favourites (store_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        payload.store_id,
        payload.item_id,
    )
    .execute(&pool)
    .await?;
    Ok(())
}

// ── remove_pos_favourite ──────────────────────────────────────────────────────

pub(crate) async fn remove_pos_favourite_inner(
    state:   &AppState,
    token:   String,
    payload: RemoveFavouriteDto,
) -> AppResult<()> {
    guard_permission(state, &token, "items.read").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "DELETE FROM pos_favourites WHERE store_id = $1 AND item_id = $2",
        payload.store_id,
        payload.item_id,
    )
    .execute(&pool)
    .await?;
    Ok(())
}

// ── Tauri command wrappers ────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_pos_favourites(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<PosFavouriteItem>> {
    get_pos_favourites_inner(&state, token, store_id).await
}

#[tauri::command]
pub async fn add_pos_favourite(
    state:   State<'_, AppState>,
    token:   String,
    payload: AddFavouriteDto,
) -> AppResult<()> {
    add_pos_favourite_inner(&state, token, payload).await
}

#[tauri::command]
pub async fn remove_pos_favourite(
    state:   State<'_, AppState>,
    token:   String,
    payload: RemoveFavouriteDto,
) -> AppResult<()> {
    remove_pos_favourite_inner(&state, token, payload).await
}
