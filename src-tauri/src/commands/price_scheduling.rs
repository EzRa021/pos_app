// ============================================================================
// PRICE SCHEDULING
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};
use uuid::Uuid;
use crate::{
    error::{AppError, AppResult},
    models::price_scheduling::{ScheduledPriceChange, ItemPriceHistoryRow, SchedulePriceChangeDto},
    state::AppState,
};
use super::auth::guard_permission;

// ── get_item_price_history ────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_item_price_history(
    state:    State<'_, AppState>,
    token:    String,
    item_id:  String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<ItemPriceHistoryRow>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool  = state.pool().await?;
    let uid   = Uuid::parse_str(&item_id).map_err(|_| AppError::Validation("Invalid item_id".into()))?;
    let limit = limit.unwrap_or(100).clamp(1, 500);

    sqlx::query_as!(
        ItemPriceHistoryRow,
        r#"SELECT ph.id, ph.item_id, i.item_name, ph.store_id,
               ph.old_price, ph.new_price AS "new_price!: Decimal",
               ph.changed_by, ph.reason, ph.created_at
           FROM price_history ph
           JOIN items i ON i.id=ph.item_id
           WHERE ph.item_id=$1 AND ($2::int IS NULL OR ph.store_id=$2)
           ORDER BY ph.created_at DESC LIMIT $3"#,
        uid, store_id, limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── schedule_price_change ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn schedule_price_change(
    state:   State<'_, AppState>,
    token:   String,
    payload: SchedulePriceChangeDto,
) -> AppResult<ScheduledPriceChange> {
    let claims = guard_permission(&state, &token, "items.update").await?;
    let pool   = state.pool().await?;

    let item_id = Uuid::parse_str(&payload.item_id)
        .map_err(|_| AppError::Validation("Invalid item_id".into()))?;
    let new_sell = Decimal::try_from(payload.new_selling_price).unwrap_or_default();
    let new_cost = payload.new_cost_price.map(|c| Decimal::try_from(c).unwrap_or_default());
    let effective_at = payload.effective_at.parse::<DateTime<Utc>>()
        .map_err(|_| AppError::Validation("Invalid effective_at datetime".into()))?;
    if effective_at <= Utc::now() {
        return Err(AppError::Validation("effective_at must be in the future".into()));
    }

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO scheduled_price_changes
               (item_id, store_id, new_selling_price, new_cost_price, change_reason, effective_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id"#,
        item_id, payload.store_id, new_sell, new_cost, payload.change_reason, effective_at, claims.user_id,
    )
    .fetch_one(&pool)
    .await?;

    fetch_scheduled(&pool, id).await
}

// ── cancel_scheduled_price_change ─────────────────────────────────────────────

#[tauri::command]
pub async fn cancel_scheduled_price_change(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<ScheduledPriceChange> {
    guard_permission(&state, &token, "items.update").await?;
    let pool = state.pool().await?;
    let rec = sqlx::query!(
        "SELECT applied, cancelled FROM scheduled_price_changes WHERE id=$1", id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Scheduled price change {id} not found")))?;
    if rec.applied   { return Err(AppError::Validation("Cannot cancel an already-applied price change".into())); }
    if rec.cancelled { return Err(AppError::Validation("Already cancelled".into())); }
    sqlx::query!("UPDATE scheduled_price_changes SET cancelled=TRUE WHERE id=$1", id)
        .execute(&pool)
        .await?;
    fetch_scheduled(&pool, id).await
}

// ── get_pending_price_changes ─────────────────────────────────────────────────

#[tauri::command]
pub async fn get_pending_price_changes(
    state:           State<'_, AppState>,
    token:           String,
    store_id:        i32,
    include_applied: Option<bool>,
) -> AppResult<Vec<ScheduledPriceChange>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool         = state.pool().await?;
    let show_applied = include_applied.unwrap_or(false);
    sqlx::query_as!(
        ScheduledPriceChange,
        r#"SELECT spc.id, spc.item_id, i.item_name, spc.store_id,
               spc.new_selling_price AS "new_selling_price!: Decimal",
               spc.new_cost_price, spc.change_reason, spc.effective_at,
               spc.created_by, spc.applied, spc.applied_at, spc.cancelled, spc.created_at
           FROM scheduled_price_changes spc
           JOIN items i ON i.id=spc.item_id
           WHERE spc.store_id=$1 AND spc.cancelled=FALSE AND ($2 OR spc.applied=FALSE)
           ORDER BY spc.effective_at ASC"#,
        store_id, show_applied,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── apply_scheduled_prices ────────────────────────────────────────────────────

#[tauri::command]
pub async fn apply_scheduled_prices(
    state: State<'_, AppState>,
    token: String,
) -> AppResult<serde_json::Value> {
    let claims = guard_permission(&state, &token, "items.update").await?;
    let pool   = state.pool().await?;

    let due = sqlx::query!(
        r#"SELECT id, item_id, store_id, new_selling_price, new_cost_price
           FROM scheduled_price_changes
           WHERE applied=FALSE AND cancelled=FALSE AND effective_at<=NOW()
           ORDER BY effective_at ASC"#,
    )
    .fetch_all(&pool)
    .await?;

    let count   = due.len() as i64;
    let mut applied = 0i64;

    for rec in &due {
        let mut tx = pool.begin().await?;
        let old_price: Option<Decimal> = sqlx::query_scalar!(
            "SELECT selling_price FROM items WHERE id=$1", rec.item_id
        )
        .fetch_optional(&mut *tx)
        .await?;

        let mut sql = format!("UPDATE items SET selling_price={}, updated_at=NOW()", rec.new_selling_price);
        if let Some(cp) = rec.new_cost_price { sql.push_str(&format!(", cost_price={cp}")); }
        sql.push_str(&format!(" WHERE id='{}'", rec.item_id));

        if sqlx::query(&sql).execute(&mut *tx).await.is_err() { tx.rollback().await.ok(); continue; }

        sqlx::query!(
            "INSERT INTO price_history (item_id, store_id, old_price, new_price, changed_by, reason) VALUES ($1,$2,$3,$4,$5,'Scheduled price change')",
            rec.item_id, rec.store_id, old_price, rec.new_selling_price, claims.user_id,
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "UPDATE scheduled_price_changes SET applied=TRUE, applied_at=NOW() WHERE id=$1", rec.id,
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        applied += 1;
    }

    Ok(serde_json::json!({ "due": count, "applied": applied, "skipped": count - applied }))
}

// ── helper ────────────────────────────────────────────────────────────────────

async fn fetch_scheduled(pool: &sqlx::PgPool, id: i32) -> AppResult<ScheduledPriceChange> {
    sqlx::query_as!(
        ScheduledPriceChange,
        r#"SELECT spc.id, spc.item_id, i.item_name, spc.store_id,
               spc.new_selling_price AS "new_selling_price!: Decimal",
               spc.new_cost_price, spc.change_reason, spc.effective_at,
               spc.created_by, spc.applied, spc.applied_at, spc.cancelled, spc.created_at
           FROM scheduled_price_changes spc
           JOIN items i ON i.id=spc.item_id
           WHERE spc.id=$1"#,
        id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Scheduled price change {id} not found")))
}
