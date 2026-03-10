// ============================================================================
// ITEM COMMANDS  (aligned with quantum-pos-app item.service.js)
// ============================================================================

use tauri::State;
use uuid::Uuid;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::item::{
        Item, ItemFilters, ItemSearchResult, ItemHistory,
        CreateItemDto, UpdateItemDto, AdjustStockDto,
    },
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

// ── Shared Item Query ─────────────────────────────────────────────────────────

pub(crate) async fn fetch_item(pool: &sqlx::PgPool, id: Uuid) -> AppResult<Item> {
    sqlx::query_as!(
        Item,
        r#"SELECT i.id, i.store_id, i.category_id, i.department_id,
                  i.sku, i.barcode, i.item_name, i.description,
                  i.cost_price, i.selling_price, i.discount_price,
                  s.store_name       AS branch_name,
                  c.category_name,
                  d.department_name,
                  ist.is_active, ist.sellable, ist.available_for_pos,
                  ist.track_stock,   ist.taxable, ist.min_stock_level,
                  ist.allow_discount, ist.max_discount_percent, ist.unit_type, ist.unit_value,
                  ist.requires_weight, ist.allow_negative_stock, ist.archived_at,
                  ist.max_stock_level,
                  istock.quantity, istock.available_quantity, istock.reserved_quantity,
                  i.created_at, i.updated_at
           FROM   items i
           LEFT JOIN stores      s     ON s.id     = i.store_id
           LEFT JOIN categories  c     ON c.id     = i.category_id
           LEFT JOIN departments d     ON d.id     = i.department_id
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id
                                      AND istock.store_id = i.store_id
           WHERE  i.id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Item {id} not found")))
}

// ── pub(crate) inner wrappers for ALL commands (used by http_server) ────────────

pub(crate) async fn search_items_inner(
    state:    &AppState,
    token:    String,
    query:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<ItemSearchResult>> {
    guard_permission(state, &token, "items.read").await?;
    let pool  = state.pool().await?;
    let limit = limit.unwrap_or(10).clamp(1, 100);
    let search = format!("%{query}%");
    sqlx::query_as!(
        ItemSearchResult,
        r#"SELECT i.id, i.sku, i.barcode, i.item_name, i.description,
                  i.selling_price, i.discount_price,
                  ist.is_active, ist.available_for_pos,
                  istock.quantity, istock.available_quantity,
                  c.category_name
           FROM   items i
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           LEFT JOIN categories c ON c.id = i.category_id
           WHERE (i.sku ILIKE $1 OR i.barcode ILIKE $1 OR i.item_name ILIKE $1 OR i.description ILIKE $1)
             AND ($2::int IS NULL OR i.store_id = $2)
             AND ist.is_active   = TRUE
             AND ist.archived_at IS NULL
           ORDER BY i.item_name ASC
           LIMIT $3"#,
        search, store_id, limit
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn activate_item_inner(
    state: &AppState,
    token: String,
    id:    uuid::Uuid,
) -> AppResult<Item> {
    let claims = guard_permission(state, &token, "items.update").await?;
    let pool   = state.pool().await?;
    sqlx::query!(
        "UPDATE item_settings SET is_active = TRUE, updated_at = NOW() WHERE item_id = $1",
        id
    ).execute(&pool).await?;
    let item = fetch_item(&pool, id).await?;
    sqlx::query!(
        r#"INSERT INTO item_history (item_id, store_id, event_type, event_description, performed_by)
           VALUES ($1, $2, 'STATUS_CHANGE', 'Item activated', $3)"#,
        id, item.store_id, claims.user_id
    ).execute(&pool).await?;
    Ok(item)
}

pub(crate) async fn deactivate_item_inner(
    state: &AppState,
    token: String,
    id:    uuid::Uuid,
) -> AppResult<Item> {
    let claims = guard_permission(state, &token, "items.update").await?;
    let pool   = state.pool().await?;
    sqlx::query!(
        "UPDATE item_settings SET is_active = FALSE, updated_at = NOW() WHERE item_id = $1",
        id
    ).execute(&pool).await?;
    let item = fetch_item(&pool, id).await?;
    sqlx::query!(
        r#"INSERT INTO item_history (item_id, store_id, event_type, event_description, performed_by)
           VALUES ($1, $2, 'STATUS_CHANGE', 'Item deactivated', $3)"#,
        id, item.store_id, claims.user_id
    ).execute(&pool).await?;
    Ok(item)
}

pub(crate) async fn count_items_inner(
    state:       &AppState,
    token:       String,
    store_id:    Option<i32>,
    category_id: Option<i32>,
    is_active:   Option<bool>,
) -> AppResult<i64> {
    guard_permission(state, &token, "items.read").await?;
    let pool = state.pool().await?;
    let count: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM   items i
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           WHERE ist.archived_at IS NULL
             AND ($1::int  IS NULL OR i.store_id    = $1)
             AND ($2::int  IS NULL OR i.category_id = $2)
             AND ($3::bool IS NULL OR ist.is_active = $3)"#,
        store_id, category_id, is_active
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);
    Ok(count)
}

pub(crate) async fn get_items_inner(
    state: &AppState,
    token: String,
    filters: ItemFilters,
) -> AppResult<PagedResult<Item>> {
    guard_permission(state, &token, "items.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 500);
    let offset = (page - 1) * limit;
    let search = filters.search.as_ref().map(|s| format!("%{s}%"));

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM items i
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE ist.archived_at IS NULL
             AND ($1::int  IS NULL OR i.store_id      = $1)
             AND ($2::int  IS NULL OR i.category_id   = $2)
             AND ($3::int  IS NULL OR i.department_id = $3)
             AND ($4::bool IS NULL OR ist.is_active   = $4)
             AND ($5::bool IS NULL OR ist.available_for_pos = $5)
             AND ($6::bool IS NULL OR (ist.track_stock = TRUE AND istock.quantity <= ist.min_stock_level::numeric))
             AND ($7::text IS NULL OR i.item_name ILIKE $7 OR i.sku ILIKE $7 OR i.barcode ILIKE $7)"#,
        filters.store_id, filters.category_id, filters.department_id,
        filters.is_active, filters.available_for_pos, filters.low_stock, search,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let items = sqlx::query_as!(
        Item,
        r#"SELECT i.id, i.store_id, i.category_id, i.department_id,
                  i.sku, i.barcode, i.item_name, i.description,
                  i.cost_price, i.selling_price, i.discount_price,
                  s.store_name AS branch_name, c.category_name, d.department_name,
                  ist.is_active, ist.sellable, ist.available_for_pos,
                  ist.track_stock, ist.taxable, ist.min_stock_level,
                  ist.allow_discount, ist.max_discount_percent, ist.unit_type, ist.unit_value,
                  ist.requires_weight, ist.allow_negative_stock, ist.archived_at,
                  ist.max_stock_level,
                  istock.quantity, istock.available_quantity, istock.reserved_quantity,
                  i.created_at, i.updated_at
           FROM   items i
           LEFT JOIN stores s ON s.id = i.store_id
           LEFT JOIN categories c ON c.id = i.category_id
           LEFT JOIN departments d ON d.id = i.department_id
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE ist.archived_at IS NULL
             AND ($1::int  IS NULL OR i.store_id      = $1)
             AND ($2::int  IS NULL OR i.category_id   = $2)
             AND ($3::int  IS NULL OR i.department_id = $3)
             AND ($4::bool IS NULL OR ist.is_active   = $4)
             AND ($5::bool IS NULL OR ist.available_for_pos = $5)
             AND ($6::bool IS NULL OR (ist.track_stock = TRUE AND istock.quantity <= ist.min_stock_level::numeric))
             AND ($7::text IS NULL OR i.item_name ILIKE $7 OR i.sku ILIKE $7 OR i.barcode ILIKE $7)
           ORDER BY i.item_name ASC
           LIMIT $8 OFFSET $9"#,
        filters.store_id, filters.category_id, filters.department_id,
        filters.is_active, filters.available_for_pos, filters.low_stock, search, limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(items, total, page, limit))
}

pub(crate) async fn get_item_inner(
    state: &AppState,
    token: String,
    id: Uuid,
) -> AppResult<Item> {
    guard_permission(state, &token, "items.read").await?;
    let pool = state.pool().await?;
    fetch_item(&pool, id).await
}

pub(crate) async fn get_item_by_barcode_inner(
    state: &AppState,
    token: String,
    barcode: String,
    store_id: Option<i32>,
) -> AppResult<Option<Item>> {
    guard_permission(state, &token, "items.read").await?;
    let pool = state.pool().await?;
    sqlx::query_as!(
        Item,
        r#"SELECT i.id, i.store_id, i.category_id, i.department_id,
                  i.sku, i.barcode, i.item_name, i.description,
                  i.cost_price, i.selling_price, i.discount_price,
                  s.store_name AS branch_name, c.category_name, d.department_name,
                  ist.is_active, ist.sellable, ist.available_for_pos,
                  ist.track_stock, ist.taxable, ist.min_stock_level,
                  ist.allow_discount, ist.max_discount_percent, ist.unit_type, ist.unit_value,
                  ist.requires_weight, ist.allow_negative_stock, ist.archived_at,
                  ist.max_stock_level,
                  istock.quantity, istock.available_quantity, istock.reserved_quantity,
                  i.created_at, i.updated_at
           FROM   items i
           LEFT JOIN stores s ON s.id = i.store_id
           LEFT JOIN categories c ON c.id = i.category_id
           LEFT JOIN departments d ON d.id = i.department_id
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE i.barcode = $1
             AND ($2::int IS NULL OR i.store_id = $2)
             AND ist.archived_at IS NULL
           LIMIT 1"#,
        barcode, store_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn get_item_by_sku_inner(
    state: &AppState,
    token: String,
    sku: String,
    store_id: Option<i32>,
) -> AppResult<Option<Item>> {
    guard_permission(state, &token, "items.read").await?;
    let pool = state.pool().await?;
    sqlx::query_as!(
        Item,
        r#"SELECT i.id, i.store_id, i.category_id, i.department_id,
                  i.sku, i.barcode, i.item_name, i.description,
                  i.cost_price, i.selling_price, i.discount_price,
                  s.store_name AS branch_name, c.category_name, d.department_name,
                  ist.is_active, ist.sellable, ist.available_for_pos,
                  ist.track_stock, ist.taxable, ist.min_stock_level,
                  ist.allow_discount, ist.max_discount_percent, ist.unit_type, ist.unit_value,
                  ist.requires_weight, ist.allow_negative_stock, ist.archived_at,
                  ist.max_stock_level,
                  istock.quantity, istock.available_quantity, istock.reserved_quantity,
                  i.created_at, i.updated_at
           FROM   items i
           LEFT JOIN stores s ON s.id = i.store_id
           LEFT JOIN categories c ON c.id = i.category_id
           LEFT JOIN departments d ON d.id = i.department_id
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE i.sku = $1
             AND ($2::int IS NULL OR i.store_id = $2)
             AND ist.archived_at IS NULL
           LIMIT 1"#,
        sku, store_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn delete_item_inner(
    state: &AppState,
    token: String,
    id: Uuid,
) -> AppResult<()> {
    let claims = guard_permission(state, &token, "items.delete").await?;
    let pool = state.pool().await?;
    let item = fetch_item(&pool, id).await?;
    sqlx::query!(
        "UPDATE item_settings SET archived_at = NOW(), is_active = FALSE WHERE item_id = $1",
        id
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO item_history (item_id, store_id, event_type, event_description, performed_by)
           VALUES ($1, $2, 'STATUS_CHANGE', 'Item archived', $3)"#,
        id, item.store_id, claims.user_id
    )
    .execute(&pool)
    .await?;
    Ok(())
}

pub(crate) async fn adjust_stock_inner(
    state: &AppState,
    token: String,
    payload: AdjustStockDto,
) -> AppResult<Item> {
    let claims = guard_permission(state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;
    let adj    = to_dec(payload.adjustment);
    let mut tx = pool.begin().await?;

    let qty_before: Decimal = sqlx::query_scalar!(
        "SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2",
        payload.item_id, payload.store_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or_default();

    let qty_after = qty_before + adj;
    if qty_after < Decimal::ZERO {
        return Err(AppError::Validation("Adjustment would result in negative stock".into()));
    }

    sqlx::query!(
        r#"UPDATE item_stock SET quantity = quantity + $1, available_quantity = available_quantity + $1,
           updated_at = NOW() WHERE item_id = $2 AND store_id = $3"#,
        adj, payload.item_id, payload.store_id,
    )
    .execute(&mut *tx)
    .await?;

    let event_type = payload.adjustment_type.as_deref().unwrap_or("ADJUSTMENT");
    let description = format!("Stock {}", event_type.to_lowercase());

    sqlx::query!(
        r#"INSERT INTO item_history
               (item_id, store_id, event_type, event_description,
                quantity_before, quantity_after, quantity_change,
                performed_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
        payload.item_id, payload.store_id, event_type, description,
        qty_before, qty_after, adj,
        claims.user_id,
        payload.notes,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    fetch_item(&pool, payload.item_id).await
}

pub(crate) async fn get_item_history_inner(
    state: &AppState,
    token: String,
    item_id: Uuid,
    page: Option<i64>,
    limit: Option<i64>,
) -> AppResult<PagedResult<ItemHistory>> {
    guard_permission(state, &token, "items.read").await?;
    let pool   = state.pool().await?;
    let page   = page.unwrap_or(1).max(1);
    let limit  = limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;

    let total: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM item_history WHERE item_id = $1",
        item_id
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let history = sqlx::query_as!(
        ItemHistory,
        r#"SELECT h.id, h.item_id, h.store_id,
                  h.event_type, h.event_description,
                  h.quantity_before, h.quantity_after, h.quantity_change,
                  h.price_before, h.price_after,
                  h.reference_type, h.reference_id,
                  h.performed_by, h.performed_at, h.notes,
                  u.username AS user_name,
                  i.item_name
           FROM   item_history h
           LEFT JOIN users u ON u.id = h.performed_by
           LEFT JOIN items i ON i.id = h.item_id
           WHERE  h.item_id = $1
           ORDER  BY h.performed_at DESC
           LIMIT $2 OFFSET $3"#,
        item_id, limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(history, total, page, limit))
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_items(
    state:   State<'_, AppState>,
    token:   String,
    filters: ItemFilters,
) -> AppResult<PagedResult<Item>> {
    get_items_inner(&state, token, filters).await
}

#[tauri::command]
pub async fn get_item(
    state: State<'_, AppState>,
    token: String,
    id:    Uuid,
) -> AppResult<Item> {
    get_item_inner(&state, token, id).await
}

#[tauri::command]
pub async fn get_item_by_barcode(
    state:    State<'_, AppState>,
    token:    String,
    barcode:  String,
    store_id: Option<i32>,
) -> AppResult<Option<Item>> {
    get_item_by_barcode_inner(&state, token, barcode, store_id).await
}

#[tauri::command]
pub async fn get_item_by_sku(
    state:    State<'_, AppState>,
    token:    String,
    sku:      String,
    store_id: Option<i32>,
) -> AppResult<Option<Item>> {
    get_item_by_sku_inner(&state, token, sku, store_id).await
}

/// Search items by text query (for POS autocomplete / barcode scanner fallback).
/// Matches quantum-pos-app `itemService.search(searchQuery, branchId, limit)`.
#[tauri::command]
pub async fn search_items(
    state:    State<'_, AppState>,
    token:    String,
    query:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<ItemSearchResult>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool  = state.pool().await?;
    let limit = limit.unwrap_or(10).clamp(1, 100);
    let search = format!("%{query}%");

    sqlx::query_as!(
        ItemSearchResult,
        r#"SELECT i.id, i.sku, i.barcode, i.item_name, i.description,
                  i.selling_price, i.discount_price,
                  ist.is_active, ist.available_for_pos,
                  istock.quantity, istock.available_quantity,
                  c.category_name
           FROM   items i
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           LEFT JOIN categories c ON c.id = i.category_id
           WHERE (i.sku ILIKE $1 OR i.barcode ILIKE $1 OR i.item_name ILIKE $1 OR i.description ILIKE $1)
             AND ($2::int IS NULL OR i.store_id = $2)
             AND ist.is_active    = TRUE
             AND ist.archived_at  IS NULL
           ORDER BY i.item_name ASC
           LIMIT $3"#,
        search, store_id, limit
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn create_item(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateItemDto,
) -> AppResult<Item> {
    let claims = guard_permission(&state, &token, "items.create").await?;
    let pool   = state.pool().await?;

    // ── Uniqueness checks ──────────────────────────────────────────────────
    let sku_taken: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM items WHERE sku = $1)",
        payload.sku
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(false);
    if sku_taken {
        return Err(AppError::Validation(format!("SKU '{}' already exists", payload.sku)));
    }

    if let Some(ref bc) = payload.barcode {
        let bc_taken: bool = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM items WHERE barcode = $1)",
            bc
        )
        .fetch_one(&pool)
        .await?
        .unwrap_or(false);
        if bc_taken {
            return Err(AppError::Validation(format!("Barcode '{}' already exists", bc)));
        }
    }

    let cost     = to_dec(payload.cost_price);
    let sell     = to_dec(payload.selling_price);
    let disc     = payload.discount_price.map(to_dec);
    let max_disc = payload.max_discount_percent.map(to_dec);
    let unit_val = payload.unit_value.map(to_dec);
    let init_qty = Decimal::try_from(payload.initial_quantity.unwrap_or(0.0)).unwrap_or_default();

    let mut tx = pool.begin().await?;

    // 1. Insert core item row
    let item_id: Uuid = sqlx::query_scalar!(
        r#"INSERT INTO items
               (store_id, category_id, department_id, sku, barcode,
                item_name, description, cost_price, selling_price, discount_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id"#,
        payload.store_id, payload.category_id, payload.department_id,
        payload.sku, payload.barcode, payload.item_name, payload.description,
        cost, sell, disc,
    )
    .fetch_one(&mut *tx)
    .await?;

    // 2. Insert item_settings
    sqlx::query!(
        r#"INSERT INTO item_settings
               (item_id, store_id,
                is_active, sellable, available_for_pos, track_stock, taxable,
                min_stock_level, max_stock_level,
                allow_discount, max_discount_percent,
                unit_type, unit_value,
                requires_weight, allow_negative_stock)
           VALUES ($1, $2,
                   COALESCE($3,  TRUE),
                   COALESCE($4,  TRUE),
                   COALESCE($5,  TRUE),
                   COALESCE($6,  TRUE),
                   COALESCE($7,  FALSE),
                   COALESCE($8,  0),
                   COALESCE($9,  1000),
                   COALESCE($10, TRUE),
                   $11,
                   $12,
                   $13,
                   COALESCE($14, FALSE),
                   COALESCE($15, FALSE))"#,
        item_id, payload.store_id,
        payload.is_active, payload.sellable, payload.available_for_pos,
        payload.track_stock, payload.taxable,
        payload.min_stock_level, payload.max_stock_level,
        payload.allow_discount, max_disc,
        payload.unit_type, unit_val,
        payload.requires_weight, payload.allow_negative_stock,
    )
    .execute(&mut *tx)
    .await?;

    // 3. Insert item_stock
    sqlx::query!(
        r#"INSERT INTO item_stock (item_id, store_id, quantity, available_quantity)
           VALUES ($1, $2, $3, $3)"#,
        item_id, payload.store_id, init_qty,
    )
    .execute(&mut *tx)
    .await?;

    // 4. Log CREATE event
    sqlx::query!(
        r#"INSERT INTO item_history
               (item_id, store_id, event_type, event_description,
                quantity_before, quantity_after, quantity_change, performed_by)
           VALUES ($1, $2, 'CREATE', 'Item created', 0, $3, $3, $4)"#,
        item_id, payload.store_id, init_qty, claims.user_id,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    fetch_item(&pool, item_id).await
}

#[tauri::command]
pub async fn update_item(
    state:   State<'_, AppState>,
    token:   String,
    id:      Uuid,
    payload: UpdateItemDto,
) -> AppResult<Item> {
    let claims = guard_permission(&state, &token, "items.update").await?;
    let pool   = state.pool().await?;

    // Load existing item for comparison and uniqueness checks
    let existing = fetch_item(&pool, id).await?;

    // ── Uniqueness checks ──────────────────────────────────────────────────
    if let Some(ref new_sku) = payload.sku {
        if new_sku != &existing.sku {
            let taken: bool = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM items WHERE sku = $1 AND id != $2)",
                new_sku, id
            )
            .fetch_one(&pool)
            .await?
            .unwrap_or(false);
            if taken {
                return Err(AppError::Validation(format!("SKU '{new_sku}' already exists")));
            }
        }
    }

    if let Some(ref new_bc) = payload.barcode {
        let existing_bc = existing.barcode.as_deref().unwrap_or("");
        if new_bc != existing_bc {
            let taken: bool = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM items WHERE barcode = $1 AND id != $2)",
                new_bc, id
            )
            .fetch_one(&pool)
            .await?
            .unwrap_or(false);
            if taken {
                return Err(AppError::Validation(format!("Barcode '{new_bc}' already exists")));
            }
        }
    }

    let cost     = payload.cost_price.map(to_dec);
    let sell     = payload.selling_price.map(to_dec);
    let disc     = payload.discount_price.map(to_dec);
    let max_disc = payload.max_discount_percent.map(to_dec);
    let unit_val = payload.unit_value.map(to_dec);

    // ── Update core items row ─────────────────────────────────────────────
    sqlx::query!(
        r#"UPDATE items SET
           category_id    = COALESCE($1,  category_id),
           department_id  = COALESCE($2,  department_id),
           sku            = COALESCE($3,  sku),
           barcode        = COALESCE($4,  barcode),
           item_name      = COALESCE($5,  item_name),
           description    = COALESCE($6,  description),
           cost_price     = COALESCE($7,  cost_price),
           selling_price  = COALESCE($8,  selling_price),
           discount_price = COALESCE($9,  discount_price),
           updated_at     = NOW()
           WHERE id = $10"#,
        payload.category_id, payload.department_id, payload.sku, payload.barcode,
        payload.item_name, payload.description, cost, sell, disc, id,
    )
    .execute(&pool)
    .await?;

    // ── Update item_settings row ──────────────────────────────────────────
    sqlx::query!(
        r#"UPDATE item_settings SET
           is_active            = COALESCE($1,  is_active),
           sellable             = COALESCE($2,  sellable),
           available_for_pos    = COALESCE($3,  available_for_pos),
           track_stock          = COALESCE($4,  track_stock),
           taxable              = COALESCE($5,  taxable),
           allow_discount       = COALESCE($6,  allow_discount),
           max_discount_percent = COALESCE($7,  max_discount_percent),
           unit_type            = COALESCE($8,  unit_type),
           unit_value           = COALESCE($9,  unit_value),
           requires_weight      = COALESCE($10, requires_weight),
           allow_negative_stock = COALESCE($11, allow_negative_stock),
           min_stock_level      = COALESCE($12, min_stock_level),
           max_stock_level      = COALESCE($13, max_stock_level),
           updated_at           = NOW()
           WHERE item_id = $14"#,
        payload.is_active, payload.sellable, payload.available_for_pos,
        payload.track_stock, payload.taxable, payload.allow_discount,
        max_disc, payload.unit_type, unit_val, payload.requires_weight,
        payload.allow_negative_stock, payload.min_stock_level, payload.max_stock_level,
        id,
    )
    .execute(&pool)
    .await?;

    // ── Build change log for history ──────────────────────────────────────
    let mut change_lines: Vec<String> = Vec::new();

    let price_changed = payload.selling_price
        .map(to_dec)
        .map(|v| v != existing.selling_price)
        .unwrap_or(false);

    if let Some(ref v) = payload.item_name {
        if v != &existing.item_name {
            change_lines.push(format!("Name: \"{}\" -> \"{v}\"", existing.item_name));
        }
    }
    if let Some(ref v) = payload.sku {
        if v != &existing.sku {
            change_lines.push(format!("SKU: {} -> {v}", existing.sku));
        }
    }
    if let Some(ref v) = payload.barcode {
        let old = existing.barcode.as_deref().unwrap_or("(none)");
        if v != old {
            change_lines.push(format!("Barcode: {old} -> {v}"));
        }
    }
    if payload.description.is_some() { change_lines.push("Description updated".into()); }
    if payload.category_id.is_some()   { change_lines.push("Category changed".into());    }
    if payload.department_id.is_some() { change_lines.push("Department changed".into());  }

    if payload.cost_price.map(to_dec).map(|v| v != existing.cost_price).unwrap_or(false) {
        change_lines.push(format!("Cost price: {:.2} -> {:.2}", existing.cost_price, to_dec(payload.cost_price.unwrap())));
    }
    if price_changed {
        change_lines.push(format!("Selling price: {:.2} -> {:.2}", existing.selling_price, to_dec(payload.selling_price.unwrap())));
    }
    if payload.discount_price.map(to_dec)
        .map(|v| Some(v) != existing.discount_price)
        .unwrap_or(false)
    {
        change_lines.push(format!(
            "Discount price: {:.2} -> {:.2}",
            existing.discount_price.unwrap_or_default(),
            to_dec(payload.discount_price.unwrap()),
        ));
    }

    let bool_fields: &[(&str, Option<bool>, Option<bool>)] = &[
        ("Active status",     payload.is_active,        existing.is_active),
        ("Sellable",          payload.sellable,          existing.sellable),
        ("Available for POS", payload.available_for_pos, existing.available_for_pos),
        ("Track stock",       payload.track_stock,       existing.track_stock),
        ("Taxable",           payload.taxable,           existing.taxable),
        ("Allow discount",    payload.allow_discount,    existing.allow_discount),
        ("Requires weight",   payload.requires_weight,   existing.requires_weight),
        ("Allow negative stock", payload.allow_negative_stock, existing.allow_negative_stock),
    ];
    for (label, new_val, old_val) in bool_fields {
        if let Some(nv) = new_val {
            if Some(*nv) != *old_val {
                change_lines.push(format!(
                    "{label}: {} -> {}",
                    if old_val.unwrap_or(false) { "Yes" } else { "No" },
                    if *nv { "Yes" } else { "No" },
                ));
            }
        }
    }
    if let Some(ref v) = payload.unit_type {
        let old = existing.unit_type.as_deref().unwrap_or("-");
        if v != old {
            change_lines.push(format!("Unit type: {old} -> {v}"));
        }
    }
    if let Some(v) = payload.min_stock_level {
        if Some(v) != existing.min_stock_level {
            change_lines.push(format!("Min stock level: {:?} -> {v}", existing.min_stock_level));
        }
    }
    if let Some(v) = payload.max_stock_level {
        if Some(v) != existing.max_stock_level {
            change_lines.push(format!("Max stock level: {:?} -> {v}", existing.max_stock_level));
        }
    }
    if let Some(v) = payload.max_discount_percent.map(to_dec) {
        if Some(v) != existing.max_discount_percent {
            change_lines.push(format!("Max discount %: {:?}% -> {v}%", existing.max_discount_percent));
        }
    }

    if !change_lines.is_empty() {
        let only_price = price_changed && change_lines.len() == 1;
        let event_type = if only_price { "PRICE_CHANGE" } else { "UPDATE" };
        let summary = if only_price {
            "Selling price updated".to_string()
        } else {
            let fields: Vec<&str> = change_lines.iter()
                .map(|l| l.split(':').next().unwrap_or(l).trim())
                .collect();
            format!("Updated: {}", fields.join(", "))
        };
        let notes = change_lines.join("\n");

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    price_before, price_after, performed_by, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
            id,
            existing.store_id,
            event_type,
            summary,
            if price_changed { Some(existing.selling_price) } else { None },
            if price_changed { payload.selling_price.map(to_dec) } else { None },
            claims.user_id,
            notes,
        )
        .execute(&pool)
        .await?;
    }

    fetch_item(&pool, id).await
}

#[tauri::command]
pub async fn delete_item(
    state: State<'_, AppState>,
    token: String,
    id:    Uuid,
) -> AppResult<()> {
    delete_item_inner(&state, token, id).await
}

/// Activate an item (sets is_active = TRUE).
/// Matches quantum-pos-app `itemService.activate(itemId, updatedBy)`.
#[tauri::command]
pub async fn activate_item(
    state: State<'_, AppState>,
    token: String,
    id:    Uuid,
) -> AppResult<Item> {
    let claims = guard_permission(&state, &token, "items.update").await?;
    let pool   = state.pool().await?;

    sqlx::query!(
        "UPDATE item_settings SET is_active = TRUE, updated_at = NOW() WHERE item_id = $1",
        id
    )
    .execute(&pool)
    .await?;

    let item = fetch_item(&pool, id).await?;

    sqlx::query!(
        r#"INSERT INTO item_history (item_id, store_id, event_type, event_description, performed_by)
           VALUES ($1, $2, 'STATUS_CHANGE', 'Item activated', $3)"#,
        id, item.store_id, claims.user_id
    )
    .execute(&pool)
    .await?;

    Ok(item)
}

/// Deactivate an item (sets is_active = FALSE, does NOT archive it).
/// Matches quantum-pos-app `itemService.deactivate(itemId, updatedBy)`.
#[tauri::command]
pub async fn deactivate_item(
    state: State<'_, AppState>,
    token: String,
    id:    Uuid,
) -> AppResult<Item> {
    let claims = guard_permission(&state, &token, "items.update").await?;
    let pool   = state.pool().await?;

    sqlx::query!(
        "UPDATE item_settings SET is_active = FALSE, updated_at = NOW() WHERE item_id = $1",
        id
    )
    .execute(&pool)
    .await?;

    let item = fetch_item(&pool, id).await?;

    sqlx::query!(
        r#"INSERT INTO item_history (item_id, store_id, event_type, event_description, performed_by)
           VALUES ($1, $2, 'STATUS_CHANGE', 'Item deactivated', $3)"#,
        id, item.store_id, claims.user_id
    )
    .execute(&pool)
    .await?;

    Ok(item)
}

#[tauri::command]
pub async fn adjust_stock(
    state:   State<'_, AppState>,
    token:   String,
    payload: AdjustStockDto,
) -> AppResult<Item> {
    adjust_stock_inner(&state, token, payload).await
}

#[tauri::command]
pub async fn get_item_history(
    state:   State<'_, AppState>,
    token:   String,
    item_id: Uuid,
    page:    Option<i64>,
    limit:   Option<i64>,
) -> AppResult<PagedResult<ItemHistory>> {
    get_item_history_inner(&state, token, item_id, page, limit).await
}

/// Count items matching optional filters.
/// Matches quantum-pos-app `itemService.count(filters)`.
#[tauri::command]
pub async fn count_items(
    state:       State<'_, AppState>,
    token:       String,
    store_id:    Option<i32>,
    category_id: Option<i32>,
    is_active:   Option<bool>,
) -> AppResult<i64> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;

    let count: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM   items i
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           WHERE ist.archived_at IS NULL
             AND ($1::int  IS NULL OR i.store_id    = $1)
             AND ($2::int  IS NULL OR i.category_id = $2)
             AND ($3::bool IS NULL OR ist.is_active = $3)"#,
        store_id, category_id, is_active
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    Ok(count)
}
