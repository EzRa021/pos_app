// ============================================================================
// INVENTORY COMMANDS  (aligned with quantum-pos-app inventory.service.js)
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use uuid::Uuid;
use crate::{
    error::{AppError, AppResult},
    models::inventory::{
        InventoryRecord, InventoryItemRecord, InventoryItemDetail,
        InventoryFilters, MovementHistoryFilters,
        LowStockItem, InventorySummary,
        MovementRecord, RestockDto, RestockResult,
        AdjustInventoryDto, AdjustInventoryResult,
        StockCount, StockCountItem, CountSessionFilters,
        StartCountSessionDto, RecordCountDto,
        VarianceReport, VarianceSummary, StockCountSession,
        StockDeductResult,
    },
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

// ── pub(crate) inner wrappers for HTTP dispatch ───────────────────────────────

pub(crate) async fn get_inventory_inner(
    state:   &AppState,
    token:   String,
    filters: InventoryFilters,
) -> AppResult<PagedResult<InventoryRecord>> {
    guard_permission(state, &token, "inventory.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 500);
    let offset = (page - 1) * limit;
    let search = filters.search.as_ref().map(|s| format!("%{s}%"));

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM   items i
           JOIN   item_stock    istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           JOIN   item_settings ist    ON ist.item_id = i.id
           LEFT JOIN categories c     ON c.id = i.category_id
           LEFT JOIN departments d    ON d.id = i.department_id
           WHERE ist.archived_at IS NULL
             AND ($1::int  IS NULL OR i.store_id    = $1)
             AND ($2::int  IS NULL OR i.category_id = $2)
             AND ($3::int  IS NULL OR i.department_id = $3)
             AND ($4::bool IS NULL OR (ist.track_stock = TRUE AND istock.quantity <= ist.min_stock_level::numeric))
             AND ($5::text IS NULL OR i.item_name ILIKE $5 OR i.sku ILIKE $5 OR i.barcode ILIKE $5)"#,
        filters.store_id, filters.category_id, filters.department_id,
        filters.low_stock, search,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let records = sqlx::query_as!(
        InventoryRecord,
        r#"SELECT i.id AS item_id, i.store_id, i.item_name, i.sku, i.barcode,
                  c.category_name, d.department_name,
                  istock.quantity, istock.available_quantity, istock.reserved_quantity,
                  ist.min_stock_level, ist.max_stock_level,
                  i.cost_price, i.selling_price,
                  ist.is_active, ist.track_stock,
                  istock.last_count_date,
                  istock.updated_at,
                  CASE
                    WHEN ist.min_stock_level IS NOT NULL
                      AND istock.quantity <= ist.min_stock_level::numeric THEN 'low'
                    WHEN ist.max_stock_level IS NOT NULL
                      AND istock.quantity >= ist.max_stock_level::numeric THEN 'high'
                    ELSE 'normal'
                  END AS stock_status
           FROM   items i
           JOIN   item_stock    istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           JOIN   item_settings ist    ON ist.item_id = i.id
           LEFT JOIN categories c     ON c.id = i.category_id
           LEFT JOIN departments d    ON d.id = i.department_id
           WHERE ist.archived_at IS NULL
             AND ($1::int  IS NULL OR i.store_id    = $1)
             AND ($2::int  IS NULL OR i.category_id = $2)
             AND ($3::int  IS NULL OR i.department_id = $3)
             AND ($4::bool IS NULL OR (ist.track_stock = TRUE AND istock.quantity <= ist.min_stock_level::numeric))
             AND ($5::text IS NULL OR i.item_name ILIKE $5 OR i.sku ILIKE $5 OR i.barcode ILIKE $5)
           ORDER  BY i.item_name ASC
           LIMIT $6 OFFSET $7"#,
        filters.store_id, filters.category_id, filters.department_id,
        filters.low_stock, search, limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(records, total, page, limit))
}

pub(crate) async fn get_inventory_item_inner(
    state:    &AppState,
    token:    String,
    item_id:  Uuid,
    store_id: i32,
) -> AppResult<InventoryItemDetail> {
    guard_permission(state, &token, "inventory.read").await?;
    let pool = state.pool().await?;

    let item = sqlx::query_as!(
        InventoryItemRecord,
        r#"SELECT i.id, i.store_id, i.sku, i.barcode, i.item_name, i.description,
                  i.cost_price, i.selling_price,
                  c.id AS category_id, c.category_name,
                  d.id AS department_id, d.department_name,
                  ist.track_stock, ist.min_stock_level, ist.max_stock_level, ist.allow_negative_stock,
                  COALESCE(istock.quantity, 0)            AS quantity,
                  istock.reserved_quantity,
                  COALESCE(istock.available_quantity, 0)  AS available_quantity,
                  istock.last_count_date,
                  istock.updated_at,
                  CASE
                    WHEN ist.min_stock_level IS NOT NULL
                      AND COALESCE(istock.quantity, 0) <= ist.min_stock_level::numeric THEN 'low'
                    WHEN ist.max_stock_level IS NOT NULL
                      AND COALESCE(istock.quantity, 0) >= ist.max_stock_level::numeric THEN 'high'
                    ELSE 'normal'
                  END AS stock_status
           FROM   items i
           JOIN   categories c    ON c.id = i.category_id
           LEFT JOIN departments d ON d.id = i.department_id
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE  i.id = $1 AND i.store_id = $2"#,
        item_id, store_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Item {item_id} not found in store {store_id}")))?;

    let movement_history = sqlx::query_as!(
        MovementRecord,
        r#"SELECT h.id, h.item_id, i.item_name, i.sku,
                  h.event_type, h.event_description,
                  h.quantity_before, h.quantity_after, h.quantity_change,
                  h.reference_type, h.reference_id,
                  h.performed_by, u.username AS performed_by_username,
                  h.performed_at, h.notes
           FROM   item_history h
           JOIN   items i ON i.id = h.item_id
           LEFT JOIN users u ON u.id = h.performed_by
           WHERE  h.item_id = $1 AND h.store_id = $2
           ORDER  BY h.performed_at DESC
           LIMIT 20"#,
        item_id, store_id
    )
    .fetch_all(&pool)
    .await?;

    Ok(InventoryItemDetail { item, movement_history })
}

pub(crate) async fn get_low_stock_inner(
    state:    &AppState,
    token:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<LowStockItem>> {
    guard_permission(state, &token, "inventory.read").await?;
    let pool  = state.pool().await?;
    let limit = limit.unwrap_or(50).clamp(1, 500);

    sqlx::query_as!(
        LowStockItem,
        r#"SELECT i.id AS item_id, i.store_id, i.item_name, i.sku, i.barcode,
                  c.category_name,
                  ist.min_stock_level,
                  istock.quantity, istock.available_quantity,
                  i.cost_price, i.selling_price,
                  (ist.min_stock_level::numeric - istock.quantity) AS units_to_reorder
           FROM   items i
           JOIN   categories c    ON c.id = i.category_id
           JOIN   item_settings ist ON ist.item_id = i.id
           JOIN   item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE  ist.track_stock   = TRUE
             AND  ist.archived_at   IS NULL
             AND  ist.is_active     = TRUE
             AND  istock.quantity  <= ist.min_stock_level::numeric
             AND ($1::int IS NULL OR i.store_id = $1)
           ORDER  BY (ist.min_stock_level::numeric - istock.quantity) DESC, i.item_name ASC
           LIMIT $2"#,
        store_id, limit
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn restock_item_inner(
    state:   &AppState,
    token:   String,
    payload: RestockDto,
) -> AppResult<RestockResult> {
    let claims = guard_permission(state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;

    if payload.quantity <= 0.0 {
        return Err(AppError::Validation("Quantity must be positive for a restock".into()));
    }

    let qty = to_dec(payload.quantity);
    let mut tx = pool.begin().await?;

    // Verify item exists in this store
    let item_name: String = sqlx::query_scalar!(
        "SELECT item_name FROM items WHERE id = $1 AND store_id = $2",
        payload.item_id, payload.store_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Item not found or does not belong to this store".into()))?;

    let qty_before: Decimal = sqlx::query_scalar!(
        "SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2",
        payload.item_id, payload.store_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Item stock record not found".into()))?;

    let qty_after = qty_before + qty;

    sqlx::query!(
        "UPDATE item_stock SET quantity = $1, available_quantity = $1, updated_at = NOW()
         WHERE item_id = $2 AND store_id = $3",
        qty_after, payload.item_id, payload.store_id,
    )
    .execute(&mut *tx)
    .await?;

    let description = format!("Restocked {} unit(s) of {item_name}", payload.quantity);
    sqlx::query!(
        r#"INSERT INTO item_history
               (item_id, store_id, event_type, event_description,
                quantity_before, quantity_after, quantity_change,
                performed_by, notes)
           VALUES ($1, $2, 'RESTOCK', $3, $4, $5, $6, $7, $8)"#,
        payload.item_id, payload.store_id, description,
        qty_before, qty_after, qty,
        claims.user_id, payload.note,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(RestockResult {
        item_id:         payload.item_id,
        store_id:        payload.store_id,
        item_name,
        quantity_before: qty_before,
        quantity_after:  qty_after,
        quantity_added:  qty,
    })
}

pub(crate) async fn adjust_inventory_inner(
    state:   &AppState,
    token:   String,
    payload: AdjustInventoryDto,
) -> AppResult<AdjustInventoryResult> {
    let claims = guard_permission(state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;

    // Validate reason
    let valid_reasons = ["damage", "theft", "audit", "correction", "loss", "other"];
    if !valid_reasons.contains(&payload.reason.as_str()) {
        return Err(AppError::Validation(
            format!("Invalid reason. Must be one of: {}", valid_reasons.join(", "))
        ));
    }

    let adj = to_dec(payload.adjustment_quantity);
    let mut tx = pool.begin().await?;

    // Verify item and get allow_negative_stock flag
    struct ItemInfo { item_name: String, allow_negative_stock: Option<bool> }
    let info = sqlx::query!(
        r#"SELECT i.item_name, ist.allow_negative_stock
           FROM items i
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           WHERE i.id = $1 AND i.store_id = $2"#,
        payload.item_id, payload.store_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Item not found or does not belong to this store".into()))?;

    let item_name = info.item_name;
    // allow_negative_stock is BOOLEAN NOT NULL in the schema → bool (not Option<bool>)
    let allow_negative = info.allow_negative_stock;

    let qty_before: Decimal = sqlx::query_scalar!(
        "SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2",
        payload.item_id, payload.store_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Item stock record not found".into()))?;

    let qty_after = qty_before + adj;

    if qty_after < Decimal::ZERO && !allow_negative {
        return Err(AppError::Validation(format!(
            "Cannot adjust quantity below 0. Current: {qty_before}, Adjustment: {adj}"
        )));
    }

    sqlx::query!(
        "UPDATE item_stock SET quantity = $1, updated_at = NOW() WHERE item_id = $2 AND store_id = $3",
        qty_after, payload.item_id, payload.store_id,
    )
    .execute(&mut *tx)
    .await?;

    let sign  = if adj >= Decimal::ZERO { "+" } else { "" };
    let desc  = format!("Stock adjustment ({reason}): {sign}{adj} unit(s)", reason = payload.reason);
    let notes = match &payload.notes {
        Some(n) => format!("Reason: {} - {n}", payload.reason),
        None    => format!("Reason: {}", payload.reason),
    };

    sqlx::query!(
        r#"INSERT INTO item_history
               (item_id, store_id, event_type, event_description,
                quantity_before, quantity_after, quantity_change,
                performed_by, notes)
           VALUES ($1, $2, 'ADJUSTMENT', $3, $4, $5, $6, $7, $8)"#,
        payload.item_id, payload.store_id, desc,
        qty_before, qty_after, adj,
        claims.user_id, notes,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(AdjustInventoryResult {
        item_id:           payload.item_id,
        store_id:          payload.store_id,
        item_name,
        adjustment_reason: payload.reason,
        quantity_before:   qty_before,
        quantity_after:    qty_after,
        quantity_adjusted: adj,
    })
}

pub(crate) async fn get_movement_history_inner(
    state:    &AppState,
    token:    String,
    store_id: i32,
    filters:  MovementHistoryFilters,
) -> AppResult<PagedResult<MovementRecord>> {
    guard_permission(state, &token, "inventory.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(50).clamp(1, 200);
    let offset = (page - 1) * limit;
    let event  = filters.event_type.as_ref().map(|e| e.to_uppercase());

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM   item_history h
           JOIN   items i ON i.id = h.item_id
           WHERE  h.store_id = $1
             AND ($2::uuid IS NULL OR h.item_id     = $2)
             AND ($3::text IS NULL OR h.event_type  = $3)
             AND ($4::int  IS NULL OR h.performed_by = $4)
             AND ($5::timestamptz IS NULL OR h.performed_at >= $5)
             AND ($6::timestamptz IS NULL OR h.performed_at <= $6)"#,
        store_id,
        filters.item_id,
        event,
        filters.performed_by,
        filters.start_date,
        filters.end_date,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let records = sqlx::query_as!(
        MovementRecord,
        r#"SELECT h.id, h.item_id, i.item_name, i.sku,
                  h.event_type, h.event_description,
                  h.quantity_before, h.quantity_after, h.quantity_change,
                  h.reference_type, h.reference_id,
                  h.performed_by, u.username AS performed_by_username,
                  h.performed_at, h.notes
           FROM   item_history h
           JOIN   items i ON i.id = h.item_id
           LEFT JOIN users u ON u.id = h.performed_by
           WHERE  h.store_id = $1
             AND ($2::uuid IS NULL OR h.item_id      = $2)
             AND ($3::text IS NULL OR h.event_type   = $3)
             AND ($4::int  IS NULL OR h.performed_by = $4)
             AND ($5::timestamptz IS NULL OR h.performed_at >= $5)
             AND ($6::timestamptz IS NULL OR h.performed_at <= $6)
           ORDER  BY h.performed_at DESC
           LIMIT $7 OFFSET $8"#,
        store_id,
        filters.item_id,
        event,
        filters.performed_by,
        filters.start_date,
        filters.end_date,
        limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(records, total, page, limit))
}

pub(crate) async fn get_inventory_summary_inner(
    state:    &AppState,
    token:    String,
    store_id: i32,
) -> AppResult<InventorySummary> {
    guard_permission(state, &token, "inventory.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        InventorySummary,
        r#"SELECT
             COUNT(DISTINCT i.id)                                                  AS "total_items!",
             COUNT(DISTINCT CASE WHEN istock.quantity <= ist.min_stock_level::numeric THEN i.id END) AS "low_stock_count!",
             COUNT(DISTINCT CASE WHEN istock.quantity = 0 THEN i.id END)          AS "out_of_stock_count!",
             COALESCE(SUM(istock.quantity * i.cost_price),  0)                    AS "total_inventory_value!",
             COALESCE(AVG(istock.quantity),                 0)                    AS "avg_stock_level!",
             COALESCE(MIN(istock.quantity),                 0)                    AS "min_stock_level_actual!",
             COALESCE(MAX(istock.quantity),                 0)                    AS "max_stock_level_actual!"
           FROM   items i
           LEFT JOIN item_settings ist    ON ist.item_id = i.id
           LEFT JOIN item_stock    istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE  i.store_id = $1
             AND  ist.archived_at IS NULL"#,
        store_id
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn start_count_session_inner(
    state:    &AppState,
    token:    String,
    store_id: i32,
    payload:  StartCountSessionDto,
) -> AppResult<StockCount> {
    let claims     = guard_permission(state, &token, "inventory.stock_count").await?;
    let pool       = state.pool().await?;
    let count_type = payload.count_type.as_deref().unwrap_or("full");
    let mut tx     = pool.begin().await?;

    // Generate session number: COUNT-YYYY-NNNN
    let next_num: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) + 1 FROM stock_count_sessions
           WHERE store_id = $1 AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)"#,
        store_id
    )
    .fetch_one(&mut *tx)
    .await?
    .unwrap_or(1);
    let year = chrono::Utc::now().format("%Y");
    let session_number = format!("COUNT-{year}-{next_num:04}");

    // Total trackable active items in the store
    // NOTE: using item_settings.is_active (NOT items.is_active) — quantum-pos-app has a bug here
    let total_items: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM items i
           JOIN item_settings ist ON ist.item_id = i.id
           WHERE i.store_id = $1 AND ist.track_stock = TRUE AND ist.is_active = TRUE"#,
        store_id
    )
    .fetch_one(&mut *tx)
    .await?
    .unwrap_or(0);

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO stock_count_sessions
               (session_number, store_id, count_type, started_by, total_items, notes, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'in_progress')
           RETURNING id"#,
        session_number, store_id, count_type, claims.user_id, total_items as i32, payload.notes,
    )
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    fetch_stock_count(&pool, id).await
}

pub(crate) async fn record_count_inner(
    state:      &AppState,
    token:      String,
    session_id: i32,
    store_id:   i32,
    payload:    RecordCountDto,
) -> AppResult<StockCountItem> {
    let claims = guard_permission(state, &token, "inventory.stock_count").await?;
    let pool   = state.pool().await?;
    let counted = to_dec(payload.counted_quantity);
    let mut tx  = pool.begin().await?;

    // Verify session exists, is in_progress, and belongs to this store
    let session = sqlx::query!(
        "SELECT id, status, store_id FROM stock_count_sessions WHERE id = $1",
        session_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Stock count session not found".into()))?;

    if session.status != "in_progress" {
        return Err(AppError::Validation(format!("Cannot record count: session is {}", session.status)));
    }
    if session.store_id != store_id {
        return Err(AppError::Validation("Store ID mismatch".into()));
    }

    // Get current system quantity and cost price
    let stock = sqlx::query!(
        r#"SELECT st.quantity, i.cost_price
           FROM item_stock st
           JOIN items i ON i.id = st.item_id
           WHERE st.item_id = $1 AND st.store_id = $2"#,
        payload.item_id, store_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Item stock record not found".into()))?;

    // Upsert stock count item
    let count_item_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO stock_count_items
               (session_id, item_id, store_id, system_quantity, counted_quantity, cost_price, counted_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (session_id, item_id)
           DO UPDATE SET
               counted_quantity = EXCLUDED.counted_quantity,
               counted_by       = EXCLUDED.counted_by,
               counted_at       = CURRENT_TIMESTAMP,
               notes            = EXCLUDED.notes
           RETURNING id"#,
        session_id, payload.item_id, store_id,
        stock.quantity, counted, stock.cost_price,
        claims.user_id, payload.notes,
    )
    .fetch_one(&mut *tx)
    .await?;

    // Update session statistics
    sqlx::query!(
        r#"UPDATE stock_count_sessions SET
               items_counted = (SELECT COUNT(*) FROM stock_count_items WHERE session_id = $1),
               items_with_variance = (SELECT COUNT(*) FROM stock_count_items
                                      WHERE session_id = $1 AND variance_quantity != 0),
               total_variance_value = (SELECT COALESCE(SUM(variance_value), 0)
                                       FROM stock_count_items WHERE session_id = $1),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1"#,
        session_id
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    fetch_count_item(&pool, count_item_id).await
}

pub(crate) async fn complete_count_session_inner(
    state:           &AppState,
    token:           String,
    session_id:      i32,
    store_id:        i32,
    apply_variances: bool,
) -> AppResult<VarianceReport> {
    let claims = guard_permission(state, &token, "inventory.stock_count").await?;
    let pool   = state.pool().await?;
    let mut tx = pool.begin().await?;

    let session = sqlx::query!(
        "SELECT id, status, store_id FROM stock_count_sessions WHERE id = $1",
        session_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Stock count session not found".into()))?;

    if session.status != "in_progress" {
        return Err(AppError::Validation(format!("Cannot complete: session is {}", session.status)));
    }
    if session.store_id != store_id {
        return Err(AppError::Validation("Store ID mismatch".into()));
    }

    // Final statistics update
    sqlx::query!(
        r#"UPDATE stock_count_sessions SET
               items_counted = (SELECT COUNT(*) FROM stock_count_items WHERE session_id = $1),
               items_with_variance = (SELECT COUNT(*) FROM stock_count_items
                                      WHERE session_id = $1 AND variance_quantity != 0),
               total_variance_value = (SELECT COALESCE(SUM(variance_value), 0)
                                       FROM stock_count_items WHERE session_id = $1),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1"#,
        session_id
    )
    .execute(&mut *tx)
    .await?;

    // Mark session completed
    sqlx::query!(
        r#"UPDATE stock_count_sessions
           SET status = 'completed', completed_by = $1, completed_at = CURRENT_TIMESTAMP
           WHERE id = $2"#,
        claims.user_id, session_id
    )
    .execute(&mut *tx)
    .await?;

    // Apply variances if requested
    if apply_variances {
        apply_variances_tx(&mut tx, session_id, claims.user_id, store_id).await?;
    }

    tx.commit().await?;

    get_variance_report_inner(state, token, session_id, store_id).await
}

pub(crate) async fn get_variance_report_inner(
    state:      &AppState,
    token:      String,
    session_id: i32,
    store_id:   i32,
) -> AppResult<VarianceReport> {
    guard_permission(state, &token, "inventory.stock_count").await?;
    let pool = state.pool().await?;

    let session = sqlx::query!(
        r#"SELECT id, session_number, status, started_at, completed_at,
                  total_items, items_counted, items_with_variance, total_variance_value
           FROM stock_count_sessions WHERE id = $1 AND store_id = $2"#,
        session_id, store_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Stock count session not found".into()))?;

    let items = sqlx::query_as!(
        StockCountItem,
        r#"SELECT ci.id, ci.session_id, ci.item_id, ci.store_id,
                  ci.system_quantity, ci.counted_quantity,
                  ci.variance_quantity, ci.variance_value, ci.variance_percentage,
                  ci.cost_price, ci.counted_by, ci.counted_at, ci.notes,
                  ci.is_adjusted, ci.adjustment_id,
                  i.item_name, i.sku, i.barcode,
                  c.category_name
           FROM   stock_count_items ci
           JOIN   items i ON i.id = ci.item_id
           LEFT JOIN categories c ON c.id = i.category_id
           WHERE  ci.session_id = $1
           ORDER  BY ABS(COALESCE(ci.variance_value, 0)) DESC, i.item_name ASC"#,
        session_id
    )
    .fetch_all(&pool)
    .await?;

    let overage_count  = items.iter().filter(|i| i.variance_quantity.map(|v| v > Decimal::ZERO).unwrap_or(false)).count() as i64;
    let shortage_count = items.iter().filter(|i| i.variance_quantity.map(|v| v < Decimal::ZERO).unwrap_or(false)).count() as i64;
    let overage_value  = items.iter().filter_map(|i| if i.variance_quantity.map(|v| v > Decimal::ZERO).unwrap_or(false) { i.variance_value } else { None }).fold(Decimal::ZERO, |acc, v| acc + v);
    let shortage_value = items.iter().filter_map(|i| if i.variance_quantity.map(|v| v < Decimal::ZERO).unwrap_or(false) { i.variance_value } else { None }).fold(Decimal::ZERO, |acc, v| acc + v);
    // items_counted / items_with_variance are NOT NULL DEFAULT 0 → i32 from query!()
    let items_counted  = session.items_counted;
    let items_variance = session.items_with_variance;

    let summary = VarianceSummary {
        total_items:            session.total_items,
        items_counted:          session.items_counted,
        items_with_variance:    session.items_with_variance,
        items_without_variance: (items_counted - items_variance).max(0) as i64,
        // total_variance_value is NOT NULL DEFAULT 0 → Decimal from query!()
        total_variance_value:   session.total_variance_value,
        overage_count,
        shortage_count,
        overage_value,
        shortage_value,
    };

    Ok(VarianceReport {
        session: StockCountSession {
            id:             session.id,
            session_number: session.session_number,
            status:         session.status,
            started_at:     session.started_at,
            completed_at:   session.completed_at,
        },
        summary,
        items,
    })
}

pub(crate) async fn apply_variances_standalone_inner(
    state:      &AppState,
    token:      String,
    session_id: i32,
    store_id:   i32,
) -> AppResult<serde_json::Value> {
    let claims = guard_permission(state, &token, "inventory.stock_count").await?;
    let pool   = state.pool().await?;
    let mut tx = pool.begin().await?;
    apply_variances_tx(&mut tx, session_id, claims.user_id, store_id).await?;
    tx.commit().await?;
    Ok(serde_json::json!({ "success": true, "message": "Variances applied to inventory successfully" }))
}

pub(crate) async fn get_count_session_inner(
    state:      &AppState,
    token:      String,
    session_id: i32,
    store_id:   i32,
) -> AppResult<StockCount> {
    guard_permission(state, &token, "inventory.stock_count").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        StockCount,
        r#"SELECT s.id, s.session_number, s.store_id, s.count_type,
                  s.started_by, s.completed_by, s.status, s.notes,
                  s.total_items, s.items_counted, s.items_with_variance,
                  s.total_variance_value,
                  s.started_at, s.completed_at, s.created_at,
                  CASE WHEN u1.id IS NOT NULL THEN u1.username END AS started_by_username,
                  CASE WHEN u2.id IS NOT NULL THEN u2.username END AS completed_by_username,
                  st.store_name
           FROM   stock_count_sessions s
           LEFT JOIN users  u1 ON u1.id = s.started_by
           LEFT JOIN users  u2 ON u2.id = s.completed_by
           JOIN   stores st ON st.id = s.store_id
           WHERE  s.id = $1 AND s.store_id = $2"#,
        session_id, store_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Stock count session {session_id} not found")))
}

pub(crate) async fn get_count_sessions_inner(
    state:   &AppState,
    token:   String,
    filters: CountSessionFilters,
) -> AppResult<PagedResult<StockCount>> {
    guard_permission(state, &token, "inventory.stock_count").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM stock_count_sessions s
           WHERE ($1::int  IS NULL OR s.store_id   = $1)
             AND ($2::text IS NULL OR s.status     = $2)
             AND ($3::text IS NULL OR s.count_type = $3)"#,
        filters.store_id, filters.status, filters.count_type,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let sessions = sqlx::query_as!(
        StockCount,
        r#"SELECT s.id, s.session_number, s.store_id, s.count_type,
                  s.started_by, s.completed_by, s.status, s.notes,
                  s.total_items, s.items_counted, s.items_with_variance,
                  s.total_variance_value,
                  s.started_at, s.completed_at, s.created_at,
                  CASE WHEN u1.id IS NOT NULL THEN u1.username END AS started_by_username,
                  CASE WHEN u2.id IS NOT NULL THEN u2.username END AS completed_by_username,
                  st.store_name
           FROM   stock_count_sessions s
           LEFT JOIN users  u1 ON u1.id = s.started_by
           LEFT JOIN users  u2 ON u2.id = s.completed_by
           JOIN   stores st ON st.id = s.store_id
           WHERE ($1::int  IS NULL OR s.store_id   = $1)
             AND ($2::text IS NULL OR s.status     = $2)
             AND ($3::text IS NULL OR s.count_type = $3)
           ORDER  BY s.started_at DESC
           LIMIT $4 OFFSET $5"#,
        filters.store_id, filters.status, filters.count_type, limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(sessions, total, page, limit))
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async fn fetch_stock_count(pool: &sqlx::PgPool, id: i32) -> AppResult<StockCount> {
    sqlx::query_as!(
        StockCount,
        r#"SELECT s.id, s.session_number, s.store_id, s.count_type,
                  s.started_by, s.completed_by, s.status, s.notes,
                  s.total_items, s.items_counted, s.items_with_variance,
                  s.total_variance_value,
                  s.started_at, s.completed_at, s.created_at,
                  CASE WHEN u1.id IS NOT NULL THEN u1.username END AS started_by_username,
                  CASE WHEN u2.id IS NOT NULL THEN u2.username END AS completed_by_username,
                  st.store_name
           FROM   stock_count_sessions s
           LEFT JOIN users  u1 ON u1.id = s.started_by
           LEFT JOIN users  u2 ON u2.id = s.completed_by
           JOIN   stores st ON st.id = s.store_id
           WHERE  s.id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Stock count session {id} not found")))
}

async fn fetch_count_item(pool: &sqlx::PgPool, id: i32) -> AppResult<StockCountItem> {
    sqlx::query_as!(
        StockCountItem,
        r#"SELECT ci.id, ci.session_id, ci.item_id, ci.store_id,
                  ci.system_quantity, ci.counted_quantity,
                  ci.variance_quantity, ci.variance_value, ci.variance_percentage,
                  ci.cost_price, ci.counted_by, ci.counted_at, ci.notes,
                  ci.is_adjusted, ci.adjustment_id,
                  i.item_name, i.sku, i.barcode,
                  c.category_name
           FROM   stock_count_items ci
           JOIN   items i ON i.id = ci.item_id
           LEFT JOIN categories c ON c.id = i.category_id
           WHERE  ci.id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Count item {id} not found")))
}

/// Apply all unadjusted variances for a session within an existing transaction.
async fn apply_variances_tx(
    tx:         &mut sqlx::Transaction<'_, sqlx::Postgres>,
    session_id: i32,
    user_id:    i32,
    store_id:   i32,
) -> AppResult<()> {
    let count_items = sqlx::query!(
        r#"SELECT id, item_id, counted_quantity, variance_quantity
           FROM stock_count_items
           WHERE session_id = $1 AND is_adjusted = FALSE
             AND variance_quantity IS NOT NULL AND variance_quantity != 0"#,
        session_id
    )
    .fetch_all(&mut **tx)
    .await?;

    for ci in count_items {
        let qty_before: Option<Decimal> = sqlx::query_scalar!(
            "SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2",
            ci.item_id, store_id
        )
        .fetch_optional(&mut **tx)
        .await?;

        let Some(qty_before) = qty_before else { continue };
        let qty_after = ci.counted_quantity;
        let variance  = ci.variance_quantity.unwrap_or_default();

        // Update stock to counted quantity
        sqlx::query!(
            r#"UPDATE item_stock
               SET quantity = $1, last_count_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
               WHERE item_id = $2 AND store_id = $3"#,
            qty_after, ci.item_id, store_id
        )
        .execute(&mut **tx)
        .await?;

        let direction = if variance > Decimal::ZERO { "overage" } else { "shortage" };
        let desc = format!("Stock count adjustment: {direction} of {}", variance.abs());

        let history_id: i32 = sqlx::query_scalar!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id, notes)
               VALUES ($1, $2, 'STOCK_COUNT', $3, $4, $5, $6, $7, 'stock_count', $8::text, $9)
               RETURNING id"#,
            ci.item_id, store_id, desc,
            qty_before, qty_after, variance,
            user_id, session_id.to_string(),
            format!("Applied from stock count session {session_id}"),
        )
        .fetch_one(&mut **tx)
        .await?;

        sqlx::query!(
            "UPDATE stock_count_items SET is_adjusted = TRUE, adjustment_id = $1 WHERE id = $2",
            history_id, ci.id
        )
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

/// Deduct stock from a sale. Called from within an existing transaction context.
/// Matches quantum-pos-app `inventoryService.deductStockFromSale(client, ...)`.
pub(crate) async fn deduct_stock_from_sale(
    tx:        &mut sqlx::Transaction<'_, sqlx::Postgres>,
    item_id:   Uuid,
    store_id:  i32,
    quantity:  Decimal,
    sale_id:   String,
    cashier_id: i32,
) -> AppResult<StockDeductResult> {
    if quantity <= Decimal::ZERO {
        return Err(AppError::Validation("Invalid quantity for stock deduction".into()));
    }

    let item_name: String = sqlx::query_scalar!(
        "SELECT item_name FROM items WHERE id = $1 AND store_id = $2",
        item_id, store_id
    )
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Item not found".into()))?;

    let qty_before: Decimal = sqlx::query_scalar!(
        "SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2",
        item_id, store_id
    )
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Item stock not found".into()))?;

    let qty_after = qty_before - quantity;

    sqlx::query!(
        "UPDATE item_stock SET quantity = $1, updated_at = NOW() WHERE item_id = $2 AND store_id = $3",
        qty_after, item_id, store_id
    )
    .execute(&mut **tx)
    .await?;

    let desc = format!("Sold {} unit(s) of {item_name}", quantity);
    sqlx::query!(
        r#"INSERT INTO item_history
               (item_id, store_id, event_type, event_description,
                quantity_before, quantity_after, quantity_change,
                performed_by, reference_type, reference_id, notes)
           VALUES ($1, $2, 'SALE', $3, $4, $5, $6, $7, 'sale', $8, 'Automatic stock deduction from POS sale')"#,
        item_id, store_id, desc,
        qty_before, qty_after, -quantity,
        cashier_id, sale_id,
    )
    .execute(&mut **tx)
    .await?;

    Ok(StockDeductResult { item_id, quantity_before: qty_before, quantity_after: qty_after })
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_inventory(
    state:   State<'_, AppState>,
    token:   String,
    filters: InventoryFilters,
) -> AppResult<PagedResult<InventoryRecord>> {
    get_inventory_inner(&state, token, filters).await
}

#[tauri::command]
pub async fn get_inventory_item(
    state:    State<'_, AppState>,
    token:    String,
    item_id:  Uuid,
    store_id: i32,
) -> AppResult<InventoryItemDetail> {
    get_inventory_item_inner(&state, token, item_id, store_id).await
}

#[tauri::command]
pub async fn get_low_stock(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<LowStockItem>> {
    get_low_stock_inner(&state, token, store_id, limit).await
}

#[tauri::command]
pub async fn restock_item(
    state:   State<'_, AppState>,
    token:   String,
    payload: RestockDto,
) -> AppResult<RestockResult> {
    restock_item_inner(&state, token, payload).await
}

#[tauri::command]
pub async fn adjust_inventory(
    state:   State<'_, AppState>,
    token:   String,
    payload: AdjustInventoryDto,
) -> AppResult<AdjustInventoryResult> {
    adjust_inventory_inner(&state, token, payload).await
}

#[tauri::command]
pub async fn get_movement_history(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    filters:  MovementHistoryFilters,
) -> AppResult<PagedResult<MovementRecord>> {
    get_movement_history_inner(&state, token, store_id, filters).await
}

#[tauri::command]
pub async fn get_inventory_summary(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<InventorySummary> {
    get_inventory_summary_inner(&state, token, store_id).await
}

#[tauri::command]
pub async fn start_count_session(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    payload:  StartCountSessionDto,
) -> AppResult<StockCount> {
    start_count_session_inner(&state, token, store_id, payload).await
}

#[tauri::command]
pub async fn record_count(
    state:      State<'_, AppState>,
    token:      String,
    session_id: i32,
    store_id:   i32,
    payload:    RecordCountDto,
) -> AppResult<StockCountItem> {
    record_count_inner(&state, token, session_id, store_id, payload).await
}

#[tauri::command]
pub async fn complete_count_session(
    state:           State<'_, AppState>,
    token:           String,
    session_id:      i32,
    store_id:        i32,
    apply_variances: bool,
) -> AppResult<VarianceReport> {
    complete_count_session_inner(&state, token, session_id, store_id, apply_variances).await
}

#[tauri::command]
pub async fn get_variance_report(
    state:      State<'_, AppState>,
    token:      String,
    session_id: i32,
    store_id:   i32,
) -> AppResult<VarianceReport> {
    get_variance_report_inner(&state, token, session_id, store_id).await
}

#[tauri::command]
pub async fn apply_variances_standalone(
    state:      State<'_, AppState>,
    token:      String,
    session_id: i32,
    store_id:   i32,
) -> AppResult<serde_json::Value> {
    apply_variances_standalone_inner(&state, token, session_id, store_id).await
}

#[tauri::command]
pub async fn get_count_session(
    state:      State<'_, AppState>,
    token:      String,
    session_id: i32,
    store_id:   i32,
) -> AppResult<StockCount> {
    get_count_session_inner(&state, token, session_id, store_id).await
}

#[tauri::command]
pub async fn get_count_sessions(
    state:   State<'_, AppState>,
    token:   String,
    filters: CountSessionFilters,
) -> AppResult<PagedResult<StockCount>> {
    get_count_sessions_inner(&state, token, filters).await
}

// Legacy name kept for backwards compatibility
#[tauri::command]
pub async fn get_stock_counts(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
    page:     Option<i64>,
    limit:    Option<i64>,
) -> AppResult<PagedResult<StockCount>> {
    get_count_sessions_inner(
        &state,
        token,
        CountSessionFilters { page, limit, store_id, status: None, count_type: None },
    )
    .await
}
