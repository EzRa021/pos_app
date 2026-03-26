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
            BulkItemImportDto, BulkImportResult,
            BulkPrintLabelsDto,
        },
        label::ItemLabel,
    },
    state::AppState,
};
use super::auth::guard_permission;

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
        format!("store_id = {} AND category_id = {}", payload.store_id, cid)
    } else {
        format!("store_id = {} AND department_id = {}", payload.store_id, payload.department_id.unwrap())
    };

    let sql = format!("UPDATE items SET selling_price = {price_expr}{cost_clause}, updated_at = NOW() WHERE {where_clause}");
    let result = sqlx::query(&sql).execute(&pool).await.map_err(AppError::Database)?;

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

    Ok(BulkOperationResult {
        affected: result.rows_affected(),
        message:  format!("{} item(s) repriced via '{}'", result.rows_affected(), payload.method),
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

    let mut tx       = pool.begin().await?;
    let mut affected = 0u64;

    for item in &payload.items {
        let item_id = uuid::Uuid::parse_str(&item.item_id)
            .map_err(|_| AppError::Validation(format!("Invalid item_id: {}", item.item_id)))?;
        let delta = Decimal::try_from(item.adjustment).unwrap_or_default();

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
    let result = if let Some(ids) = payload.item_ids {
        let uuids: Vec<uuid::Uuid> = ids.iter().filter_map(|s| uuid::Uuid::parse_str(s).ok()).collect();
        sqlx::query!(
            "UPDATE item_settings SET is_active=$1 WHERE item_id=ANY($2) AND store_id=$3",
            active, &uuids, payload.store_id,
        )
        .execute(&pool)
        .await?
    } else if let Some(cid) = payload.category_id {
        sqlx::query!(
            r#"UPDATE item_settings ist SET is_active=$1
               FROM items i WHERE ist.item_id=i.id AND i.category_id=$2 AND ist.store_id=$3"#,
            active, cid, payload.store_id,
        )
        .execute(&pool)
        .await?
    } else if let Some(did) = payload.department_id {
        sqlx::query!(
            r#"UPDATE item_settings ist SET is_active=$1
               FROM items i WHERE ist.item_id=i.id AND i.department_id=$2 AND ist.store_id=$3"#,
            active, did, payload.store_id,
        )
        .execute(&pool)
        .await?
    } else {
        return Err(AppError::Validation("Provide item_ids, category_id, or department_id".into()));
    };
    let verb = if active { "activated" } else { "deactivated" };
    Ok(BulkOperationResult { affected: result.rows_affected(), message: format!("{} item(s) {verb}", result.rows_affected()) })
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
        (format!("store_id={} AND category_id={}", payload.store_id, cid),
         format!("CASE WHEN {percent}=0 THEN NULL ELSE ROUND(selling_price*(1-{percent}/100.0),2) END"))
    } else {
        let did = payload.department_id.unwrap();
        (format!("store_id={} AND department_id={}", payload.store_id, did),
         format!("CASE WHEN {percent}=0 THEN NULL ELSE ROUND(selling_price*(1-{percent}/100.0),2) END"))
    };

    let sql = format!("UPDATE items SET discount_price={discount_expr}, updated_at=NOW() WHERE {where_clause}");
    let result = sqlx::query(&sql).execute(&pool).await.map_err(AppError::Database)?;
    let pct_str = if percent == Decimal::ZERO { "cleared".to_string() } else { format!("{percent}% discount applied") };
    Ok(BulkOperationResult { affected: result.rows_affected(), message: format!("{} item(s): {pct_str}", result.rows_affected()) })
}

// ── bulk_item_import ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn bulk_item_import(
    state:   State<'_, AppState>,
    token:   String,
    payload: BulkItemImportDto,
) -> AppResult<BulkImportResult> {
    let claims = guard_permission(&state, &token, "items.create").await?;
    let pool   = state.pool().await?;

    if payload.items.is_empty() {
        return Err(AppError::Validation("No items provided for import".into()));
    }

    let mut created = 0u64;
    let mut updated = 0u64;
    let mut failed  = 0u64;
    let mut errors  = Vec::new();

    for (idx, row) in payload.items.iter().enumerate() {
        if row.item_name.trim().is_empty() {
            failed += 1;
            errors.push(format!("Row {}: item_name is required", idx + 1));
            continue;
        }
        if row.selling_price < 0.0 || row.cost_price < 0.0 {
            failed += 1;
            errors.push(format!("Row {}: prices must be non-negative ('{}')", idx + 1, row.item_name));
            continue;
        }

        let cost  = Decimal::try_from(row.cost_price).unwrap_or_default();
        let sell  = Decimal::try_from(row.selling_price).unwrap_or_default();
        let sku   = row.sku.clone().unwrap_or_else(|| {
            format!("SKU-{}", uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("0000").to_uppercase())
        });

        // Upsert by SKU within store
        let result = sqlx::query!(
            r#"INSERT INTO items
                   (store_id, item_name, sku, barcode, cost_price, selling_price,
                    category_id, department_id, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (store_id, sku) DO UPDATE SET
                   item_name    = EXCLUDED.item_name,
                   barcode      = COALESCE(EXCLUDED.barcode, items.barcode),
                   cost_price   = EXCLUDED.cost_price,
                   selling_price= EXCLUDED.selling_price,
                   category_id  = COALESCE(EXCLUDED.category_id,   items.category_id),
                   department_id= COALESCE(EXCLUDED.department_id, items.department_id),
                   updated_at   = NOW()
               RETURNING (xmax = 0) AS is_insert"#,
            payload.store_id,
            row.item_name.trim(),
            sku,
            row.barcode,
            cost, sell,
            row.category_id,
            row.department_id,
            claims.user_id,
        )
        .fetch_optional(&pool)
        .await;

        match result {
            Ok(Some(r)) => {
                if r.is_insert.unwrap_or(true) { created += 1; } else { updated += 1; }
            }
            Ok(None) => { updated += 1; }
            Err(e) => {
                failed += 1;
                errors.push(format!("Row {}: {} — {}", idx + 1, row.item_name, e));
            }
        }
    }

    Ok(BulkImportResult { created, updated, failed, errors })
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
                 AND ($2::int IS NULL OR i.category_id   = $2)
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
