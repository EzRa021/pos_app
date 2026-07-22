// ============================================================================
// BULK OPERATIONS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::{
        bulk_operations::{
            BulkPriceUpdateDto, BulkStockAdjustmentDto, BulkToggleItemsDto,
            BulkApplyDiscountDto, BulkOperationResult,
            BulkPrintLabelsDto,
        },
        label::ItemLabel,
    },
    state::AppState,
};
use super::auth::guard_permission;

/// Queue affected item rows for cloud sync. Fresh-read push re-reads the
/// authoritative `items` row on send, so only the id is needed here.
async fn queue_items_sync(pool: &sqlx::PgPool, ids: &[uuid::Uuid], store_id: i32) {
    for id in ids {
        crate::database::sync::queue_row(
            pool, "items", "UPDATE", &id.to_string(),
            serde_json::json!({ "id": id }),
            Some(store_id),
        ).await;
    }
}

// ── bulk_price_update ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn bulk_price_update(
    state:   State<'_, AppState>,
    token:   String,
    payload: BulkPriceUpdateDto,
) -> AppResult<BulkOperationResult> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;

    if payload.category_id.is_none() && payload.department_id.is_none() {
        return Err(AppError::Validation("Either category_id or department_id is required".into()));
    }

    let factor = Decimal::try_from(payload.value).unwrap_or_default();
    let round  = payload.round_to.map(|r| Decimal::try_from(r).unwrap_or_default());
    let update_cost = payload.update_cost.unwrap_or(false);

    let price_expr = match payload.method.as_str() {
        "percentage"     => format!("ROUND((selling_price * (1 + {} / 100.0)){}::numeric, 2)", factor,
            round.map(|r| format!(" / {r} * {r}")).unwrap_or_default()),
        "fixed_increase" => format!("ROUND((selling_price + {}){}::numeric, 2)", factor,
            round.map(|r| format!(" / {r} * {r}")).unwrap_or_default()),
        "fixed_decrease" => format!("ROUND(GREATEST(selling_price - {}, 0){}::numeric, 2)", factor,
            round.map(|r| format!(" / {r} * {r}")).unwrap_or_default()),
        "set_absolute"   => format!("{factor}"),
        other => return Err(AppError::Validation(format!("Unknown method: {other}"))),
    };

    let cost_clause = if update_cost { format!(", cost_price = {price_expr}") } else { String::new() };
    let where_clause = if let Some(cid) = payload.category_id {
        format!("store_id = {} AND category_id = ANY(category_descendant_ids({}))", payload.store_id, cid)
    } else {
        format!("store_id = {} AND department_id = {}", payload.store_id, payload.department_id.unwrap())
    };

    // RETURNING id so we can queue each affected item for cloud sync — bulk
    // price changes must reach Supabase just like single-item updates do.
    let sql = format!("UPDATE items SET selling_price = {price_expr}{cost_clause}, updated_at = NOW() WHERE {where_clause} RETURNING id");
    let ids: Vec<uuid::Uuid> = sqlx::query_scalar(&sql).fetch_all(&pool).await.map_err(AppError::Database)?;
    let affected = ids.len() as u64;

    sqlx::query!(
        r#"INSERT INTO audit_logs (store_id, action, resource, description, severity)
           VALUES ($1,'bulk_price_update','items',$2,'info')"#,
        payload.store_id,
        format!("Bulk price update via '{}' — {}", payload.method,
            payload.reason.as_deref().unwrap_or("no reason")),
    )
    .execute(&pool)
    .await
    .ok();

    queue_items_sync(&pool, &ids, payload.store_id).await;

    Ok(BulkOperationResult {
        affected,
        message:  format!("{affected} item(s) repriced via '{}'", payload.method),
    })
}

// ── bulk_stock_adjustment ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn bulk_stock_adjustment(
    state:   State<'_, AppState>,
    token:   String,
    payload: BulkStockAdjustmentDto,
) -> AppResult<BulkOperationResult> {
    let claims = guard_permission(&state, &token, "inventory.adjust").await?;
    let pool   = state.pool().await?;

    if payload.items.is_empty() {
        return Err(AppError::Validation("No items provided for adjustment".into()));
    }

    // Block bulk stock changes while a count session is active — matches the
    // single-item adjust/restock paths and prevents phantom variances mid-count.
    super::inventory::ensure_no_active_count(&pool, payload.store_id).await?;

    let mut tx       = pool.begin().await?;
    let mut affected = 0u64;
    let mut stock_movements_q: Vec<(String, serde_json::Value)> = Vec::new();

    for item in &payload.items {
        let item_id = uuid::Uuid::parse_str(&item.item_id)
            .map_err(|_| AppError::Validation(format!("Invalid item_id: {}", item.item_id)))?;
        let delta = Decimal::try_from(item.adjustment).unwrap_or_default();

        // Lock the row and compute the EFFECTIVE delta after the GREATEST(…, 0)
        // clamp — the synced movement must match what actually happened here,
        // not the requested adjustment, or remote stock drifts.
        let qty_before: Option<Decimal> = sqlx::query_scalar!(
            "SELECT quantity FROM item_stock WHERE item_id = $1 AND store_id = $2 FOR UPDATE",
            item_id, payload.store_id,
        )
        .fetch_optional(&mut *tx)
        .await?;

        sqlx::query!(
            r#"UPDATE item_stock
               SET quantity = GREATEST(quantity + $1, 0),
                   available_quantity = GREATEST(available_quantity + $1, 0),
                   updated_at = NOW()
               WHERE item_id=$2 AND store_id=$3"#,
            delta, item_id, payload.store_id,
        )
        .execute(&mut *tx)
        .await?;

        if let Some(before) = qty_before {
            let effective = (before + delta).max(Decimal::ZERO) - before;
            if effective != Decimal::ZERO {
                stock_movements_q.push(crate::database::sync::log_stock_movement(
                    &mut *tx, item_id, payload.store_id, Some(effective), None, "adjustment",
                ).await?);
            }
        }

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, quantity_change, notes, performed_by)
               VALUES ($1,$2,'MANUAL_ADJUST',$3,$4,$5)"#,
            item_id, payload.store_id, delta,
            item.reason.as_deref().unwrap_or("Bulk adjustment"),
            claims.user_id,
        )
        .execute(&mut *tx)
        .await?;

        affected += 1;
    }

    tx.commit().await?;

    for (mv_id, mv_row) in stock_movements_q {
        crate::database::sync::queue_row(
            &pool, "stock_movements", "INSERT", &mv_id, mv_row, Some(payload.store_id),
        ).await;
    }

    Ok(BulkOperationResult { affected, message: format!("Stock adjusted for {affected} item(s)") })
}

// ── bulk_activate_items ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn bulk_activate_items(
    state:   State<'_, AppState>,
    token:   String,
    payload: BulkToggleItemsDto,
) -> AppResult<BulkOperationResult> {
    guard_permission(&state, &token, "items.update").await?;
    bulk_toggle(&state, payload, true).await
}

// ── bulk_deactivate_items ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn bulk_deactivate_items(
    state:   State<'_, AppState>,
    token:   String,
    payload: BulkToggleItemsDto,
) -> AppResult<BulkOperationResult> {
    guard_permission(&state, &token, "items.update").await?;
    bulk_toggle(&state, payload, false).await
}

async fn bulk_toggle(state: &State<'_, AppState>, payload: BulkToggleItemsDto, active: bool) -> AppResult<BulkOperationResult> {
    let pool = state.pool().await?;
    // RETURNING item_id so the affected rows can be queued for cloud sync.
    let ids: Vec<uuid::Uuid> = if let Some(id_strs) = payload.item_ids {
        let uuids: Vec<uuid::Uuid> = id_strs.iter().filter_map(|s| uuid::Uuid::parse_str(s).ok()).collect();
        sqlx::query_scalar!(
            "UPDATE item_settings SET is_active=$1 WHERE item_id=ANY($2) AND store_id=$3 RETURNING item_id",
            active, &uuids, payload.store_id,
        )
        .fetch_all(&pool)
        .await?
    } else if let Some(cid) = payload.category_id {
        sqlx::query_scalar!(
            r#"UPDATE item_settings ist SET is_active=$1
               FROM items i WHERE ist.item_id=i.id AND i.category_id = ANY(category_descendant_ids($2)) AND ist.store_id=$3
               RETURNING ist.item_id"#,
            active, cid, payload.store_id,
        )
        .fetch_all(&pool)
        .await?
    } else if let Some(did) = payload.department_id {
        sqlx::query_scalar!(
            r#"UPDATE item_settings ist SET is_active=$1
               FROM items i WHERE ist.item_id=i.id AND i.department_id=$2 AND ist.store_id=$3
               RETURNING ist.item_id"#,
            active, did, payload.store_id,
        )
        .fetch_all(&pool)
        .await?
    } else {
        return Err(AppError::Validation("Provide item_ids, category_id, or department_id".into()));
    };

    let affected = ids.len() as u64;
    let verb = if active { "activated" } else { "deactivated" };

    sqlx::query!(
        r#"INSERT INTO audit_logs (store_id, action, resource, description, severity)
           VALUES ($1,$2,'items',$3,'info')"#,
        payload.store_id,
        if active { "bulk_activate_items" } else { "bulk_deactivate_items" },
        format!("Bulk {verb}: {affected} item(s)"),
    )
    .execute(&pool)
    .await
    .ok();

    queue_items_sync(&pool, &ids, payload.store_id).await;

    Ok(BulkOperationResult { affected, message: format!("{affected} item(s) {verb}") })
}

// ── bulk_apply_discount ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn bulk_apply_discount(
    state:   State<'_, AppState>,
    token:   String,
    payload: BulkApplyDiscountDto,
) -> AppResult<BulkOperationResult> {
    guard_permission(&state, &token, "items.update").await?;
    let pool    = state.pool().await?;
    let percent = Decimal::try_from(payload.percent).unwrap_or_default();

    if payload.category_id.is_none() && payload.department_id.is_none() {
        return Err(AppError::Validation("Either category_id or department_id is required".into()));
    }

    let (where_clause, discount_expr) = if let Some(cid) = payload.category_id {
        (format!("store_id={} AND category_id = ANY(category_descendant_ids({}))", payload.store_id, cid),
         format!("CASE WHEN {percent}=0 THEN NULL ELSE ROUND(selling_price*(1-{percent}/100.0),2) END"))
    } else {
        let did = payload.department_id.unwrap();
        (format!("store_id={} AND department_id={}", payload.store_id, did),
         format!("CASE WHEN {percent}=0 THEN NULL ELSE ROUND(selling_price*(1-{percent}/100.0),2) END"))
    };

    let sql = format!("UPDATE items SET discount_price={discount_expr}, updated_at=NOW() WHERE {where_clause} RETURNING id");
    let ids: Vec<uuid::Uuid> = sqlx::query_scalar(&sql).fetch_all(&pool).await.map_err(AppError::Database)?;
    let affected = ids.len() as u64;

    let pct_str = if percent == Decimal::ZERO { "cleared".to_string() } else { format!("{percent}% discount applied") };

    sqlx::query!(
        r#"INSERT INTO audit_logs (store_id, action, resource, description, severity)
           VALUES ($1,'bulk_apply_discount','items',$2,'info')"#,
        payload.store_id,
        format!("Bulk discount: {pct_str} on {affected} item(s)"),
    )
    .execute(&pool)
    .await
    .ok();

    queue_items_sync(&pool, &ids, payload.store_id).await;

    Ok(BulkOperationResult { affected, message: format!("{affected} item(s): {pct_str}") })
}

// ── bulk_print_labels ───────────────────────────────────────────────────────────────
// Unified label-data resolver for all bulk print flows:
//   • item_ids supplied  → explicit multi-select (no active filter, user chose these)
//   • category_id only   → every active item in that category
//   • department_id only → every active item in that department
//
// Returns Vec<ItemLabel> — the frontend generates the HTML and fires the iframe print.

#[tauri::command]
pub async fn bulk_print_labels(
    state:   State<'_, AppState>,
    token:   String,
    payload: BulkPrintLabelsDto,
) -> AppResult<Vec<ItemLabel>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;

    if payload.item_ids.is_none()
        && payload.category_id.is_none()
        && payload.department_id.is_none()
    {
        return Err(AppError::Validation(
            "Provide item_ids, category_id, or department_id".into(),
        ));
    }

    let copies = payload.copies.unwrap_or(1).max(1) as usize;
    let mut labels: Vec<ItemLabel> = Vec::new();

    // ── Branch A: explicit item UUIDs (multi-select) ────────────────────────────────
    if let Some(ids) = &payload.item_ids {
        let uuids: Vec<uuid::Uuid> = ids.iter()
            .filter_map(|s| uuid::Uuid::parse_str(s).ok())
            .collect();
        if uuids.is_empty() { return Ok(Vec::new()); }

        let rows = sqlx::query!(
            r#"SELECT i.id::text AS item_id, i.item_name, i.sku, i.barcode,
                   i.selling_price, i.cost_price, s.store_name, c.category_name,
                   istock.quantity::int AS quantity
               FROM items i
               JOIN stores s ON s.id = i.store_id
               LEFT JOIN categories c ON c.id = i.category_id
               LEFT JOIN item_stock istock
                   ON istock.item_id = i.id AND istock.store_id = i.store_id
               WHERE i.id = ANY($1) AND i.store_id = $2
               ORDER BY i.item_name"#,
            &uuids, payload.store_id,
        )
        .fetch_all(&pool)
        .await?;

        for row in &rows {
            for _ in 0..copies {
                labels.push(ItemLabel {
                    item_id:       row.item_id.clone().unwrap_or_default(),
                    item_name:     row.item_name.clone(),
                    sku:           row.sku.clone(),
                    barcode:       row.barcode.clone(),
                    selling_price: row.selling_price,
                    cost_price:    row.cost_price,
                    store_name:    row.store_name.clone(),
                    category_name: Some(row.category_name.clone()),
                    quantity:      row.quantity,
                });
            }
        }

    // ── Branch B: category / department scope (active items only) ────────────────
    } else {
        let rows = sqlx::query!(
            r#"SELECT i.id::text AS item_id, i.item_name, i.sku, i.barcode,
                   i.selling_price, i.cost_price, s.store_name, c.category_name,
                   istock.quantity::int AS quantity
               FROM items i
               JOIN stores s ON s.id = i.store_id
               LEFT JOIN categories c ON c.id = i.category_id
               LEFT JOIN item_stock istock
                   ON istock.item_id = i.id AND istock.store_id = i.store_id
               LEFT JOIN item_settings ist ON ist.item_id = i.id
               WHERE i.store_id = $1
                 AND ($2::int IS NULL OR i.category_id   = ANY(category_descendant_ids($2)))
                 AND ($3::int IS NULL OR i.department_id = $3)
                 AND (ist.is_active IS NULL OR ist.is_active = TRUE)
               ORDER BY i.item_name"#,
            payload.store_id, payload.category_id, payload.department_id,
        )
        .fetch_all(&pool)
        .await?;

        for row in &rows {
            for _ in 0..copies {
                labels.push(ItemLabel {
                    item_id:       row.item_id.clone().unwrap_or_default(),
                    item_name:     row.item_name.clone(),
                    sku:           row.sku.clone(),
                    barcode:       row.barcode.clone(),
                    selling_price: row.selling_price,
                    cost_price:    row.cost_price,
                    store_name:    row.store_name.clone(),
                    category_name: Some(row.category_name.clone()),
                    quantity:      row.quantity,
                });
            }
        }
    }

    Ok(labels)
}
