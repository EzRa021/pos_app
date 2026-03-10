// ============================================================================
// PURCHASE ORDER COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::purchase_order::{
        PurchaseOrder, PurchaseOrderItem, CreatePurchaseOrderDto,
        ReceivePurchaseOrderDto, PurchaseOrderFilters,
    },
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::{guard, guard_permission};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct PurchaseOrderDetail {
    pub order: PurchaseOrder,
    pub items: Vec<PurchaseOrderItem>,
}

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

async fn fetch_po(pool: &sqlx::PgPool, id: i32) -> AppResult<PurchaseOrder> {
    sqlx::query_as!(
        PurchaseOrder,
        r#"SELECT po.id, po.po_number, po.store_id, po.supplier_id,
                  s.supplier_name, po.status,
                  po.subtotal, po.tax_amount, po.shipping_cost,
                  po.total_amount, po.notes,
                  po.ordered_by, po.approved_by,
                  po.ordered_at, po.received_at, po.created_at
           FROM   purchase_orders po
           JOIN   suppliers s ON s.id = po.supplier_id
           WHERE  po.id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Purchase order {id} not found")))
}

async fn fetch_po_items(pool: &sqlx::PgPool, po_id: i32) -> AppResult<Vec<PurchaseOrderItem>> {
    sqlx::query_as!(
        PurchaseOrderItem,
        r#"SELECT poi.id, poi.po_id, poi.item_id,
                  i.item_name, i.sku,
                  poi.quantity_ordered, poi.quantity_received,
                  poi.unit_cost, poi.line_total
           FROM   purchase_order_items poi
           JOIN   items i ON i.id = poi.item_id
           WHERE  poi.po_id = $1
           ORDER  BY poi.id"#,
        po_id
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

pub(crate) async fn get_purchase_orders_inner(state: &AppState, token: String, filters: crate::models::purchase_order::PurchaseOrderFilters) -> AppResult<crate::models::pagination::PagedResult<PurchaseOrder>> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; get_purchase_orders(s, token, filters).await
}
pub(crate) async fn get_purchase_order_inner(state: &AppState, token: String, id: i32) -> AppResult<PurchaseOrderDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; get_purchase_order(s, token, id).await
}
pub(crate) async fn create_purchase_order_inner(state: &AppState, token: String, payload: crate::models::purchase_order::CreatePurchaseOrderDto) -> AppResult<PurchaseOrderDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; create_purchase_order(s, token, payload).await
}
pub(crate) async fn receive_purchase_order_inner(state: &AppState, token: String, id: i32, payload: crate::models::purchase_order::ReceivePurchaseOrderDto) -> AppResult<PurchaseOrderDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; receive_purchase_order(s, token, id, payload).await
}
pub(crate) async fn cancel_purchase_order_inner(state: &AppState, token: String, id: i32) -> AppResult<PurchaseOrderDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; cancel_purchase_order(s, token, id).await
}
pub(crate) async fn submit_purchase_order_inner(state: &AppState, token: String, id: i32) -> AppResult<PurchaseOrderDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; submit_purchase_order(s, token, id).await
}
pub(crate) async fn approve_purchase_order_inner(state: &AppState, token: String, id: i32) -> AppResult<PurchaseOrderDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; approve_purchase_order(s, token, id).await
}
pub(crate) async fn reject_purchase_order_inner(state: &AppState, token: String, id: i32, reason: Option<String>) -> AppResult<PurchaseOrderDetail> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; reject_purchase_order(s, token, id, reason).await
}
pub(crate) async fn delete_purchase_order_inner(state: &AppState, token: String, id: i32) -> AppResult<()> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; delete_purchase_order(s, token, id).await
}

#[tauri::command]
pub async fn get_purchase_orders(
    state:   State<'_, AppState>,
    token:   String,
    filters: PurchaseOrderFilters,
) -> AppResult<PagedResult<PurchaseOrder>> {
    guard_permission(&state, &token, "purchase_orders.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;
    let df     = filters.date_from.as_deref();
    let dt     = filters.date_to.as_deref();

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM purchase_orders
           WHERE ($1::int  IS NULL OR store_id    = $1)
             AND ($2::int  IS NULL OR supplier_id = $2)
             AND ($3::text IS NULL OR status      = $3)
             AND ($4::text IS NULL OR ordered_at >= $4::timestamptz)
             AND ($5::text IS NULL OR ordered_at <= $5::timestamptz)"#,
        filters.store_id, filters.supplier_id, filters.status, df, dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let orders = sqlx::query_as!(
        PurchaseOrder,
        r#"SELECT po.id, po.po_number, po.store_id, po.supplier_id,
                  s.supplier_name, po.status,
                  po.subtotal, po.tax_amount, po.shipping_cost,
                  po.total_amount, po.notes,
                  po.ordered_by, po.approved_by,
                  po.ordered_at, po.received_at, po.created_at
           FROM   purchase_orders po
           JOIN   suppliers s ON s.id = po.supplier_id
           WHERE ($1::int  IS NULL OR po.store_id    = $1)
             AND ($2::int  IS NULL OR po.supplier_id = $2)
             AND ($3::text IS NULL OR po.status      = $3)
             AND ($4::text IS NULL OR po.ordered_at >= $4::timestamptz)
             AND ($5::text IS NULL OR po.ordered_at <= $5::timestamptz)
           ORDER  BY po.ordered_at DESC
           LIMIT $6 OFFSET $7"#,
        filters.store_id, filters.supplier_id, filters.status,
        df, dt, limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(orders, total, page, limit))
}

#[tauri::command]
pub async fn get_purchase_order(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    guard_permission(&state, &token, "purchase_orders.read").await?;
    let pool = state.pool().await?;

    let order = fetch_po(&pool, id).await?;
    let items = fetch_po_items(&pool, id).await?;

    Ok(PurchaseOrderDetail { order, items })
}

#[tauri::command]
pub async fn create_purchase_order(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreatePurchaseOrderDto,
) -> AppResult<PurchaseOrderDetail> {
    let claims = guard_permission(&state, &token, "purchase_orders.create").await?;
    let pool   = state.pool().await?;

    if payload.items.is_empty() {
        return Err(AppError::Validation("Purchase order must have at least one item".into()));
    }

    let mut db_tx = pool.begin().await?;

    // Generate PO number
    let po_num: String = sqlx::query_scalar!(
        "SELECT 'PO-' || LPAD(NEXTVAL('po_ref_seq')::text, 6, '0')"
    )
    .fetch_one(&mut *db_tx)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| format!("PO-{}", chrono::Utc::now().timestamp()));

    // Calculate total
    let total: Decimal = payload.items.iter()
        .map(|i| to_dec(i.quantity) * to_dec(i.unit_cost))
        .sum();

    let po_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO purchase_orders
               (po_number, store_id, supplier_id, total_amount, notes, ordered_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id"#,
        po_num,
        payload.store_id,
        payload.supplier_id,
        total,
        payload.notes,
        claims.user_id,
    )
    .fetch_one(&mut *db_tx)
    .await?;

    for item in &payload.items {
        let qty       = to_dec(item.quantity);
        let cost      = to_dec(item.unit_cost);
        let line_tot  = qty * cost;

        sqlx::query!(
            r#"INSERT INTO purchase_order_items
                   (po_id, item_id, quantity_ordered, unit_cost, line_total)
               VALUES ($1,$2,$3,$4,$5)"#,
            po_id,
            item.item_id,
            qty,
            cost,
            line_tot,
        )
        .execute(&mut *db_tx)
        .await?;
    }

    db_tx.commit().await?;

    let order = fetch_po(&pool, po_id).await?;
    let items = fetch_po_items(&pool, po_id).await?;

    Ok(PurchaseOrderDetail { order, items })
}

#[tauri::command]
pub async fn receive_purchase_order(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: ReceivePurchaseOrderDto,
) -> AppResult<PurchaseOrderDetail> {
    let claims = guard_permission(&state, &token, "purchase_orders.receive").await?;
    let pool   = state.pool().await?;

    let order = fetch_po(&pool, id).await?;

    if order.status == "received" || order.status == "cancelled" {
        return Err(AppError::Validation(
            format!("Cannot receive a {} purchase order", order.status)
        ));
    }

    let mut db_tx = pool.begin().await?;

    for receive in &payload.items {
        let qty_recv = to_dec(receive.quantity_received);

        // Update PO item received quantity
        sqlx::query!(
            "UPDATE purchase_order_items SET quantity_received = $1 WHERE id = $2",
            qty_recv,
            receive.po_item_id,
        )
        .execute(&mut *db_tx)
        .await?;

        // Get item_id for this PO line
        let item_id: uuid::Uuid = sqlx::query_scalar!(
            "SELECT item_id FROM purchase_order_items WHERE id = $1",
            receive.po_item_id,
        )
        .fetch_one(&mut *db_tx)
        .await?;

        // Add to item stock
        sqlx::query!(
            r#"UPDATE item_stock SET
               quantity           = quantity           + $1,
               available_quantity = available_quantity + $1,
               updated_at         = NOW()
               WHERE item_id = $2 AND store_id = $3"#,
            qty_recv,
            item_id,
            order.store_id,
        )
        .execute(&mut *db_tx)
        .await?;

        // Record history
        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, change_type, adjustment, reason, created_by)
               VALUES ($1,$2,'purchase',$3,$4,$5)"#,
            item_id,
            order.store_id,
            qty_recv,
            format!("PO Receipt: {}", order.po_number),
            claims.user_id,
        )
        .execute(&mut *db_tx)
        .await?;
    }

    sqlx::query!(
        r#"UPDATE purchase_orders SET
           status = 'received', received_at = NOW(),
           notes  = COALESCE($1, notes)
           WHERE id = $2"#,
        payload.notes,
        id,
    )
    .execute(&mut *db_tx)
    .await?;

    db_tx.commit().await?;

    let order = fetch_po(&pool, id).await?;
    let items = fetch_po_items(&pool, id).await?;

    Ok(PurchaseOrderDetail { order, items })
}

#[tauri::command]
pub async fn cancel_purchase_order(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    guard_permission(&state, &token, "purchase_orders.update").await?;
    let pool  = state.pool().await?;
    let order = fetch_po(&pool, id).await?;

    if order.status == "received" {
        return Err(AppError::Validation("Cannot cancel an already-received order".into()));
    }

    sqlx::query!(
        "UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1", id
    )
    .execute(&pool)
    .await?;

    let order = fetch_po(&pool, id).await?;
    let items = fetch_po_items(&pool, id).await?;
    Ok(PurchaseOrderDetail { order, items })
}

// ── Submit (draft → pending) ──────────────────────────────────────────────────

#[tauri::command]
pub async fn submit_purchase_order(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    guard_permission(&state, &token, "purchase_orders.update").await?;
    let pool  = state.pool().await?;
    let order = fetch_po(&pool, id).await?;

    if order.status != "draft" {
        return Err(AppError::Validation(
            format!("Only draft orders can be submitted (current: {})", order.status)
        ));
    }

    sqlx::query!(
        "UPDATE purchase_orders SET status = 'pending' WHERE id = $1", id
    )
    .execute(&pool)
    .await?;

    let order = fetch_po(&pool, id).await?;
    let items = fetch_po_items(&pool, id).await?;
    Ok(PurchaseOrderDetail { order, items })
}

// ── Approve (pending → approved) ─────────────────────────────────────────────

#[tauri::command]
pub async fn approve_purchase_order(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    let claims = guard_permission(&state, &token, "purchase_orders.update").await?;
    let pool   = state.pool().await?;
    let order  = fetch_po(&pool, id).await?;

    if order.status != "pending" {
        return Err(AppError::Validation(
            format!("Only pending orders can be approved (current: {})", order.status)
        ));
    }

    sqlx::query!(
        "UPDATE purchase_orders SET status = 'approved', approved_by = $1 WHERE id = $2",
        claims.user_id, id
    )
    .execute(&pool)
    .await?;

    let order = fetch_po(&pool, id).await?;
    let items = fetch_po_items(&pool, id).await?;
    Ok(PurchaseOrderDetail { order, items })
}

// ── Reject (pending → rejected) ──────────────────────────────────────────────

#[tauri::command]
pub async fn reject_purchase_order(
    state:  State<'_, AppState>,
    token:  String,
    id:     i32,
    reason: Option<String>,
) -> AppResult<PurchaseOrderDetail> {
    guard_permission(&state, &token, "purchase_orders.update").await?;
    let pool  = state.pool().await?;
    let order = fetch_po(&pool, id).await?;

    if order.status != "pending" {
        return Err(AppError::Validation(
            format!("Only pending orders can be rejected (current: {})", order.status)
        ));
    }

    let note_suffix = reason.unwrap_or_else(|| "No reason provided".to_string());
    sqlx::query!(
        r#"UPDATE purchase_orders SET
           status = 'rejected',
           notes  = CONCAT(COALESCE(notes, ''), E'\nREJECTED: ', $1::text)
           WHERE id = $2"#,
        note_suffix, id
    )
    .execute(&pool)
    .await?;

    let order = fetch_po(&pool, id).await?;
    let items = fetch_po_items(&pool, id).await?;
    Ok(PurchaseOrderDetail { order, items })
}

// ── Delete draft PO ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn delete_purchase_order(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    guard_permission(&state, &token, "purchase_orders.update").await?;
    let pool  = state.pool().await?;
    let order = fetch_po(&pool, id).await?;

    if order.status != "draft" {
        return Err(AppError::Validation("Only draft purchase orders can be deleted".into()));
    }

    sqlx::query!("DELETE FROM purchase_orders WHERE id = $1", id)
        .execute(&pool)
        .await?;
    Ok(())
}
