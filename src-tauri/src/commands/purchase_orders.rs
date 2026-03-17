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
                  poi.unit_cost, poi.line_total,
                  COALESCE(poi.unit_type, ist.unit_type)       AS unit_type,
                  ist.measurement_type                         AS "measurement_type: Option<String>"
           FROM   purchase_order_items poi
           JOIN   items i ON i.id = poi.item_id
           LEFT JOIN item_settings ist ON ist.item_id = poi.item_id
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

    // Validate all item quantities before inserting
    struct ValidatedLine {
        item_id:   uuid::Uuid,
        unit_type: Option<String>,
        qty:       Decimal,
        cost:      Decimal,
        line_tot:  Decimal,
    }
    let mut validated_lines: Vec<ValidatedLine> = Vec::with_capacity(payload.items.len());
    for item in &payload.items {
        let meta = sqlx::query!(
            r#"SELECT i.item_name,
                      ist.measurement_type AS "measurement_type: Option<String>",
                      ist.unit_type        AS "unit_type: Option<String>"
               FROM   items i
               LEFT JOIN item_settings ist ON ist.item_id = i.id
               WHERE  i.id = $1"#,
            item.item_id,
        )
        .fetch_one(&mut *db_tx)
        .await?;

        let qty = crate::utils::qty::validate_qty_opt(
            to_dec(item.quantity),
            meta.measurement_type.as_deref(),
            &meta.item_name,
        )?;
        let cost     = to_dec(item.unit_cost);
        let line_tot = qty * cost;
        validated_lines.push(ValidatedLine {
            item_id:   item.item_id,
            unit_type: meta.unit_type.flatten(),
            qty,
            cost,
            line_tot,
        });
    }

    let total: Decimal = validated_lines.iter().map(|l| l.line_tot).sum();

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

    for line in &validated_lines {
        sqlx::query!(
            r#"INSERT INTO purchase_order_items
                   (po_id, item_id, quantity_ordered, unit_cost, line_total, unit_type)
               VALUES ($1,$2,$3,$4,$5,$6)"#,
            po_id,
            line.item_id,
            line.qty,
            line.cost,
            line.line_tot,
            line.unit_type,
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
        let qty_raw = to_dec(receive.quantity_received);

        // Fetch item_id, measurement_type, and unit metadata FIRST so we can
        // validate the quantity before writing anything.
        struct PoLineMeta {
            item_id: uuid::Uuid,
            item_name: String,
            unit_type: Option<String>,
            measurement_type: Option<String>,
        }
        let po_meta = sqlx::query_as!(
            PoLineMeta,
            r#"SELECT poi.item_id,
                      i.item_name,
                      poi.unit_type,
                      ist.measurement_type
               FROM   purchase_order_items poi
               JOIN   items i ON i.id = poi.item_id
               LEFT JOIN item_settings ist ON ist.item_id = poi.item_id
               WHERE  poi.id = $1"#,
            receive.po_item_id,
        )
        .fetch_one(&mut *db_tx)
        .await?;
        let item_id = po_meta.item_id;

        // Validate/round qty according to measurement type BEFORE any writes.
        // - "quantity"               → must be a whole number
        // - "weight"|"volume"|"length" → rounded to 3 decimal places
        // - unknown / None           → pass-through
        let qty_recv = crate::utils::qty::validate_qty_opt(
            qty_raw,
            po_meta.measurement_type.as_deref(),
            &po_meta.item_name,
        )?;

        // Persist the validated (rounded) quantity so PO records and stock
        // always agree on the exact number received.
        sqlx::query!(
            "UPDATE purchase_order_items SET quantity_received = $1 WHERE id = $2",
            qty_recv,
            receive.po_item_id,
        )
        .execute(&mut *db_tx)
        .await?;

        // Snapshot stock before receiving
        let qty_before: Decimal = sqlx::query_scalar!(
            "SELECT COALESCE(quantity, 0) FROM item_stock WHERE item_id = $1 AND store_id = $2",
            item_id,
            order.store_id,
        )
        .fetch_optional(&mut *db_tx)
        .await?
        .flatten()
        .unwrap_or_default();

        let qty_after = qty_before + qty_recv;

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

        // Record history with event-style columns and unit label
        let unit_label = po_meta
            .unit_type
            .as_deref()
            .unwrap_or("unit(s)");
        let desc = format!(
            "PO Receipt: {} — {} {}",
            order.po_number, qty_recv, unit_label
        );
        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id, notes)
               VALUES ($1,$2,'PURCHASE',$3,$4,$5,$6,$7,'purchase_order',$8,$9)"#,
            item_id,
            order.store_id,
            desc,
            qty_before,
            qty_after,
            qty_recv,
            claims.user_id,
            order.id.to_string(),
            payload.notes,
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
