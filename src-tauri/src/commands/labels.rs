// ============================================================================
// BARCODE & LABEL PRINTING
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::label::{ItemLabel, LabelTemplate, GenerateLabelsDto, PrintPriceTagsDto, SaveLabelTemplateDto},
    state::AppState,
};
use super::auth::guard_permission;

// ── generate_item_labels ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_item_labels(
    state:   State<'_, AppState>,
    token:   String,
    payload: GenerateLabelsDto,
) -> AppResult<Vec<ItemLabel>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;

    let uuids: Vec<uuid::Uuid> = payload.item_ids.iter()
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
           LEFT JOIN item_stock istock ON istock.item_id=i.id AND istock.store_id=i.store_id
           WHERE i.id=ANY($1) AND i.store_id=$2 ORDER BY i.item_name"#,
        &uuids, payload.store_id,
    )
    .fetch_all(&pool)
    .await?;

    let copies = payload.copies.unwrap_or(1).max(1) as usize;
    let mut labels = Vec::with_capacity(rows.len() * copies);
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
    Ok(labels)
}

// ── auto_generate_barcode ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn auto_generate_barcode(
    state:   State<'_, AppState>,
    token:   String,
    item_id: String,
) -> AppResult<String> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;
    let uid  = uuid::Uuid::parse_str(&item_id)
        .map_err(|_| AppError::Validation("Invalid item_id".into()))?;

    let existing: Option<Option<String>> = sqlx::query_scalar!(
        "SELECT barcode FROM items WHERE id=$1", uid
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(Some(bc)) = existing {
        if !bc.is_empty() { return Ok(bc); }
    }

    // Generate a numeric suffix from a UUID to avoid needing a DB sequence
    let seq: u64 = uuid::Uuid::new_v4().as_u128() as u64 % 10_000_000_000u64;
    let barcode = format!("QP{:010}", seq);
    sqlx::query!("UPDATE items SET barcode=$1, updated_at=NOW() WHERE id=$2", barcode, uid)
        .execute(&pool)
        .await?;
    Ok(barcode)
}

// ── print_price_tags ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn print_price_tags(
    state:   State<'_, AppState>,
    token:   String,
    payload: PrintPriceTagsDto,
) -> AppResult<Vec<ItemLabel>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;

    if payload.category_id.is_none() && payload.department_id.is_none() {
        return Err(AppError::Validation("Either category_id or department_id required".into()));
    }

    let rows = sqlx::query!(
        r#"SELECT i.id::text AS item_id, i.item_name, i.sku, i.barcode,
               i.selling_price, i.cost_price, s.store_name, c.category_name,
               istock.quantity::int AS quantity
           FROM items i
           JOIN stores s ON s.id=i.store_id
           LEFT JOIN categories c ON c.id=i.category_id
           LEFT JOIN item_stock istock ON istock.item_id=i.id AND istock.store_id=i.store_id
           LEFT JOIN item_settings ist ON ist.item_id=i.id
           WHERE i.store_id=$1
             AND ($2::int IS NULL OR i.category_id=$2)
             AND ($3::int IS NULL OR i.department_id=$3)
             AND (ist.is_active IS NULL OR ist.is_active=TRUE)
           ORDER BY i.item_name"#,
        payload.store_id, payload.category_id, payload.department_id,
    )
    .fetch_all(&pool)
    .await?;

    let copies = payload.copies.unwrap_or(1).max(1) as usize;
    let mut labels = Vec::with_capacity(rows.len() * copies);
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
    Ok(labels)
}

// ── get_label_template ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_label_template(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Option<LabelTemplate>> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;
    sqlx::query_as!(
        LabelTemplate,
        r#"SELECT id, store_id, name, format, show_price, show_sku,
                  show_name, show_store, show_expiry, is_default
           FROM label_templates WHERE store_id=$1 AND is_default=TRUE LIMIT 1"#,
        store_id,
    )
    .fetch_optional(&pool)
    .await
    .map_err(AppError::from)
}

// ── save_label_template ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_label_template(
    state:   State<'_, AppState>,
    token:   String,
    payload: SaveLabelTemplateDto,
) -> AppResult<LabelTemplate> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    if payload.is_default {
        sqlx::query!("UPDATE label_templates SET is_default=FALSE WHERE store_id=$1", payload.store_id)
            .execute(&pool)
            .await?;
    }

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO label_templates
               (store_id, name, format, show_price, show_sku, show_name, show_store, show_expiry, is_default)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (store_id, name) DO UPDATE SET
               format=EXCLUDED.format, show_price=EXCLUDED.show_price,
               show_sku=EXCLUDED.show_sku, show_name=EXCLUDED.show_name,
               show_store=EXCLUDED.show_store, show_expiry=EXCLUDED.show_expiry,
               is_default=EXCLUDED.is_default
           RETURNING id"#,
        payload.store_id, payload.name, payload.format,
        payload.show_price, payload.show_sku, payload.show_name,
        payload.show_store, payload.show_expiry, payload.is_default,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        LabelTemplate,
        r#"SELECT id, store_id, name, format, show_price, show_sku,
                  show_name, show_store, show_expiry, is_default
           FROM label_templates WHERE id=$1"#,
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}
