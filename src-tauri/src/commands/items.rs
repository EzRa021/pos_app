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
use super::audit::write_audit_log;
use crate::utils::ref_no::{next_item_sku, store_slug};

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
                  i.discount_price_enabled,
                  s.store_name       AS branch_name,
                  c.category_name,
                  d.department_name,
                  ist.is_active, ist.sellable, ist.available_for_pos,
                  ist.track_stock,   ist.taxable, ist.min_stock_level,
                  ist.allow_discount, ist.max_discount_percent,
                  ist.measurement_type, ist.unit_type, ist.unit_value,
                  ist.requires_weight, ist.allow_negative_stock, ist.archived_at,
                  ist.max_stock_level, ist.min_increment, ist.default_qty,
                  istock.quantity, istock.available_quantity, istock.reserved_quantity,
                  i.image_data,
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

#[allow(dead_code)]
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
                  i.selling_price, i.discount_price, i.discount_price_enabled,
                  ist.is_active, ist.available_for_pos,
                  istock.quantity, istock.available_quantity,
                  c.category_name,
                  ist.measurement_type, ist.unit_type,
                  ist.min_increment, ist.default_qty
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

#[allow(dead_code)]
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
    write_audit_log(&pool, claims.user_id, Some(item.store_id), "activate", "item",
        &format!("Activated item '{}' (id: {})", item.item_name, id), "info").await;
    Ok(item)
}

#[allow(dead_code)]
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
    write_audit_log(&pool, claims.user_id, Some(item.store_id), "deactivate", "item",
        &format!("Deactivated item '{}' (id: {})", item.item_name, id), "warning").await;
    Ok(item)
}

#[allow(dead_code)]
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
             AND ($7::text IS NULL OR i.item_name ILIKE $7 OR i.sku ILIKE $7 OR i.barcode ILIKE $7)
             AND ($8::text IS NULL OR ist.measurement_type = $8)"#,
        filters.store_id, filters.category_id, filters.department_id,
        filters.is_active, filters.available_for_pos, filters.low_stock, search,
        filters.measurement_type,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let items = sqlx::query_as!(
        Item,
        r#"SELECT i.id, i.store_id, i.category_id, i.department_id,
                  i.sku, i.barcode, i.item_name, i.description,
                  i.cost_price, i.selling_price, i.discount_price,
                  i.discount_price_enabled,
                  s.store_name AS branch_name, c.category_name, d.department_name,
                  ist.is_active, ist.sellable, ist.available_for_pos,
                  ist.track_stock, ist.taxable, ist.min_stock_level,
                  ist.allow_discount, ist.max_discount_percent,
                  ist.measurement_type, ist.unit_type, ist.unit_value,
                  ist.requires_weight, ist.allow_negative_stock, ist.archived_at,
                  ist.max_stock_level, ist.min_increment, ist.default_qty,
                  istock.quantity, istock.available_quantity, istock.reserved_quantity,
                  i.image_data,
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
             AND ($8::text IS NULL OR ist.measurement_type = $8)
           ORDER BY i.item_name ASC
           LIMIT $9 OFFSET $10"#,
        filters.store_id, filters.category_id, filters.department_id,
        filters.is_active, filters.available_for_pos, filters.low_stock, search,
        filters.measurement_type, limit, offset,
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
                  i.discount_price_enabled,
                  s.store_name AS branch_name, c.category_name, d.department_name,
                  ist.is_active, ist.sellable, ist.available_for_pos,
                  ist.track_stock, ist.taxable, ist.min_stock_level,
                  ist.allow_discount, ist.max_discount_percent,
                  ist.measurement_type, ist.unit_type, ist.unit_value,
                  ist.requires_weight, ist.allow_negative_stock, ist.archived_at,
                  ist.max_stock_level, ist.min_increment, ist.default_qty,
                  istock.quantity, istock.available_quantity, istock.reserved_quantity,
                  i.image_data,
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
                  i.discount_price_enabled,
                  s.store_name AS branch_name, c.category_name, d.department_name,
                  ist.is_active, ist.sellable, ist.available_for_pos,
                  ist.track_stock, ist.taxable, ist.min_stock_level,
                  ist.allow_discount, ist.max_discount_percent,
                  ist.measurement_type, ist.unit_type, ist.unit_value,
                  ist.requires_weight, ist.allow_negative_stock, ist.archived_at,
                  ist.max_stock_level, ist.min_increment, ist.default_qty,
                  istock.quantity, istock.available_quantity, istock.reserved_quantity,
                  i.image_data,
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
    write_audit_log(&pool, claims.user_id, Some(item.store_id), "archive", "item",
        &format!("Archived item '{}' (id: {})", item.item_name, id), "warning").await;
    Ok(())
}

pub(crate) async fn adjust_stock_inner(
    state: &AppState,
    token: String,
    payload: AdjustStockDto,
) -> AppResult<Item> {
    let claims = guard_permission(state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;

    // Block manual stock adjustments while an active count session is in progress
    // for this store. Allowing adjustments during a count produces phantom variances
    // in the variance report because the expected quantities diverge mid-count.
    let active_count: Option<i32> = sqlx::query_scalar!(
        "SELECT id FROM stock_count_sessions
         WHERE store_id = $1 AND status IN ('pending', 'in_progress')
         LIMIT 1",
        payload.store_id,
    )
    .fetch_optional(&pool)
    .await?;

    if active_count.is_some() {
        return Err(AppError::Conflict(
            "A stock count is currently in progress for this store. \
             Manual stock adjustments are blocked until the count is completed or cancelled \
             to prevent variance report discrepancies.".into()
        ));
    }

    let mut tx = pool.begin().await?;

    // Fetch measurement_type for qty validation
    struct ItemMeta { item_name: String, measurement_type: Option<String> }
    let meta = sqlx::query_as!(
        ItemMeta,
        "SELECT i.item_name, ist.measurement_type
         FROM items i LEFT JOIN item_settings ist ON ist.item_id = i.id
         WHERE i.id = $1",
        payload.item_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Item not found".into()))?;

    let adj = crate::utils::qty::validate_qty_signed_opt(
        to_dec(payload.adjustment),
        meta.measurement_type.as_deref(),
        &meta.item_name,
    )?;

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

    // Queue item_stock row to cloud sync
    crate::database::sync::queue_row(
        &pool, "item_stock", "UPDATE",
        &format!("{}:{}", payload.item_id, payload.store_id),
        serde_json::json!({ "item_id": payload.item_id, "store_id": payload.store_id,
                            "quantity": qty_after, "available_quantity": qty_after }),
        Some(payload.store_id),
    ).await;

    write_audit_log(&pool, claims.user_id, Some(payload.store_id), "stock_adjust", "item",
        &format!("Stock adjusted by {} for item id {}", payload.adjustment, payload.item_id), "info").await;
    fetch_item(&pool, payload.item_id).await
}

pub(crate) async fn get_item_history_inner(
    state:      &AppState,
    token:      String,
    item_id:    Uuid,
    page:       Option<i64>,
    limit:      Option<i64>,
    date_from:  Option<String>,
    date_to:    Option<String>,
    event_type: Option<String>,
) -> AppResult<PagedResult<ItemHistory>> {
    guard_permission(state, &token, "items.read").await?;
    let pool       = state.pool().await?;
    let page       = page.unwrap_or(1).max(1);
    let limit      = limit.unwrap_or(20).clamp(1, 200);
    let offset     = (page - 1) * limit;
    let ev         = event_type.as_deref();

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM item_history h
           WHERE h.item_id = $1
             AND ($2::text IS NULL OR h.performed_at >= $2::text::timestamptz)
             AND ($3::text IS NULL OR h.performed_at <  ($3::text::date + INTERVAL '1 day')::timestamptz)
             AND ($4::text IS NULL OR h.event_type   =  $4)"#,
        item_id, date_from, date_to, ev,
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
                  CASE WHEN u.id IS NOT NULL THEN u.username END AS user_name,
                  CASE WHEN i.id IS NOT NULL THEN i.item_name END AS item_name
           FROM   item_history h
           LEFT JOIN users u ON u.id = h.performed_by
           LEFT JOIN items i ON i.id = h.item_id
           WHERE  h.item_id = $1
             AND ($2::text IS NULL OR h.performed_at >= $2::text::timestamptz)
             AND ($3::text IS NULL OR h.performed_at <  ($3::text::date + INTERVAL '1 day')::timestamptz)
             AND ($4::text IS NULL OR h.event_type   =  $4)
           ORDER  BY h.performed_at DESC
           LIMIT $5 OFFSET $6"#,
        item_id, date_from, date_to, ev, limit, offset,
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
                  i.selling_price, i.discount_price, i.discount_price_enabled,
                  ist.is_active, ist.available_for_pos,
                  istock.quantity, istock.available_quantity,
                  c.category_name,
                  ist.measurement_type, ist.unit_type,
              ist.min_increment, ist.default_qty
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

    // ── Auto-generate unique SKU: ITEM-{STORE_SLUG}-{N} ────────────────────
    let store_row = sqlx::query!(
        "SELECT store_name, store_code FROM stores WHERE id = $1",
        payload.store_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::Validation(format!("Store {} not found", payload.store_id)))?;

    let slug = store_slug(
        store_row.store_code.as_deref(),
        &store_row.store_name,
    );
    let sku = next_item_sku(&pool, payload.store_id, &slug).await;

    // ── Barcode uniqueness check ───────────────────────────────────────────
    if let Some(ref bc) = payload.barcode {
        let bc_taken: bool = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM items WHERE barcode = $1 AND store_id = $2)",
            bc, payload.store_id
        )
        .fetch_one(&pool)
        .await?
        .unwrap_or(false);
        if bc_taken {
            return Err(AppError::Validation(format!("Barcode '{}' is already used by another item in this store", bc)));
        }
    }

    let cost     = to_dec(payload.cost_price);
    let sell     = to_dec(payload.selling_price);
    let disc     = payload.discount_price.map(to_dec);
    let max_disc = payload.max_discount_percent.map(to_dec);
    let unit_val = payload.unit_value.map(to_dec);
    let min_inc  = payload.min_increment.map(to_dec);
    let def_qty  = payload.default_qty.map(to_dec);
    let init_qty = Decimal::try_from(payload.initial_quantity.unwrap_or(0.0)).unwrap_or_default();

    let mut tx = pool.begin().await?;

    // 1. Insert core item row
    let item_id: Uuid = sqlx::query_scalar!(
        r#"INSERT INTO items
               (store_id, category_id, department_id, sku, barcode,
                item_name, description, cost_price, selling_price, discount_price,
                discount_price_enabled, image_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id"#,
        payload.store_id, payload.category_id, payload.department_id,
        sku, payload.barcode, payload.item_name, payload.description,
        cost, sell, disc,
        payload.discount_price_enabled.unwrap_or(false),
        payload.image_data,
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
                measurement_type, unit_type, unit_value,
                requires_weight, allow_negative_stock,
                min_increment, default_qty)
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
                   COALESCE($12, 'quantity'),
                   $13,
                   $14,
                   COALESCE($15, FALSE),
                   COALESCE($16, FALSE),
                   $17,
                   $18)"#,
        item_id, payload.store_id,
        payload.is_active, payload.sellable, payload.available_for_pos,
        payload.track_stock, payload.taxable,
        payload.min_stock_level, payload.max_stock_level,
        payload.allow_discount, max_disc,
        payload.measurement_type, payload.unit_type, unit_val,
        payload.requires_weight, payload.allow_negative_stock,
        min_inc, def_qty,
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

    // Queue items + item_stock rows to cloud sync
    crate::database::sync::queue_row(
        &pool, "items", "INSERT", &item_id.to_string(),
        serde_json::json!({ "id": item_id, "store_id": payload.store_id,
                            "item_name": payload.item_name, "sku": sku,
                            "cost_price": cost, "selling_price": sell }),
        Some(payload.store_id),
    ).await;
    crate::database::sync::queue_row(
        &pool, "item_stock", "INSERT",
        &format!("{}:{}", item_id, payload.store_id),
        serde_json::json!({ "item_id": item_id, "store_id": payload.store_id,
                            "quantity": init_qty, "available_quantity": init_qty }),
        Some(payload.store_id),
    ).await;

    write_audit_log(&pool, claims.user_id, Some(payload.store_id), "create", "item",
        &format!("Created item '{}' (SKU: {})", payload.item_name, sku), "info").await;
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
                "SELECT EXISTS(SELECT 1 FROM items WHERE barcode = $1 AND id != $2 AND store_id = $3)",
                new_bc, id, existing.store_id
            )
            .fetch_one(&pool)
            .await?
            .unwrap_or(false);
            if taken {
                return Err(AppError::Validation(format!("Barcode '{new_bc}' is already used by another item in this store")));
            }
        }
    }

    let cost     = payload.cost_price.map(to_dec);
    let sell     = payload.selling_price.map(to_dec);
    let disc     = payload.discount_price.map(to_dec);
    let max_disc = payload.max_discount_percent.map(to_dec);
    let unit_val = payload.unit_value.map(to_dec);
    let min_inc  = payload.min_increment.map(to_dec);
    let def_qty  = payload.default_qty.map(to_dec);

    // ── Update core items row ─────────────────────────────────────────────
    sqlx::query!(
        r#"UPDATE items SET
           category_id           = COALESCE($1,  category_id),
           department_id         = COALESCE($2,  department_id),
           sku                   = COALESCE($3,  sku),
           barcode               = COALESCE($4,  barcode),
           item_name             = COALESCE($5,  item_name),
           description           = COALESCE($6,  description),
           cost_price            = COALESCE($7,  cost_price),
           selling_price         = COALESCE($8,  selling_price),
           discount_price        = COALESCE($9,  discount_price),
           discount_price_enabled = COALESCE($10, discount_price_enabled),
           image_data            = COALESCE($11, image_data),
           updated_at            = NOW()
           WHERE id = $12"#,
        payload.category_id, payload.department_id, payload.sku, payload.barcode,
        payload.item_name, payload.description, cost, sell, disc,
        payload.discount_price_enabled,
        payload.image_data, id,
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
           measurement_type     = COALESCE($8,  measurement_type),
           unit_type            = COALESCE($9,  unit_type),
           unit_value           = COALESCE($10, unit_value),
           requires_weight      = COALESCE($11, requires_weight),
           allow_negative_stock = COALESCE($12, allow_negative_stock),
           min_stock_level      = COALESCE($13, min_stock_level),
           max_stock_level      = COALESCE($14, max_stock_level),
           min_increment        = COALESCE($16, min_increment),
           default_qty          = COALESCE($17, default_qty),
           updated_at           = NOW()
           WHERE item_id = $15"#,
        payload.is_active, payload.sellable, payload.available_for_pos,
        payload.track_stock, payload.taxable, payload.allow_discount,
        max_disc, payload.measurement_type, payload.unit_type, unit_val,
        payload.requires_weight, payload.allow_negative_stock,
        payload.min_stock_level, payload.max_stock_level,
        id, min_inc, def_qty,
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
    if payload.image_data.is_some() { change_lines.push("Image updated".into()); }

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
    if let Some(ref v) = payload.measurement_type {
        let old = existing.measurement_type.as_deref().unwrap_or("quantity");
        if v != old {
            change_lines.push(format!("Measurement type: {old} -> {v}"));
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

    let result = fetch_item(&pool, id).await?;

    // Queue items row to cloud sync
    crate::database::sync::queue_row(
        &pool, "items", "UPDATE", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": result.store_id,
                            "item_name": result.item_name, "sku": result.sku,
                            "cost_price": result.cost_price, "selling_price": result.selling_price }),
        Some(result.store_id),
    ).await;

    write_audit_log(&pool, claims.user_id, Some(result.store_id), "update", "item",
        &format!("Updated item '{}' (id: {})", result.item_name, id), "info").await;
    Ok(result)
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
    state:      State<'_, AppState>,
    token:      String,
    item_id:    Uuid,
    page:       Option<i64>,
    limit:      Option<i64>,
    date_from:  Option<String>,
    date_to:    Option<String>,
    event_type: Option<String>,
) -> AppResult<PagedResult<ItemHistory>> {
    get_item_history_inner(&state, token, item_id, page, limit, date_from, date_to, event_type).await
}

/// Remove an item's image (sets image_data = NULL).
#[tauri::command]
pub async fn remove_item_image(
    state: State<'_, AppState>,
    token: String,
    id:    Uuid,
) -> AppResult<Item> {
    let claims = guard_permission(&state, &token, "items.update").await?;
    let pool   = state.pool().await?;
    sqlx::query!(
        "UPDATE items SET image_data = NULL, updated_at = NOW() WHERE id = $1",
        id
    )
    .execute(&pool)
    .await?;
    let item = fetch_item(&pool, id).await?;
    sqlx::query!(
        r#"INSERT INTO item_history (item_id, store_id, event_type, event_description, performed_by)
           VALUES ($1, $2, 'UPDATE', 'Image removed', $3)"#,
        id, item.store_id, claims.user_id
    )
    .execute(&pool)
    .await?;
    Ok(item)
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
