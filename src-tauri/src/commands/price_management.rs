// ============================================================================
// PRICE MANAGEMENT COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use uuid::Uuid;
use crate::{
    error::{AppError, AppResult},
    models::price::{
        PriceList, PriceListItem, PriceChange, PriceHistory, PriceChangeStats,
        CreatePriceListDto, UpdatePriceListDto, AddPriceListItemDto,
        RequestPriceChangeDto, PriceListFilters,
    },
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;
use super::audit::write_audit_log;

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

// ── Price Lists ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_price_lists(
    state:   State<'_, AppState>,
    token:   String,
    filters: PriceListFilters,
) -> AppResult<PagedResult<PriceList>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool      = state.pool().await?;
    let page      = filters.page.unwrap_or(1).max(1);
    let limit     = filters.limit.unwrap_or(20).clamp(1, 100);
    let offset    = (page - 1) * limit;
    // Extract into owned locals — `as Option<T>` in sqlx macros consumes
    // the value, so we need separate copies for the count and list queries.
    let store_id  = filters.store_id;
    let list_type = filters.list_type;

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM price_lists
           WHERE (store_id  = $1 OR $1 IS NULL)
             AND (list_type = $2 OR $2 IS NULL)"#,
        store_id        as Option<i32>,
        list_type.clone() as Option<String>,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let lists = sqlx::query_as!(
        PriceList,
        r#"SELECT id, store_id, list_name, list_type, description,
                  is_active, created_at, updated_at
           FROM   price_lists
           WHERE (store_id  = $1 OR $1 IS NULL)
             AND (list_type = $2 OR $2 IS NULL)
           ORDER  BY list_name
           LIMIT $3 OFFSET $4"#,
        store_id  as Option<i32>,
        list_type as Option<String>,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(lists, total, page, limit))
}

#[tauri::command]
pub async fn create_price_list(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreatePriceListDto,
) -> AppResult<PriceList> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO price_lists (store_id, list_name, list_type, description)
           VALUES ($1,$2,$3,$4) RETURNING id"#,
        payload.store_id,
        payload.list_name,
        payload.list_type,
        payload.description,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        PriceList,
        "SELECT id, store_id, list_name, list_type, description, is_active, created_at, updated_at
         FROM   price_lists WHERE id = $1",
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn add_price_list_item(
    state:   State<'_, AppState>,
    token:   String,
    payload: AddPriceListItemDto,
) -> AppResult<PriceListItem> {
    guard_permission(&state, &token, "items.update").await?;
    let pool  = state.pool().await?;
    let price = to_dec(payload.price);

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO price_list_items
               (price_list_id, item_id, price, effective_from, effective_to)
           VALUES ($1,$2,$3,
                   $4::text::timestamptz,
                   $5::text::timestamptz)
           ON CONFLICT (price_list_id, item_id)
           DO UPDATE SET price          = EXCLUDED.price,
                         effective_from = EXCLUDED.effective_from,
                         effective_to   = EXCLUDED.effective_to
           RETURNING id"#,
        payload.price_list_id,
        payload.item_id,
        price,
        payload.effective_from.as_deref(),
        payload.effective_to.as_deref(),
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        PriceListItem,
        r#"SELECT pli.id, pli.price_list_id, pli.item_id,
                  i.item_name, i.sku,
                  pli.price, pli.effective_from, pli.effective_to, pli.created_at
           FROM   price_list_items pli
           JOIN   items i ON i.id = pli.item_id
           WHERE  pli.id = $1"#,
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_price_list_items(
    state:         State<'_, AppState>,
    token:         String,
    price_list_id: i32,
) -> AppResult<Vec<PriceListItem>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        PriceListItem,
        r#"SELECT pli.id, pli.price_list_id, pli.item_id,
                  i.item_name, i.sku,
                  pli.price, pli.effective_from, pli.effective_to, pli.created_at
           FROM   price_list_items pli
           JOIN   items i ON i.id = pli.item_id
           WHERE  pli.price_list_id = $1
           ORDER  BY i.item_name"#,
        price_list_id,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Remove item from Price List ───────────────────────────────────────────────

#[tauri::command]
pub async fn remove_price_list_item(
    state:         State<'_, AppState>,
    token:         String,
    price_list_id: i32,
    item_id:       Uuid,
) -> AppResult<()> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "DELETE FROM price_list_items WHERE price_list_id = $1 AND item_id = $2",
        price_list_id,
        item_id,
    )
    .execute(&pool)
    .await?;
    Ok(())
}

// ── Update / Delete Price List ────────────────────────────────────────────────

#[tauri::command]
pub async fn update_price_list(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdatePriceListDto,
) -> AppResult<PriceList> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        r#"UPDATE price_lists SET
           list_name   = COALESCE($1, list_name),
           description = COALESCE($2, description),
           is_active   = COALESCE($3, is_active),
           updated_at  = NOW()
           WHERE id = $4"#,
        payload.list_name,
        payload.description,
        payload.is_active,
        id,
    )
    .execute(&pool)
    .await?;

    sqlx::query_as!(
        PriceList,
        "SELECT id, store_id, list_name, list_type, description, is_active, created_at, updated_at
         FROM   price_lists WHERE id = $1",
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn delete_price_list(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;

    let item_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM price_list_items WHERE price_list_id = $1",
        id,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    if item_count > 0 {
        return Err(AppError::Validation(format!(
            "Cannot delete price list: it has {item_count} item(s). Remove items first."
        )));
    }

    sqlx::query!("DELETE FROM price_lists WHERE id = $1", id)
        .execute(&pool)
        .await?;

    Ok(())
}

// ── Price Change Requests ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn request_price_change(
    state:   State<'_, AppState>,
    token:   String,
    payload: RequestPriceChangeDto,
) -> AppResult<PriceChange> {
    let claims = guard_permission(&state, &token, "items.update").await?;
    let pool   = state.pool().await?;

    // Capture the current price for the audit record
    let old_price: Decimal = sqlx::query_scalar!(
        "SELECT selling_price FROM items WHERE id = $1",
        payload.item_id,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Item not found".into()))?;

    let new_price = to_dec(payload.new_price);

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO price_changes
               (store_id, item_id, change_type, old_price, new_price,
                effective_at, reason, requested_by)
           VALUES ($1,$2,$3,$4,$5,
                   COALESCE($6::text::timestamptz, NOW()),
                   $7,$8)
           RETURNING id"#,
        payload.store_id,
        payload.item_id,
        payload.change_type,
        old_price,
        new_price,
        payload.effective_at.as_deref(),
        payload.reason,
        claims.user_id,
    )
    .fetch_one(&pool)
    .await?;

    let pc = sqlx::query_as!(
        PriceChange,
        r#"SELECT pc.id, pc.store_id, pc.item_id,
                  i.item_name,
                  pc.change_type, pc.old_price, pc.new_price, pc.effective_at,
                  pc.reason, pc.status, pc.requested_by, pc.approved_by, pc.created_at
           FROM   price_changes pc
           JOIN   items i ON i.id = pc.item_id
           WHERE  pc.id = $1"#,
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)?;
    write_audit_log(&pool, claims.user_id, Some(payload.store_id), "request_price_change", "item",
        &format!("Price change requested for '{}': ₦{} → ₦{}", pc.item_name.as_deref().unwrap_or(""), old_price, new_price), "info").await;
    Ok(pc)
}

#[tauri::command]
pub async fn approve_price_change(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<PriceChange> {
    let claims = guard_permission(&state, &token, "items.update").await?;
    let pool   = state.pool().await?;

    let pc = sqlx::query!(
        "SELECT item_id, new_price, store_id, status FROM price_changes WHERE id = $1",
        id,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Price change not found".into()))?;

    if pc.status != "pending" {
        return Err(AppError::Validation(format!(
            "Price change is already '{}'.", pc.status
        )));
    }

    let mut db_tx = pool.begin().await?;

    // Record old price in history before overwriting it
    let old_price: Decimal = sqlx::query_scalar!(
        "SELECT selling_price FROM items WHERE id = $1",
        pc.item_id,
    )
    .fetch_one(&mut *db_tx)
    .await?;

    sqlx::query!(
        r#"INSERT INTO price_history (item_id, store_id, old_price, new_price, changed_by, reason)
           VALUES ($1,$2,$3,$4,$5,'Price change approval')"#,
        pc.item_id,
        pc.store_id,
        old_price,
        pc.new_price,
        claims.user_id,
    )
    .execute(&mut *db_tx)
    .await?;

    // Apply the new selling price to the item
    sqlx::query!(
        "UPDATE items SET selling_price = $1, updated_at = NOW() WHERE id = $2",
        pc.new_price,
        pc.item_id,
    )
    .execute(&mut *db_tx)
    .await?;

    sqlx::query!(
        "UPDATE price_changes SET status = 'applied', approved_by = $1 WHERE id = $2",
        claims.user_id,
        id,
    )
    .execute(&mut *db_tx)
    .await?;

    db_tx.commit().await?;

    let approved = sqlx::query_as!(
        PriceChange,
        r#"SELECT pc.id, pc.store_id, pc.item_id,
                  i.item_name,
                  pc.change_type, pc.old_price, pc.new_price, pc.effective_at,
                  pc.reason, pc.status, pc.requested_by, pc.approved_by, pc.created_at
           FROM   price_changes pc
           JOIN   items i ON i.id = pc.item_id
           WHERE  pc.id = $1"#,
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)?;
    write_audit_log(&pool, claims.user_id, Some(pc.store_id), "approve_price_change", "item",
        &format!("Price change approved for '{}': ₦{} → ₦{}", approved.item_name.as_deref().unwrap_or(""), old_price, pc.new_price), "info").await;
    Ok(approved)
}

#[tauri::command]
pub async fn reject_price_change(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<PriceChange> {
    let claims = guard_permission(&state, &token, "items.update").await?;
    let pool   = state.pool().await?;

    let status: Option<String> = sqlx::query_scalar!(
        "SELECT status FROM price_changes WHERE id = $1",
        id,
    )
    .fetch_optional(&pool)
    .await?;

    match status.as_deref() {
        None             => return Err(AppError::NotFound("Price change not found".into())),
        Some("applied")  => return Err(AppError::Validation("Cannot reject an already-applied change.".into())),
        Some("rejected") => return Err(AppError::Validation("Already rejected.".into())),
        _                => {}
    }

    sqlx::query!(
        "UPDATE price_changes SET status = 'rejected', approved_by = $1 WHERE id = $2",
        claims.user_id,
        id,
    )
    .execute(&pool)
    .await?;

    sqlx::query_as!(
        PriceChange,
        r#"SELECT pc.id, pc.store_id, pc.item_id,
                  i.item_name,
                  pc.change_type, pc.old_price, pc.new_price, pc.effective_at,
                  pc.reason, pc.status, pc.requested_by, pc.approved_by, pc.created_at
           FROM   price_changes pc
           JOIN   items i ON i.id = pc.item_id
           WHERE  pc.id = $1"#,
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_price_changes(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
    status:   Option<String>,
    search:   Option<String>,
    page:     Option<i64>,
    limit:    Option<i64>,
) -> AppResult<PagedResult<PriceChange>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool   = state.pool().await?;
    let page   = page.unwrap_or(1).max(1);
    let limit  = limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;

    let search_pat = search
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));
    let status_clone = status.clone();
    let search_clone = search_pat.clone();

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM   price_changes pc
           JOIN   items i ON i.id = pc.item_id
           WHERE ($1::int  IS NULL OR pc.store_id = $1)
             AND ($2::text IS NULL OR pc.status   = $2)
             AND ($3::text IS NULL OR i.item_name ILIKE $3)"#,
        store_id       as Option<i32>,
        status_clone   as Option<String>,
        search_clone   as Option<String>,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let records = sqlx::query_as!(
        PriceChange,
        r#"SELECT pc.id, pc.store_id, pc.item_id,
                  i.item_name,
                  pc.change_type, pc.old_price, pc.new_price, pc.effective_at,
                  pc.reason, pc.status, pc.requested_by, pc.approved_by, pc.created_at
           FROM   price_changes pc
           JOIN   items i ON i.id = pc.item_id
           WHERE ($1::int  IS NULL OR pc.store_id = $1)
             AND ($2::text IS NULL OR pc.status   = $2)
             AND ($3::text IS NULL OR i.item_name ILIKE $3)
           ORDER  BY pc.created_at DESC
           LIMIT $4 OFFSET $5"#,
        store_id      as Option<i32>,
        status        as Option<String>,
        search_pat    as Option<String>,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(records, total, page, limit))
}

/// Efficient KPI stats for the price management overview — reads from
/// v_price_change_stats instead of fetching 200 rows and counting in JS.
#[allow(dead_code)]
#[tauri::command]
pub async fn get_price_change_stats(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<PriceChangeStats> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;

    let row = sqlx::query_as!(
        PriceChangeStats,
        r#"SELECT
               COALESCE(total_count,    0) AS "total_count!: i64",
               COALESCE(pending_count,  0) AS "pending_count!: i64",
               COALESCE(applied_count,  0) AS "applied_count!: i64",
               COALESCE(rejected_count, 0) AS "rejected_count!: i64"
           FROM v_price_change_stats
           WHERE store_id = $1"#,
        store_id
    )
    .fetch_optional(&pool)
    .await?
    .unwrap_or(PriceChangeStats {
        total_count:    0,
        pending_count:  0,
        applied_count:  0,
        rejected_count: 0,
    });

    Ok(row)
}

// ── Price History ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_price_history(
    state:    State<'_, AppState>,
    token:    String,
    item_id:  Uuid,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<PriceHistory>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;
    let lim  = limit.unwrap_or(50).clamp(1, 200);

    sqlx::query_as!(
        PriceHistory,
        r#"SELECT ph.id, ph.item_id,
                  i.item_name,
                  ph.store_id,
                  ph.old_price   AS "old_price!",
                  ph.new_price   AS "new_price!",
                  ph.changed_by  AS "changed_by!",
                  ph.reason, ph.created_at
           FROM   price_history ph
           JOIN   items i ON i.id = ph.item_id
           WHERE  ph.item_id = $1
             AND (ph.store_id = $2 OR $2 IS NULL)
           ORDER  BY ph.created_at DESC
           LIMIT  $3"#,
        item_id,
        store_id as Option<i32>,
        lim,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}
