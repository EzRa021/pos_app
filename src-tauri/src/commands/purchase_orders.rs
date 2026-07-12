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
use super::auth::guard_permission;
use super::audit::write_audit_log;
use crate::utils::ref_no::next_po_ref_no_exec;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct PurchaseOrderDetail {
    pub order: PurchaseOrder,
    pub items: Vec<PurchaseOrderItem>,
}

/// Slim read model for command palette search.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PurchaseOrderSearchResult {
    pub id:            i32,
    pub po_number:     String,
    pub supplier_name: Option<String>,
    pub status:        String,
    pub total_amount:  rust_decimal::Decimal,
    pub ordered_at:    chrono::DateTime<chrono::Utc>,
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
                  po.approved_at,
                  po.ordered_at, po.received_at, po.created_at,
                  po.is_active
           FROM   purchase_orders po
           JOIN   suppliers s ON s.id = po.supplier_id
           WHERE  po.id = $1
             AND  po.is_active = TRUE"#,
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

/// Fast text search for the command palette.
/// Matches po_number, supplier_name, notes — capped at limit (default 8, max 20).
pub(crate) async fn search_purchase_orders_inner(
    state:    &AppState,
    token:    String,
    query:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<PurchaseOrderSearchResult>> {
    guard_permission(state, &token, "purchase_orders.read").await?;
    let pool   = state.pool().await?;
    let limit  = limit.unwrap_or(8).clamp(1, 20);
    let search = format!("%{}%", query.trim());

    sqlx::query_as!(
        PurchaseOrderSearchResult,
        r#"SELECT po.id, po.po_number,
                  s.supplier_name,
                  po.status, po.total_amount, po.ordered_at
           FROM   purchase_orders po
           JOIN   suppliers s ON s.id = po.supplier_id
           WHERE  po.is_active = TRUE
             AND  ($1::int IS NULL OR po.store_id = $1)
             AND  (
                   po.po_number    ILIKE $2
                OR s.supplier_name ILIKE $2
                OR po.notes        ILIKE $2
             )
           ORDER  BY po.ordered_at DESC
           LIMIT  $3"#,
        store_id,
        search,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
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

    let search = filters.search.as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*)
           FROM   purchase_orders po
           JOIN   suppliers s ON s.id = po.supplier_id
           WHERE ($1::int  IS NULL OR po.store_id    = $1)
             AND ($2::int  IS NULL OR po.supplier_id = $2)
             AND ($3::text IS NULL OR po.status      = $3)
             AND ($4::text IS NULL OR po.ordered_at >= $4::timestamptz)
             AND ($5::text IS NULL OR po.ordered_at <= $5::timestamptz)
             AND po.is_active = TRUE
             AND ($6::text IS NULL OR (
                   po.po_number      ILIKE $6
                OR s.supplier_name   ILIKE $6
                OR po.notes          ILIKE $6
             ))"#,
        filters.store_id, filters.supplier_id, filters.status, df, dt, search.as_deref(),
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
                  po.approved_at,
                  po.ordered_at, po.received_at, po.created_at,
                  po.is_active
           FROM   purchase_orders po
           JOIN   suppliers s ON s.id = po.supplier_id
           WHERE ($1::int  IS NULL OR po.store_id    = $1)
             AND ($2::int  IS NULL OR po.supplier_id = $2)
             AND ($3::text IS NULL OR po.status      = $3)
             AND ($4::text IS NULL OR po.ordered_at >= $4::timestamptz)
             AND ($5::text IS NULL OR po.ordered_at <= $5::timestamptz)
             AND po.is_active = TRUE
             AND ($6::text IS NULL OR (
                   po.po_number      ILIKE $6
                OR s.supplier_name   ILIKE $6
                OR po.notes          ILIKE $6
             ))
           ORDER  BY po.ordered_at DESC
           LIMIT $7 OFFSET $8"#,
        filters.store_id, filters.supplier_id, filters.status,
        df, dt, search.as_deref(), limit, offset,
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
    let claims = guard_permission(&state, &token, "purchase_orders.read").await?;
    let pool = state.pool().await?;

    let order = fetch_po(&pool, id).await?;
    // RISK #1 fix: enforce store scope for non-global users
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if order.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }
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

    // BACKEND FAULT #9 fix: generate per-store PO number inside db_tx.
    let po_num = next_po_ref_no_exec(&mut db_tx, payload.store_id).await;

    // Validate all item quantities before inserting.
    // Bulk-fetch all item metadata in one query to avoid N+1 per-item round-trips.
    struct ValidatedLine {
        item_id:   uuid::Uuid,
        unit_type: Option<String>,
        qty:       Decimal,
        cost:      Decimal,
        line_tot:  Decimal,
    }
    let item_ids: Vec<uuid::Uuid> = payload.items.iter().map(|i| i.item_id).collect();
    // BACKEND FAULT #4 fix: validate that all item_ids exist in this store's inventory scope.
    let valid_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM item_stock WHERE item_id = ANY($1) AND store_id = $2",
        &item_ids as &[uuid::Uuid],
        payload.store_id,
    )
    .fetch_one(&mut *db_tx)
    .await?
    .unwrap_or(0);
    if valid_count != item_ids.len() as i64 {
        return Err(AppError::Validation(
            "One or more items do not exist in this store's inventory.".into()
        ));
    }

    let meta_rows = sqlx::query!(
        r#"SELECT i.id        AS "id!: uuid::Uuid",
                  i.item_name  AS "item_name!: String",
                  ist.measurement_type,
                  ist.unit_type
           FROM   items i
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           WHERE  i.id = ANY($1)"#,
        &item_ids as &[uuid::Uuid],
    )
    .fetch_all(&mut *db_tx)
    .await?;
    let item_meta_map: std::collections::HashMap<uuid::Uuid, _> =
        meta_rows.into_iter().map(|r| (r.id, r)).collect();

    let mut validated_lines: Vec<ValidatedLine> = Vec::with_capacity(payload.items.len());
    for item in &payload.items {
        let meta = item_meta_map.get(&item.item_id)
            .ok_or_else(|| AppError::NotFound(format!("Item {} not found", item.item_id)))?;

        let qty = crate::utils::qty::validate_qty_opt(
            to_dec(item.quantity),
            Some(meta.measurement_type.as_str()),
            &meta.item_name,
        )?;
        let cost     = to_dec(item.unit_cost);
        let line_tot = qty * cost;
        validated_lines.push(ValidatedLine {
            item_id:   item.item_id,
            unit_type: meta.unit_type.clone(),
            qty,
            cost,
            line_tot,
        });
    }

    let total: Decimal = validated_lines.iter().map(|l| l.line_tot).sum();

    let po_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO purchase_orders
               (po_number, store_id, supplier_id,
                status, subtotal, tax_amount, shipping_cost, total_amount,
                notes, ordered_by)
           VALUES ($1,$2,$3,
                   'draft',$4,0,0,$4,
                   $5,$6) RETURNING id"#,
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

    crate::database::sync::queue_row(
        &pool, "purchase_orders", "INSERT", &po_id.to_string(),
        serde_json::json!({ "id": po_id, "store_id": payload.store_id,
                            "po_number": po_num, "supplier_id": payload.supplier_id,
                            "total_amount": total.to_string(), "status": "draft" }),
        Some(payload.store_id),
    ).await;
    for item in &items {
        crate::database::sync::queue_row(
            &pool, "purchase_order_items", "INSERT",
            &format!("{}:{}", po_id, item.item_id),
            serde_json::json!({ "po_id": po_id, "item_id": item.item_id,
                                "quantity_ordered": item.quantity_ordered,
                                "unit_cost": item.unit_cost,
                                "line_total": item.line_total }),
            Some(payload.store_id),
        ).await;
    }

    write_audit_log(&pool, claims.user_id, Some(payload.store_id), "create", "purchase_order",
        &format!("Created PO {} — ₦{}", po_num, total), "info").await;

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

    // BACKEND FAULT #11 + CROSS-CUTTING RISK #1 fix: enforce store scope.
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if order.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    if order.status != "approved" && order.status != "partially_received" {
        return Err(AppError::Validation(
            format!("Cannot receive a {} purchase order. Order must be approved first.", order.status)
        ));
    }

    let mut db_tx = pool.begin().await?;

    let mut stock_movements_q: Vec<(String, serde_json::Value)> = Vec::new();
    for receive in &payload.items {
        let qty_raw = to_dec(receive.quantity_received);

        // BACKEND FAULT #3 fix: lock the PO line row and validate remaining inside db_tx.
        let line = sqlx::query!(
            r#"SELECT poi.item_id,
                      i.item_name,
                      poi.unit_type,
                      ist.measurement_type,
                      poi.quantity_ordered,
                      COALESCE(poi.quantity_received, 0) AS "quantity_received!: Decimal"
               FROM purchase_order_items poi
               JOIN items i ON i.id = poi.item_id
               LEFT JOIN item_settings ist ON ist.item_id = poi.item_id
               WHERE poi.id = $1 AND poi.po_id = $2"#,
            receive.po_item_id,
            id,
        )
        .fetch_optional(&mut *db_tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("PO item {} not found", receive.po_item_id)))?;

        let item_id = line.item_id;

        // Validate/round qty according to measurement type BEFORE any writes.
        // - "quantity"               → must be a whole number
        // - "weight"|"volume"|"length" → rounded to 3 decimal places
        // - unknown / None           → pass-through
        let qty_recv = crate::utils::qty::validate_qty_opt(
            qty_raw,
            Some(line.measurement_type.as_str()),
            &line.item_name,
        )?;

        let remaining = line.quantity_ordered - line.quantity_received;
        if qty_recv > remaining {
            return Err(AppError::Validation(format!(
                "Cannot receive {} — only {} remaining on this PO line",
                qty_recv, remaining
            )));
        }

        // Increment quantity_received, never overwrite.
        sqlx::query!(
            "UPDATE purchase_order_items SET quantity_received = COALESCE(quantity_received, 0) + $1 WHERE id = $2",
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
        let stock_res = sqlx::query!(
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
        // BACKEND FAULT #4 fix: if there is no stock row, fail fast (wrong store scope / corrupted data).
        if stock_res.rows_affected() == 0 {
            return Err(AppError::Validation(
                "Item does not have a stock record for this store; cannot receive into inventory.".into()
            ));
        }

        stock_movements_q.push(crate::database::sync::log_stock_movement(
            &mut *db_tx, item_id, order.store_id, Some(qty_recv), None, "po_receive",
        ).await?);

        // Record history with event-style columns and unit label
        let unit_label = line
            .unit_type
            .as_deref()
            .unwrap_or("unit(s)");
        let desc = format!(
            "Received {} {} via PO {}",
            qty_recv, unit_label, order.po_number
        );
        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id, notes)
               VALUES ($1,$2,'PO_RECEIVE',$3,$4,$5,$6,$7,'purchase_order',$8,$9)"#,
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

    // BACKEND FAULT #7 fix: compute received status inside db_tx atomically.
    let agg = sqlx::query!(
        r#"SELECT
              COALESCE(SUM(quantity_ordered), 0) AS "qty_ordered!: Decimal",
              COALESCE(SUM(COALESCE(quantity_received, 0)), 0) AS "qty_received!: Decimal"
           FROM purchase_order_items
           WHERE po_id = $1"#,
        id,
    )
    .fetch_one(&mut *db_tx)
    .await?;

    let fully_received = agg.qty_received >= agg.qty_ordered && agg.qty_ordered > Decimal::ZERO;
    let next_status = if fully_received { "fully_received" } else { "partially_received" };

    sqlx::query!(
        r#"UPDATE purchase_orders SET
           status = $1,
           received_at = CASE WHEN $2 THEN NOW() ELSE received_at END,
           notes  = COALESCE($3, notes)
           WHERE id = $4"#,
        next_status,
        fully_received,
        payload.notes,
        id,
    )
    .execute(&mut *db_tx)
    .await?;

    db_tx.commit().await?;

    let order = fetch_po(&pool, id).await?;
    let items = fetch_po_items(&pool, id).await?;

    crate::database::sync::queue_row(
        &pool, "purchase_orders", "UPDATE", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": order.store_id,
                            "status": order.status }),
        Some(order.store_id),
    ).await;
    for item in &items {
        crate::database::sync::queue_row(
            &pool, "purchase_order_items", "UPDATE",
            &format!("{}:{}", id, item.item_id),
            serde_json::json!({ "po_id": id, "item_id": item.item_id,
                                "quantity_received": item.quantity_received }),
            Some(order.store_id),
        ).await;
    }
    // Received stock syncs as +delta movements, not item_stock snapshots.
    for (mv_id, mv_row) in stock_movements_q {
        crate::database::sync::queue_row(
            &pool, "stock_movements", "INSERT", &mv_id, mv_row, Some(order.store_id),
        ).await;
    }

    write_audit_log(&pool, claims.user_id, Some(order.store_id), "receive", "purchase_order",
        &format!("Received goods for PO {}", order.po_number), "info").await;

    Ok(PurchaseOrderDetail { order, items })
}

#[tauri::command]
pub async fn cancel_purchase_order(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    let claims = guard_permission(&state, &token, "purchase_orders.update").await?;
    let pool  = state.pool().await?;
    let order = fetch_po(&pool, id).await?;

    // Enforce store scope for non-global users.
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if order.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    // BACKEND FAULT #2 fix: don't allow cancelling received/partially received orders.
    if order.status == "fully_received" || order.status == "received" {
        return Err(AppError::Validation(
            "Cannot cancel a fully received purchase order. Create a supplier return instead.".into()
        ));
    }
    if order.status == "partially_received" {
        return Err(AppError::Validation(
            "PO has partially received items. Reverse received stock before cancelling, or use a dedicated force-cancel flow.".into()
        ));
    }
    if order.status == "cancelled" || order.status == "rejected" {
        return Err(AppError::Validation(
            format!("Cannot cancel a {} purchase order", order.status)
        ));
    }

    sqlx::query!(
        "UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1", id
    )
    .execute(&pool)
    .await?;

    let order = fetch_po(&pool, id).await?;
    let items = fetch_po_items(&pool, id).await?;
    crate::database::sync::queue_row(
        &pool, "purchase_orders", "UPDATE", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": order.store_id, "status": "cancelled" }),
        Some(order.store_id),
    ).await;
    write_audit_log(&pool, claims.user_id, Some(order.store_id), "cancel", "purchase_order",
        &format!("Cancelled PO {}", order.po_number), "warning").await;
    Ok(PurchaseOrderDetail { order, items })
}

// ── Submit (draft → pending) ──────────────────────────────────────────────────

#[tauri::command]
pub async fn submit_purchase_order(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    let claims = guard_permission(&state, &token, "purchase_orders.update").await?;
    let pool  = state.pool().await?;
    let order = fetch_po(&pool, id).await?;

    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if order.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

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
    crate::database::sync::queue_row(
        &pool, "purchase_orders", "UPDATE", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": order.store_id, "status": "pending" }),
        Some(order.store_id),
    ).await;
    Ok(PurchaseOrderDetail { order, items })
}

// ── Approve (pending → approved) ─────────────────────────────────────────────

#[tauri::command]
pub async fn approve_purchase_order(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    let claims = guard_permission(&state, &token, "purchase_orders.approve").await?;
    let pool   = state.pool().await?;
    let order  = fetch_po(&pool, id).await?;

    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if order.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    if order.status != "pending" {
        return Err(AppError::Validation(
            format!("Only pending orders can be approved (current: {})", order.status)
        ));
    }

    sqlx::query!(
        "UPDATE purchase_orders SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2",
        claims.user_id, id
    )
    .execute(&pool)
    .await?;

    let order = fetch_po(&pool, id).await?;
    let items = fetch_po_items(&pool, id).await?;
    crate::database::sync::queue_row(
        &pool, "purchase_orders", "UPDATE", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": order.store_id, "status": "approved" }),
        Some(order.store_id),
    ).await;
    write_audit_log(&pool, claims.user_id, Some(order.store_id), "approve", "purchase_order",
        &format!("Approved PO {}", order.po_number), "info").await;
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
    let claims = guard_permission(&state, &token, "purchase_orders.update").await?;
    let pool  = state.pool().await?;
    let order = fetch_po(&pool, id).await?;

    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if order.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

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
    crate::database::sync::queue_row(
        &pool, "purchase_orders", "UPDATE", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": order.store_id, "status": "rejected" }),
        Some(order.store_id),
    ).await;
    Ok(PurchaseOrderDetail { order, items })
}

// ── PO stats (single aggregate query) ────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PoStats {
    pub total:     i64,
    pub draft:     i64,
    pub pending:   i64,
    pub approved:  i64,
    pub received:  i64,
    pub cancelled: i64,
    pub rejected:  i64,
}

#[tauri::command]
pub async fn get_po_stats(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<PoStats> {
    get_po_stats_inner(&state, token, store_id).await
}

pub(crate) async fn get_po_stats_inner(
    state:    &AppState,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<PoStats> {
    guard_permission(state, &token, "purchase_orders.read").await?;
    let pool = state.pool().await?;

    let row = sqlx::query!(
        r#"SELECT
               COUNT(*)                                            AS "total!: i64",
               COUNT(*) FILTER (WHERE status = 'draft')           AS "draft!: i64",
               COUNT(*) FILTER (WHERE status = 'pending')         AS "pending!: i64",
               COUNT(*) FILTER (WHERE status = 'approved')        AS "approved!: i64",
               COUNT(*) FILTER (WHERE status IN ('received', 'fully_received')) AS "received!: i64",
               COUNT(*) FILTER (WHERE status = 'cancelled')       AS "cancelled!: i64",
               COUNT(*) FILTER (WHERE status = 'rejected')        AS "rejected!: i64"
           FROM purchase_orders
           WHERE is_active = TRUE
             AND ($1::int IS NULL OR store_id = $1)"#,
        store_id,
    )
    .fetch_one(&pool)
    .await?;

    Ok(PoStats {
        total:     row.total,
        draft:     row.draft,
        pending:   row.pending,
        approved:  row.approved,
        received:  row.received,
        cancelled: row.cancelled,
        rejected:  row.rejected,
    })
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

    // Guard: never delete a PO with any received items.
    let received_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM purchase_order_items WHERE po_id = $1 AND COALESCE(quantity_received, 0) > 0",
        id,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);
    if received_count > 0 {
        return Err(AppError::Validation(
            "Cannot delete a purchase order with received items. Cancel it instead.".into()
        ));
    }
    if order.status != "draft" && order.status != "pending" {
        return Err(AppError::Validation(
            "Only draft or pending purchase orders can be deleted.".into()
        ));
    }

    // BACKEND FAULT #8 fix: soft-delete (consistent with the rest of the app)
    sqlx::query!("UPDATE purchase_orders SET is_active = FALSE WHERE id = $1", id)
        .execute(&pool)
        .await?;
    crate::database::sync::queue_row(
        &pool, "purchase_orders", "UPDATE", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": order.store_id, "is_active": false }),
        Some(order.store_id),
    ).await;
    Ok(())
}

// ── HTTP-server inner wrappers ────────────────────────────────────────────────
// These thin wrappers allow http_server.rs to call Tauri commands directly
// without going through the Tauri State<> machinery.

#[inline]
fn as_tauri_state(s: &AppState) -> tauri::State<'_, AppState> {
    unsafe { std::mem::transmute(s) }
}

pub(crate) async fn get_purchase_orders_inner(
    state:   &AppState,
    token:   String,
    filters: PurchaseOrderFilters,
) -> AppResult<PagedResult<PurchaseOrder>> {
    get_purchase_orders(as_tauri_state(state), token, filters).await
}

pub(crate) async fn get_purchase_order_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    get_purchase_order(as_tauri_state(state), token, id).await
}

pub(crate) async fn create_purchase_order_inner(
    state:   &AppState,
    token:   String,
    payload: CreatePurchaseOrderDto,
) -> AppResult<PurchaseOrderDetail> {
    create_purchase_order(as_tauri_state(state), token, payload).await
}

pub(crate) async fn receive_purchase_order_inner(
    state:   &AppState,
    token:   String,
    id:      i32,
    payload: ReceivePurchaseOrderDto,
) -> AppResult<PurchaseOrderDetail> {
    receive_purchase_order(as_tauri_state(state), token, id, payload).await
}

pub(crate) async fn cancel_purchase_order_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    cancel_purchase_order(as_tauri_state(state), token, id).await
}

pub(crate) async fn submit_purchase_order_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    submit_purchase_order(as_tauri_state(state), token, id).await
}

pub(crate) async fn approve_purchase_order_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<PurchaseOrderDetail> {
    approve_purchase_order(as_tauri_state(state), token, id).await
}

pub(crate) async fn reject_purchase_order_inner(
    state:  &AppState,
    token:  String,
    id:     i32,
    reason: Option<String>,
) -> AppResult<PurchaseOrderDetail> {
    reject_purchase_order(as_tauri_state(state), token, id, reason).await
}

pub(crate) async fn delete_purchase_order_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<()> {
    delete_purchase_order(as_tauri_state(state), token, id).await
}
