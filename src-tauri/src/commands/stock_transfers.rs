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
    },
    state::AppState,
};
use super::auth::guard_permission;

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
        let qty = Decimal::try_from(item.qty_requested).unwrap_or_default();
        sqlx::query!(
            "INSERT INTO stock_transfer_items (transfer_id, item_id, qty_requested) VALUES ($1,$2,$3)",
            id, item.item_id, qty,
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
        let qty_sent = Decimal::try_from(item.qty_sent).unwrap_or_default();
        let qty_before: Decimal = sqlx::query_scalar!(
            "SELECT available_quantity FROM item_stock WHERE item_id=$1 AND store_id=$2",
            item.item_id, transfer.from_store_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Stock not found for item {}", item.item_id)))?;

        let qty_after = qty_before - qty_sent;
        sqlx::query!(
            r#"UPDATE item_stock SET quantity=$1, available_quantity=$1, updated_at=NOW()
               WHERE item_id=$2 AND store_id=$3"#,
            qty_after, item.item_id, transfer.from_store_id,
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id)
               VALUES ($1,$2,'TRANSFER_OUT','Stock transferred to another branch',
                       $3,$4,$5,$6,'stock_transfer',$7)"#,
            item.item_id, transfer.from_store_id,
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
        let qty_received = Decimal::try_from(item.qty_received).unwrap_or_default();
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

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description,
                    quantity_before, quantity_after, quantity_change,
                    performed_by, reference_type, reference_id)
               VALUES ($1,$2,'TRANSFER_IN','Stock received from another branch',
                       $3,$4,$5,$6,'stock_transfer',$7)"#,
            item.item_id, transfer.to_store_id,
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

    let rows = sqlx::query!(
        r#"SELECT st.id, st.transfer_number, st.from_store_id, st.to_store_id,
               sf.store_name AS from_store_name, st2.store_name AS to_store_name,
               st.status, st.notes, st.requested_at, st.sent_at, st.received_at
           FROM stock_transfers st
           JOIN stores sf  ON sf.id  = st.from_store_id
           JOIN stores st2 ON st2.id = st.to_store_id
           WHERE ($1::int  IS NULL OR st.from_store_id=$1 OR st.to_store_id=$1)
             AND ($2::text IS NULL OR st.status=$2)
           ORDER BY st.requested_at DESC LIMIT $3 OFFSET $4"#,
        filters.store_id, filters.status, limit, off,
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
               sti.item_id       AS "item_id!: Uuid",
               i.item_name, i.sku,
               sti.qty_requested AS "qty_requested!: Decimal",
               sti.qty_sent      AS "qty_sent: Decimal",
               sti.qty_received  AS "qty_received: Decimal"
           FROM stock_transfer_items sti
           JOIN items i ON i.id = sti.item_id
           WHERE sti.transfer_id = $1
           ORDER BY i.item_name"#,
        transfer_id,
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}
