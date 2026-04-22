// ============================================================================
// STOCK TRANSFERS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use uuid::Uuid;
use crate::{
    error::{AppError, AppResult},
    models::stock_transfer::{
        StockTransfer, TransferItem,
        CreateTransferDto, SendTransferDto, ReceiveTransferDto, TransferFilters,
        ExecuteTransferDto,
    },
    state::AppState,
};
use super::auth::guard_permission;
use serde::Serialize;

/// Slim read model for the command palette.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TransferSearchResult {
    pub id:              i32,
    pub transfer_number: String,
    pub from_store_name: Option<String>,
    pub to_store_name:   Option<String>,
    pub status:          String,
    pub requested_at:    chrono::DateTime<chrono::Utc>,
}

// ── create_transfer ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_transfer(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateTransferDto,
) -> AppResult<StockTransfer> {
    let claims = guard_permission(&state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;

    if payload.from_store_id == payload.to_store_id {
        return Err(AppError::Validation("Source and destination stores must be different".into()));
    }
    if payload.items.is_empty() {
        return Err(AppError::Validation("Transfer must include at least one item".into()));
    }

    // Non-admin users cannot execute instantly — place in pending_approval queue
    if !claims.is_global {
        return create_pending_transfer_inner(&state, &claims, &pool, CreateTransferDto {
            from_store_id: payload.from_store_id,
            to_store_id: payload.to_store_id,
            items: payload.items,
            notes: payload.notes,
        }).await;
    }

    let mut tx = pool.begin().await?;
    let seq: i64 = sqlx::query_scalar!("SELECT COUNT(*) + 1 FROM stock_transfers")
        .fetch_one(&mut *tx)
        .await?
        .unwrap_or(1);
    let year            = chrono::Utc::now().format("%Y");
    let transfer_number = format!("TRF-{year}-{seq:05}");

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO stock_transfers
               (transfer_number, from_store_id, to_store_id, requested_by, notes)
           VALUES ($1,$2,$3,$4,$5) RETURNING id"#,
        transfer_number, payload.from_store_id, payload.to_store_id,
        claims.user_id, payload.notes,
    )
    .fetch_one(&mut *tx)
    .await?;

    for item in &payload.items {
        let raw_qty = Decimal::try_from(item.qty_requested).unwrap_or_default();
        struct ItemMeta { item_name: String, measurement_type: Option<String> }
        let meta = sqlx::query_as!(
            ItemMeta,
            "SELECT i.item_name, ist.measurement_type FROM items i LEFT JOIN item_settings ist ON ist.item_id = i.id WHERE i.id = $1",
            item.item_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Item {} not found", item.item_id)))?;
        let qty = crate::utils::qty::validate_qty_opt(raw_qty, meta.measurement_type.as_deref(), &meta.item_name)?;
        sqlx::query!(
            r#"INSERT INTO stock_transfer_items (transfer_id, item_id, qty_requested, unit_type)
               SELECT $1, $2, $3, ist.unit_type
               FROM   item_settings ist
               WHERE  ist.item_id = $2"#,
            id,
            item.item_id,
            qty,
        )
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    fetch_transfer(&pool, id).await
}

// ── send_transfer ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_transfer(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: SendTransferDto,
) -> AppResult<StockTransfer> {
    let claims = guard_permission(&state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;
    let mut tx = pool.begin().await?;

    let transfer = sqlx::query!(
        "SELECT from_store_id, to_store_id, status FROM stock_transfers WHERE id = $1", id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Transfer {id} not found")))?;

    if transfer.status != "draft" {
        return Err(AppError::Validation(format!(
            "Transfer is '{}' — only draft transfers can be sent", transfer.status
        )));
    }

    for item in &payload.items {
        let raw_qty_sent = Decimal::try_from(item.qty_sent).unwrap_or_default();
        // Validate qty according to item's measurement_type
        struct SendMeta { item_name: String, measurement_type: Option<String> }
        let send_meta = sqlx::query_as!(
            SendMeta,
            "SELECT i.item_name, ist.measurement_type FROM items i LEFT JOIN item_settings ist ON ist.item_id = i.id WHERE i.id = $1",
            item.item_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Item {} not found", item.item_id)))?;
        let qty_sent = crate::utils::qty::validate_qty_opt(raw_qty_sent, send_meta.measurement_type.as_deref(), &send_meta.item_name)?;

        let qty_before: Decimal = sqlx::query_scalar!(
            "SELECT available_quantity FROM item_stock WHERE item_id=$1 AND store_id=$2",
            item.item_id, transfer.from_store_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Stock not found for item {}", item.item_id)))?;

        let unit_type: Option<String> = sqlx::query_scalar!(
            "SELECT unit_type FROM stock_transfer_items WHERE transfer_id=$1 AND item_id=$2",
            id, item.item_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .flatten();

        let qty_after = qty_before - qty_sent;
        sqlx::query!(
            r#"UPDATE item_stock SET quantity=$1, available_quantity=$1, updated_at=NOW()
               WHERE item_id=$2 AND store_id=$3"#,
            qty_after, item.item_id, transfer.from_store_id,
        )
        .execute(&mut *tx)
        .await?;

        let unit_label = unit_type.as_deref().unwrap_or("unit(s)");
        let desc = format!(
            "Stock transferred to another branch — {} {}",
            qty_sent, unit_label
        );

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id)
               VALUES ($1,$2,'TRANSFER_OUT',$3,
                       $4,$5,$6,$7,'stock_transfer',$8)"#,
            item.item_id, transfer.from_store_id,
            desc,
            qty_before, qty_after, -qty_sent, claims.user_id, id.to_string(),
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "UPDATE stock_transfer_items SET qty_sent=$1 WHERE transfer_id=$2 AND item_id=$3",
            qty_sent, id, item.item_id,
        )
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query!(
        "UPDATE stock_transfers SET status='in_transit', sent_by=$1, sent_at=NOW(), updated_at=NOW() WHERE id=$2",
        claims.user_id, id,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    fetch_transfer(&pool, id).await
}

// ── receive_transfer ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn receive_transfer(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: ReceiveTransferDto,
) -> AppResult<StockTransfer> {
    let claims = guard_permission(&state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;
    let mut tx = pool.begin().await?;

    let transfer = sqlx::query!(
        "SELECT from_store_id, to_store_id, status FROM stock_transfers WHERE id=$1", id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Transfer {id} not found")))?;

    if transfer.status != "in_transit" {
        return Err(AppError::Validation(format!(
            "Transfer is '{}' — only in-transit transfers can be received", transfer.status
        )));
    }

    for item in &payload.items {
        let raw_qty_received = Decimal::try_from(item.qty_received).unwrap_or_default();
        struct RecvMeta { item_name: String, measurement_type: Option<String> }
        let recv_meta = sqlx::query_as!(
            RecvMeta,
            "SELECT i.item_name, ist.measurement_type FROM items i LEFT JOIN item_settings ist ON ist.item_id = i.id WHERE i.id = $1",
            item.item_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Item {} not found", item.item_id)))?;
        let qty_received = crate::utils::qty::validate_qty_opt(raw_qty_received, recv_meta.measurement_type.as_deref(), &recv_meta.item_name)?;

        let unit_type: Option<String> = sqlx::query_scalar!(
            "SELECT unit_type FROM stock_transfer_items WHERE transfer_id=$1 AND item_id=$2",
            id, item.item_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .flatten();
        sqlx::query!(
            r#"INSERT INTO item_stock (item_id, store_id, quantity, available_quantity, updated_at)
               VALUES ($1,$2,$3,$3,NOW())
               ON CONFLICT (item_id, store_id) DO UPDATE
               SET quantity           = item_stock.quantity           + EXCLUDED.quantity,
                   available_quantity = item_stock.available_quantity + EXCLUDED.available_quantity,
                   updated_at         = NOW()"#,
            item.item_id, transfer.to_store_id, qty_received,
        )
        .execute(&mut *tx)
        .await?;

        let qty_after: Decimal = sqlx::query_scalar!(
            "SELECT quantity FROM item_stock WHERE item_id=$1 AND store_id=$2",
            item.item_id, transfer.to_store_id,
        )
        .fetch_one(&mut *tx)
        .await?;

        let unit_label = unit_type.as_deref().unwrap_or("unit(s)");
        let desc = format!(
            "Stock received from another branch — {} {}",
            qty_received, unit_label
        );

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id)
               VALUES ($1,$2,'TRANSFER_IN',$3,
                       $4,$5,$6,$7,'stock_transfer',$8)"#,
            item.item_id, transfer.to_store_id,
            desc,
            qty_after - qty_received, qty_after, qty_received,
            claims.user_id, id.to_string(),
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "UPDATE stock_transfer_items SET qty_received=$1 WHERE transfer_id=$2 AND item_id=$3",
            qty_received, id, item.item_id,
        )
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query!(
        "UPDATE stock_transfers SET status='received', received_by=$1, received_at=NOW(), updated_at=NOW() WHERE id=$2",
        claims.user_id, id,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    fetch_transfer(&pool, id).await
}

// ── cancel_transfer ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cancel_transfer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<StockTransfer> {
    guard_permission(&state, &token, "inventory.adjust").await?;
    let pool = state.pool().await?;
    let status: String = sqlx::query_scalar!("SELECT status FROM stock_transfers WHERE id=$1", id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Transfer {id} not found")))?;
    if status == "received"  { return Err(AppError::Validation("Cannot cancel a received transfer".into())); }
    if status == "cancelled" { return Err(AppError::Validation("Transfer already cancelled".into())); }
    sqlx::query!("UPDATE stock_transfers SET status='cancelled', updated_at=NOW() WHERE id=$1", id)
        .execute(&pool)
        .await?;
    fetch_transfer(&pool, id).await
}

// ── get_transfers ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_transfers(
    state:   State<'_, AppState>,
    token:   String,
    filters: TransferFilters,
) -> AppResult<Vec<StockTransfer>> {
    guard_permission(&state, &token, "inventory.read").await?;
    let pool  = state.pool().await?;
    let limit = filters.limit.unwrap_or(50).clamp(1, 500);
    let page  = filters.page.unwrap_or(1).max(1);
    let off   = (page - 1) * limit;

    let sp = filters.search.as_deref();

    let rows = sqlx::query!(
        r#"SELECT st.id, st.transfer_number, st.from_store_id, st.to_store_id,
               sf.store_name AS from_store_name, st2.store_name AS to_store_name,
               st.status, st.notes, st.requested_at, st.sent_at, st.received_at
           FROM stock_transfers st
           JOIN stores sf  ON sf.id  = st.from_store_id
           JOIN stores st2 ON st2.id = st.to_store_id
           WHERE ($1::int  IS NULL OR st.from_store_id=$1 OR st.to_store_id=$1)
             AND ($2::text IS NULL OR st.status=$2)
             AND ($3::text IS NULL OR st.transfer_number ILIKE '%' || $3 || '%'
                  OR sf.store_name  ILIKE '%' || $3 || '%'
                  OR st2.store_name ILIKE '%' || $3 || '%'
                  OR st.notes       ILIKE '%' || $3 || '%')
           ORDER BY st.requested_at DESC LIMIT $4 OFFSET $5"#,
        filters.store_id, filters.status, sp, limit, off,
    )
    .fetch_all(&pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for r in rows {
        let items = fetch_transfer_items(&pool, r.id).await?;
        result.push(StockTransfer {
            id: r.id, transfer_number: r.transfer_number,
            from_store_id: r.from_store_id, from_store_name: Some(r.from_store_name),
            to_store_id: r.to_store_id, to_store_name: Some(r.to_store_name),
            status: r.status, notes: r.notes,
            requested_at: r.requested_at, sent_at: r.sent_at, received_at: r.received_at,
            items,
        });
    }
    Ok(result)
}

// ── search_transfers_inner ───────────────────────────────────────────────────

/// Fast text search for the command palette.
pub(crate) async fn search_transfers_inner(
    state:    &AppState,
    token:    String,
    query:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<TransferSearchResult>> {
    guard_permission(state, &token, "inventory.read").await?;
    let pool   = state.pool().await?;
    let limit  = limit.unwrap_or(8).clamp(1, 20);
    let search = format!("%{}%", query.trim());

    sqlx::query_as!(
        TransferSearchResult,
        r#"SELECT st.id, st.transfer_number,
                  sf.store_name  AS "from_store_name",
                  st2.store_name AS "to_store_name",
                  st.status, st.requested_at
           FROM   stock_transfers st
           JOIN   stores sf  ON sf.id  = st.from_store_id
           JOIN   stores st2 ON st2.id = st.to_store_id
           WHERE  ($1::int IS NULL OR st.from_store_id = $1 OR st.to_store_id = $1)
             AND  (
                   st.transfer_number ILIKE $2
                OR sf.store_name      ILIKE $2
                OR st2.store_name     ILIKE $2
                OR st.notes           ILIKE $2
             )
           ORDER  BY st.requested_at DESC
           LIMIT  $3"#,
        store_id,
        search,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── get_transfer ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_transfer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<StockTransfer> {
    guard_permission(&state, &token, "inventory.read").await?;
    let pool = state.pool().await?;
    fetch_transfer(&pool, id).await
}

// ── helpers ───────────────────────────────────────────────────────────────────

async fn fetch_transfer(pool: &sqlx::PgPool, id: i32) -> AppResult<StockTransfer> {
    let r = sqlx::query!(
        r#"SELECT st.id, st.transfer_number, st.from_store_id, st.to_store_id,
               sf.store_name AS from_store_name, st2.store_name AS to_store_name,
               st.status, st.notes, st.requested_at, st.sent_at, st.received_at
           FROM stock_transfers st
           JOIN stores sf  ON sf.id  = st.from_store_id
           JOIN stores st2 ON st2.id = st.to_store_id
           WHERE st.id = $1"#,
        id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Transfer {id} not found")))?;

    let items = fetch_transfer_items(pool, id).await?;
    Ok(StockTransfer {
        id: r.id, transfer_number: r.transfer_number,
        from_store_id: r.from_store_id, from_store_name: Some(r.from_store_name),
        to_store_id: r.to_store_id, to_store_name: Some(r.to_store_name),
        status: r.status, notes: r.notes,
        requested_at: r.requested_at, sent_at: r.sent_at, received_at: r.received_at,
        items,
    })
}

async fn fetch_transfer_items(pool: &sqlx::PgPool, transfer_id: i32) -> AppResult<Vec<TransferItem>> {
    sqlx::query_as!(
        TransferItem,
        r#"SELECT sti.id, sti.transfer_id,
               sti.item_id            AS "item_id!: Uuid",
               sti.destination_item_id AS "destination_item_id: Uuid",
               src.item_name,
               dst.item_name          AS "destination_item_name: String",
               src.sku,
               sti.qty_requested      AS "qty_requested!: Decimal",
               sti.qty_sent           AS "qty_sent: Decimal",
               sti.qty_received       AS "qty_received: Decimal",
               sti.unit_type          AS "unit_type: String"
           FROM stock_transfer_items sti
           JOIN items src ON src.id = sti.item_id
           LEFT JOIN items dst ON dst.id = sti.destination_item_id
           WHERE sti.transfer_id = $1
           ORDER BY src.item_name"#,
        transfer_id,
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

// ── execute_transfer ──────────────────────────────────────────────────────────
// Single-step atomic transfer: creates, dispatches, and receives in one DB
// transaction. Source stock is decremented and destination stock is
// incremented (or the item is auto-cloned) atomically — no draft state.

#[tauri::command]
pub async fn execute_transfer(
    state:   State<'_, AppState>,
    token:   String,
    payload: ExecuteTransferDto,
) -> AppResult<StockTransfer> {
    execute_transfer_inner(&state, token, payload).await
}

pub(crate) async fn execute_transfer_inner(
    state:   &AppState,
    token:   String,
    payload: ExecuteTransferDto,
) -> AppResult<StockTransfer> {
    let claims = guard_permission(state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;

    if payload.from_store_id == payload.to_store_id {
        return Err(AppError::Validation("Source and destination stores must be different".into()));
    }
    if payload.items.is_empty() {
        return Err(AppError::Validation("Transfer must include at least one item".into()));
    }

    let mut tx = pool.begin().await?;

    // Generate transfer number ─────────────────────────────────────────────────
    let seq: i64 = sqlx::query_scalar!("SELECT COUNT(*) + 1 FROM stock_transfers")
        .fetch_one(&mut *tx)
        .await?
        .unwrap_or(1);
    let year = chrono::Utc::now().format("%Y");
    let transfer_number = format!("TRF-{year}-{seq:05}");

    // Insert header ───────────────────────────────────────────────────────────
    let transfer_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO stock_transfers
               (transfer_number, from_store_id, to_store_id, requested_by,
                sent_by, received_by, notes,
                status, sent_at, received_at)
           VALUES ($1,$2,$3,$4,$4,$4,$5,'received',NOW(),NOW())
           RETURNING id"#,
        transfer_number,
        payload.from_store_id,
        payload.to_store_id,
        claims.user_id,
        payload.notes,
    )
    .fetch_one(&mut *tx)
    .await?;

    // Process each item mapping ───────────────────────────────────────────────
    for leg in &payload.items {
        let raw_qty = Decimal::try_from(leg.qty).unwrap_or_default();

        // Validate qty against measurement_type
        struct SrcMeta { item_name: String, measurement_type: Option<String>, unit_type: Option<String>, sku: Option<String> }
        let src = sqlx::query_as!(
            SrcMeta,
            r#"SELECT i.item_name,
                      ist.measurement_type AS "measurement_type: String",
                      ist.unit_type        AS "unit_type: String",
                      i.sku               AS "sku: String"
               FROM items i
               LEFT JOIN item_settings ist ON ist.item_id = i.id
               WHERE i.id = $1 AND i.store_id = $2"#,
            leg.source_item_id,
            payload.from_store_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(
            format!("Item {} not found in source store", leg.source_item_id)
        ))?;

        let qty = crate::utils::qty::validate_qty_opt(
            raw_qty,
            src.measurement_type.as_deref(),
            &src.item_name,
        )?;

        // Check and deduct source stock ───────────────────────────────────────
        let src_qty_before: Decimal = sqlx::query_scalar!(
            "SELECT available_quantity FROM item_stock WHERE item_id=$1 AND store_id=$2",
            leg.source_item_id, payload.from_store_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(
            format!("No stock record found for item '{}' in source store", src.item_name)
        ))?;

        if src_qty_before < qty {
            return Err(AppError::Validation(format!(
                "Insufficient stock for '{}': have {}, need {}",
                src.item_name, src_qty_before, qty
            )));
        }

        let src_qty_after = src_qty_before - qty;
        sqlx::query!(
            "UPDATE item_stock SET quantity=$1, available_quantity=$1, updated_at=NOW() WHERE item_id=$2 AND store_id=$3",
            src_qty_after, leg.source_item_id, payload.from_store_id,
        )
        .execute(&mut *tx)
        .await?;

        let unit_label = src.unit_type.as_deref().unwrap_or("unit(s)");

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id)
               VALUES ($1,$2,'TRANSFER_OUT',
                       $3,$4,$5,$6,$7,'stock_transfer',$8)"#,
            leg.source_item_id,
            payload.from_store_id,
            format!("Stock transferred to store {} — {} {}", payload.to_store_id, qty, unit_label),
            src_qty_before,
            src_qty_after,
            -qty,
            claims.user_id,
            transfer_id.to_string(),
        )
        .execute(&mut *tx)
        .await?;

        // Resolve destination item ─────────────────────────────────────────────
        let dest_item_id: Uuid = match leg.destination_item_id {
            Some(dst_id) => {
                // Verify item belongs to destination store
                let exists: bool = sqlx::query_scalar!(
                    "SELECT EXISTS(SELECT 1 FROM items WHERE id=$1 AND store_id=$2)",
                    dst_id, payload.to_store_id,
                )
                .fetch_one(&mut *tx)
                .await?
                .unwrap_or(false);

                if !exists {
                    return Err(AppError::Validation(format!(
                        "Destination item {dst_id} does not belong to the destination store"
                    )));
                }
                dst_id
            }
            None => {
                // Auto-clone the source item into the destination store
                struct CloneSrc {
                    category_id:    Option<i32>,
                    department_id:  Option<i32>,
                    item_name:      String,
                    description:    Option<String>,
                    cost_price:     Decimal,
                    selling_price:  Decimal,
                    discount_price: Option<Decimal>,
                    discount_price_enabled: Option<bool>,
                    barcode:        Option<String>,
                    // settings
                    is_active:      Option<bool>,
                    sellable:       Option<bool>,
                    available_for_pos: Option<bool>,
                    track_stock:    Option<bool>,
                    taxable:        Option<bool>,
                    allow_discount: Option<bool>,
                    max_discount_percent: Option<Decimal>,
                    measurement_type: Option<String>,
                    unit_type:      Option<String>,
                    unit_value:     Option<Decimal>,
                    requires_weight: Option<bool>,
                    allow_negative_stock: Option<bool>,
                    min_stock_level: Option<i32>,
                    max_stock_level: Option<i32>,
                    min_increment:  Option<Decimal>,
                    default_qty:    Option<Decimal>,
                }

                let cs = sqlx::query_as!(
                    CloneSrc,
                    r#"SELECT i.category_id, i.department_id,
                              i.item_name, i.description, i.cost_price, i.selling_price,
                              i.discount_price, i.discount_price_enabled, i.barcode,
                              ist.is_active, ist.sellable, ist.available_for_pos,
                              ist.track_stock, ist.taxable, ist.allow_discount,
                              ist.max_discount_percent,
                              ist.measurement_type AS "measurement_type: String",
                              ist.unit_type        AS "unit_type: String",
                              ist.unit_value, ist.requires_weight, ist.allow_negative_stock,
                              ist.min_stock_level, ist.max_stock_level,
                              ist.min_increment, ist.default_qty
                       FROM items i
                       LEFT JOIN item_settings ist ON ist.item_id = i.id
                       WHERE i.id = $1"#,
                    leg.source_item_id,
                )
                .fetch_one(&mut *tx)
                .await?;

                // Generate a new UUID and clone the item row
                let new_item_id = Uuid::new_v4();

                // Build a unique SKU for the destination store
                let dst_slug: String = sqlx::query_scalar!(
                    "SELECT store_code FROM stores WHERE id = $1",
                    payload.to_store_id,
                )
                .fetch_optional(&mut *tx)
                .await?
                .flatten()
                .unwrap_or_else(|| format!("{:03}", payload.to_store_id));

                // Check if the source SKU already exists in dest store; if so, suffix it
                let base_sku = src.sku
                    .as_deref()
                    .unwrap_or(&cs.item_name[..cs.item_name.len().min(8)])
                    .to_string();
                let candidate_sku = format!("{}-{}", base_sku, dst_slug);

                let final_sku: String = {
                    let taken: bool = sqlx::query_scalar!(
                        "SELECT EXISTS(SELECT 1 FROM items WHERE sku=$1 AND store_id=$2)",
                        candidate_sku, payload.to_store_id,
                    )
                    .fetch_one(&mut *tx)
                    .await?
                    .unwrap_or(false);

                    if taken {
                        format!("{}-{}", candidate_sku, &new_item_id.to_string()[..4])
                    } else {
                        candidate_sku
                    }
                };

                // Insert the cloned item
                sqlx::query!(
                    r#"INSERT INTO items
                           (id, store_id, category_id, department_id,
                            sku, barcode, item_name, description,
                            cost_price, selling_price, discount_price,
                            discount_price_enabled)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"#,
                    new_item_id,
                    payload.to_store_id,
                    cs.category_id,
                    cs.department_id,
                    final_sku,
                    cs.barcode,
                    cs.item_name,
                    cs.description,
                    cs.cost_price,
                    cs.selling_price,
                    cs.discount_price,
                    cs.discount_price_enabled,
                )
                .execute(&mut *tx)
                .await?;

                // Insert item_settings
                sqlx::query!(
                    r#"INSERT INTO item_settings
                           (item_id, is_active, sellable, available_for_pos,
                            track_stock, taxable, allow_discount, max_discount_percent,
                            measurement_type, unit_type, unit_value,
                            requires_weight, allow_negative_stock,
                            min_stock_level, max_stock_level,
                            min_increment, default_qty)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)"#,
                    new_item_id,
                    cs.is_active.unwrap_or(true),
                    cs.sellable.unwrap_or(true),
                    cs.available_for_pos.unwrap_or(true),
                    cs.track_stock.unwrap_or(true),
                    cs.taxable.unwrap_or(false),
                    cs.allow_discount.unwrap_or(false),
                    cs.max_discount_percent,
                    cs.measurement_type,
                    cs.unit_type,
                    cs.unit_value,
                    cs.requires_weight.unwrap_or(false),
                    cs.allow_negative_stock.unwrap_or(false),
                    cs.min_stock_level,
                    cs.max_stock_level,
                    cs.min_increment,
                    cs.default_qty,
                )
                .execute(&mut *tx)
                .await?;

                // Bootstrap an item_stock row with zero qty (incremented below)
                sqlx::query!(
                    r#"INSERT INTO item_stock (item_id, store_id, quantity, available_quantity)
                       VALUES ($1, $2, 0, 0)
                       ON CONFLICT (item_id, store_id) DO NOTHING"#,
                    new_item_id, payload.to_store_id,
                )
                .execute(&mut *tx)
                .await?;

                new_item_id
            }
        };

        // Credit destination stock ─────────────────────────────────────────────
        sqlx::query!(
            r#"INSERT INTO item_stock (item_id, store_id, quantity, available_quantity, updated_at)
               VALUES ($1,$2,$3,$3,NOW())
               ON CONFLICT (item_id, store_id) DO UPDATE
               SET quantity           = item_stock.quantity           + EXCLUDED.quantity,
                   available_quantity = item_stock.available_quantity + EXCLUDED.available_quantity,
                   updated_at         = NOW()"#,
            dest_item_id, payload.to_store_id, qty,
        )
        .execute(&mut *tx)
        .await?;

        let dst_qty_after: Decimal = sqlx::query_scalar!(
            "SELECT quantity FROM item_stock WHERE item_id=$1 AND store_id=$2",
            dest_item_id, payload.to_store_id,
        )
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id)
               VALUES ($1,$2,'TRANSFER_IN',
                       $3,$4,$5,$6,$7,'stock_transfer',$8)"#,
            dest_item_id,
            payload.to_store_id,
            format!("Stock received from store {} — {} {}", payload.from_store_id, qty, unit_label),
            dst_qty_after - qty,
            dst_qty_after,
            qty,
            claims.user_id,
            transfer_id.to_string(),
        )
        .execute(&mut *tx)
        .await?;

        // Record the item leg ─────────────────────────────────────────────────
        sqlx::query!(
            r#"INSERT INTO stock_transfer_items
                   (transfer_id, item_id, destination_item_id,
                    qty_requested, qty_sent, qty_received, unit_type)
               SELECT $1, $2, $3,
                      $4, $4, $4,
                      ist.unit_type
               FROM item_settings ist
               WHERE ist.item_id = $2"#,
            transfer_id,
            leg.source_item_id,
            dest_item_id,
            qty,
        )
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    fetch_transfer(&pool, transfer_id).await
}

// ── create_pending_transfer_inner ─────────────────────────────────────────────
// Called when a non-admin submits a transfer. Stores intent without moving stock.

async fn create_pending_transfer_inner(
    _state:  &AppState,
    claims:  &crate::models::auth::Claims,
    pool:    &sqlx::PgPool,
    payload: CreateTransferDto,
) -> AppResult<StockTransfer> {
    let mut tx = pool.begin().await?;

    let seq: i64 = sqlx::query_scalar!("SELECT COUNT(*) + 1 FROM stock_transfers")
        .fetch_one(&mut *tx).await?.unwrap_or(1);
    let year = chrono::Utc::now().format("%Y");
    let transfer_number = format!("TRF-{year}-{seq:05}");

    let transfer_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO stock_transfers
               (transfer_number, from_store_id, to_store_id, requested_by, notes, status)
           VALUES ($1,$2,$3,$4,$5,'pending_approval')
           RETURNING id"#,
        transfer_number, payload.from_store_id, payload.to_store_id,
        claims.user_id, payload.notes,
    )
    .fetch_one(&mut *tx).await?;

    for leg in &payload.items {
        let raw_qty = Decimal::try_from(leg.qty_requested).unwrap_or_default();

        struct PendSrc { item_name: String, measurement_type: Option<String> }
        let src = sqlx::query_as!(
            PendSrc,
            r#"SELECT i.item_name, ist.measurement_type AS "measurement_type: String"
               FROM items i LEFT JOIN item_settings ist ON ist.item_id = i.id
               WHERE i.id = $1 AND i.store_id = $2"#,
            leg.item_id, payload.from_store_id,
        )
        .fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::NotFound(
            format!("Item {} not found in source store", leg.item_id)
        ))?;

        let qty = crate::utils::qty::validate_qty_opt(
            raw_qty, src.measurement_type.as_deref(), &src.item_name,
        )?;

        let unit_type: Option<String> = sqlx::query_scalar!(
            "SELECT unit_type FROM item_settings WHERE item_id = $1",
            leg.item_id,
        )
        .fetch_optional(&mut *tx).await?.flatten();

        sqlx::query!(
            r#"INSERT INTO stock_transfer_items
                   (transfer_id, item_id, destination_item_id, qty_requested, unit_type)
               VALUES ($1, $2, $3, $4, $5)"#,
            transfer_id, leg.item_id, None::<Uuid>, qty, unit_type,
        )
        .execute(&mut *tx).await?;
    }

    tx.commit().await?;
    fetch_transfer(pool, transfer_id).await
}

// ── approve_transfer ──────────────────────────────────────────────────────────
// Admin-only: execute a pending_approval transfer — moves stock immediately.

#[tauri::command]
pub async fn approve_transfer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<StockTransfer> {
    approve_transfer_inner(&state, token, id).await
}

pub(crate) async fn approve_transfer_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<StockTransfer> {
    // Only global (admin) users can approve
    let claims = super::auth::guard(state, &token).await?;
    if !claims.is_global {
        return Err(AppError::Forbidden);
    }
    let pool = state.pool().await?;

    let transfer = sqlx::query!(
        "SELECT from_store_id, to_store_id, status FROM stock_transfers WHERE id = $1", id
    )
    .fetch_optional(&pool).await?
    .ok_or_else(|| AppError::NotFound(format!("Transfer {id} not found")))?;

    if transfer.status != "pending_approval" {
        return Err(AppError::Validation(format!(
            "Transfer is '{}' — only pending_approval transfers can be approved", transfer.status
        )));
    }

    struct PendingItem {
        item_id:             Uuid,
        destination_item_id: Option<Uuid>,
        qty_requested:       Decimal,
        unit_type:           Option<String>,
    }
    let pending_items = sqlx::query_as!(
        PendingItem,
        r#"SELECT item_id             AS "item_id!: Uuid",
                  destination_item_id AS "destination_item_id: Uuid",
                  qty_requested       AS "qty_requested!: Decimal",
                  unit_type           AS "unit_type: String"
           FROM stock_transfer_items
           WHERE transfer_id = $1"#,
        id,
    )
    .fetch_all(&pool).await?;

    if pending_items.is_empty() {
        return Err(AppError::Validation("Transfer has no items".into()));
    }

    let mut tx = pool.begin().await?;

    for pi in &pending_items {
        let qty = pi.qty_requested;

        struct ApproveSrc {
            item_name:        String,
            measurement_type: Option<String>,
            unit_type:        Option<String>,
            sku:              Option<String>,
        }
        let src = sqlx::query_as!(
            ApproveSrc,
            r#"SELECT i.item_name,
                      ist.measurement_type AS "measurement_type: String",
                      ist.unit_type        AS "unit_type: String",
                      i.sku               AS "sku: String"
               FROM items i
               LEFT JOIN item_settings ist ON ist.item_id = i.id
               WHERE i.id = $1 AND i.store_id = $2"#,
            pi.item_id, transfer.from_store_id,
        )
        .fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::NotFound(
            format!("Item {} no longer exists in source store", pi.item_id)
        ))?;

        let qty = crate::utils::qty::validate_qty_opt(
            qty, src.measurement_type.as_deref(), &src.item_name,
        )?;

        let src_qty_before: Decimal = sqlx::query_scalar!(
            "SELECT available_quantity FROM item_stock WHERE item_id=$1 AND store_id=$2",
            pi.item_id, transfer.from_store_id,
        )
        .fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::NotFound(
            format!("No stock record for '{}' in source store", src.item_name)
        ))?;

        if src_qty_before < qty {
            return Err(AppError::Validation(format!(
                "Insufficient stock for '{}': have {}, need {}",
                src.item_name, src_qty_before, qty
            )));
        }

        let src_qty_after = src_qty_before - qty;
        sqlx::query!(
            "UPDATE item_stock SET quantity=$1, available_quantity=$1, updated_at=NOW() WHERE item_id=$2 AND store_id=$3",
            src_qty_after, pi.item_id, transfer.from_store_id,
        ).execute(&mut *tx).await?;

        let unit_label = src.unit_type.as_deref()
            .or(pi.unit_type.as_deref())
            .unwrap_or("unit(s)");

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id)
               VALUES ($1,$2,'TRANSFER_OUT',$3,$4,$5,$6,$7,'stock_transfer',$8)"#,
            pi.item_id, transfer.from_store_id,
            format!("Stock transferred to store {} — {} {}", transfer.to_store_id, qty, unit_label),
            src_qty_before, src_qty_after, -qty,
            claims.user_id, id.to_string(),
        ).execute(&mut *tx).await?;

        // Resolve destination item (existing or auto-clone) ───────────────────
        let dest_item_id: Uuid = match pi.destination_item_id {
            Some(dst_id) => {
                let exists: bool = sqlx::query_scalar!(
                    "SELECT EXISTS(SELECT 1 FROM items WHERE id=$1 AND store_id=$2)",
                    dst_id, transfer.to_store_id,
                ).fetch_one(&mut *tx).await?.unwrap_or(false);
                if !exists {
                    return Err(AppError::Validation(format!(
                        "Destination item {} does not belong to destination store", dst_id
                    )));
                }
                dst_id
            }
            None => {
                struct CloneSrcA {
                    category_id:    Option<i32>,
                    department_id:  Option<i32>,
                    item_name:      String,
                    description:    Option<String>,
                    cost_price:     Decimal,
                    selling_price:  Decimal,
                    discount_price: Option<Decimal>,
                    discount_price_enabled: Option<bool>,
                    barcode:        Option<String>,
                    is_active:      Option<bool>,
                    sellable:       Option<bool>,
                    available_for_pos: Option<bool>,
                    track_stock:    Option<bool>,
                    taxable:        Option<bool>,
                    allow_discount: Option<bool>,
                    max_discount_percent: Option<Decimal>,
                    measurement_type: Option<String>,
                    unit_type:      Option<String>,
                    unit_value:     Option<Decimal>,
                    requires_weight: Option<bool>,
                    allow_negative_stock: Option<bool>,
                    min_stock_level: Option<i32>,
                    max_stock_level: Option<i32>,
                    min_increment:  Option<Decimal>,
                    default_qty:    Option<Decimal>,
                }
                let cs = sqlx::query_as!(
                    CloneSrcA,
                    r#"SELECT i.category_id, i.department_id,
                              i.item_name, i.description, i.cost_price, i.selling_price,
                              i.discount_price, i.discount_price_enabled, i.barcode,
                              ist.is_active, ist.sellable, ist.available_for_pos,
                              ist.track_stock, ist.taxable, ist.allow_discount,
                              ist.max_discount_percent,
                              ist.measurement_type AS "measurement_type: String",
                              ist.unit_type        AS "unit_type: String",
                              ist.unit_value, ist.requires_weight, ist.allow_negative_stock,
                              ist.min_stock_level, ist.max_stock_level,
                              ist.min_increment, ist.default_qty
                       FROM items i
                       LEFT JOIN item_settings ist ON ist.item_id = i.id
                       WHERE i.id = $1"#,
                    pi.item_id,
                ).fetch_one(&mut *tx).await?;

                let new_item_id = Uuid::new_v4();
                let dst_slug: String = sqlx::query_scalar!(
                    "SELECT store_code FROM stores WHERE id = $1", transfer.to_store_id,
                ).fetch_optional(&mut *tx).await?.flatten()
                .unwrap_or_else(|| format!("{:03}", transfer.to_store_id));

                let base_sku = src.sku.as_deref()
                    .unwrap_or(&cs.item_name[..cs.item_name.len().min(8)])
                    .to_string();
                let candidate_sku = format!("{}-{}", base_sku, dst_slug);
                let final_sku: String = {
                    let taken: bool = sqlx::query_scalar!(
                        "SELECT EXISTS(SELECT 1 FROM items WHERE sku=$1 AND store_id=$2)",
                        candidate_sku, transfer.to_store_id,
                    ).fetch_one(&mut *tx).await?.unwrap_or(false);
                    if taken { format!("{}-{}", candidate_sku, &new_item_id.to_string()[..4]) }
                    else { candidate_sku }
                };

                sqlx::query!(
                    r#"INSERT INTO items
                           (id, store_id, category_id, department_id,
                            sku, barcode, item_name, description,
                            cost_price, selling_price, discount_price, discount_price_enabled)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"#,
                    new_item_id, transfer.to_store_id,
                    cs.category_id, cs.department_id, final_sku, cs.barcode,
                    cs.item_name, cs.description, cs.cost_price, cs.selling_price,
                    cs.discount_price, cs.discount_price_enabled,
                ).execute(&mut *tx).await?;

                sqlx::query!(
                    r#"INSERT INTO item_settings
                           (item_id, is_active, sellable, available_for_pos,
                            track_stock, taxable, allow_discount, max_discount_percent,
                            measurement_type, unit_type, unit_value,
                            requires_weight, allow_negative_stock,
                            min_stock_level, max_stock_level, min_increment, default_qty)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)"#,
                    new_item_id,
                    cs.is_active.unwrap_or(true), cs.sellable.unwrap_or(true),
                    cs.available_for_pos.unwrap_or(true), cs.track_stock.unwrap_or(true),
                    cs.taxable.unwrap_or(false), cs.allow_discount.unwrap_or(false),
                    cs.max_discount_percent, cs.measurement_type, cs.unit_type,
                    cs.unit_value, cs.requires_weight.unwrap_or(false),
                    cs.allow_negative_stock.unwrap_or(false),
                    cs.min_stock_level, cs.max_stock_level, cs.min_increment, cs.default_qty,
                ).execute(&mut *tx).await?;

                sqlx::query!(
                    r#"INSERT INTO item_stock (item_id, store_id, quantity, available_quantity)
                       VALUES ($1,$2,0,0) ON CONFLICT (item_id, store_id) DO NOTHING"#,
                    new_item_id, transfer.to_store_id,
                ).execute(&mut *tx).await?;

                // Record the resolved destination on the item leg
                sqlx::query!(
                    "UPDATE stock_transfer_items SET destination_item_id=$1 WHERE transfer_id=$2 AND item_id=$3",
                    new_item_id, id, pi.item_id,
                ).execute(&mut *tx).await?;

                new_item_id
            }
        };

        // Credit destination stock ─────────────────────────────────────────────
        sqlx::query!(
            r#"INSERT INTO item_stock (item_id, store_id, quantity, available_quantity, updated_at)
               VALUES ($1,$2,$3,$3,NOW())
               ON CONFLICT (item_id, store_id) DO UPDATE
               SET quantity           = item_stock.quantity           + EXCLUDED.quantity,
                   available_quantity = item_stock.available_quantity + EXCLUDED.available_quantity,
                   updated_at         = NOW()"#,
            dest_item_id, transfer.to_store_id, qty,
        ).execute(&mut *tx).await?;

        let dst_qty_after: Decimal = sqlx::query_scalar!(
            "SELECT quantity FROM item_stock WHERE item_id=$1 AND store_id=$2",
            dest_item_id, transfer.to_store_id,
        ).fetch_one(&mut *tx).await?;

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id)
               VALUES ($1,$2,'TRANSFER_IN',$3,$4,$5,$6,$7,'stock_transfer',$8)"#,
            dest_item_id, transfer.to_store_id,
            format!("Stock received from store {} — {} {}", transfer.from_store_id, qty, unit_label),
            dst_qty_after - qty, dst_qty_after, qty,
            claims.user_id, id.to_string(),
        ).execute(&mut *tx).await?;

        // Mark qty sent + received on the item leg
        sqlx::query!(
            "UPDATE stock_transfer_items SET qty_sent=$1, qty_received=$1 WHERE transfer_id=$2 AND item_id=$3",
            qty, id, pi.item_id,
        ).execute(&mut *tx).await?;
    }

    sqlx::query!(
        r#"UPDATE stock_transfers
           SET status='received', sent_by=$1, sent_at=NOW(),
               received_by=$1, received_at=NOW(), updated_at=NOW()
           WHERE id=$2"#,
        claims.user_id, id,
    ).execute(&mut *tx).await?;

    tx.commit().await?;
    fetch_transfer(&pool, id).await
}
