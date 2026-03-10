// ============================================================================
// STORE SETTINGS / BUSINESS RULES
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::store_settings::{StoreSettings, UpdateStoreSettingsDto},
    state::AppState,
};
use super::auth::guard_permission;

// ── get_store_settings ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_store_settings(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<StoreSettings> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "INSERT INTO store_settings (store_id) VALUES ($1) ON CONFLICT DO NOTHING",
        store_id,
    )
    .execute(&pool)
    .await?;
    fetch_settings(&pool, store_id).await
}

// ── update_store_settings ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_store_settings(
    state:   State<'_, AppState>,
    token:   String,
    payload: UpdateStoreSettingsDto,
) -> AppResult<StoreSettings> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool   = state.pool().await?;
    let to_dec = |v: f64| Decimal::try_from(v).unwrap_or_default();

    sqlx::query!(
        "INSERT INTO store_settings (store_id) VALUES ($1) ON CONFLICT DO NOTHING",
        payload.store_id,
    )
    .execute(&pool)
    .await?;

    sqlx::query!(
        r#"UPDATE store_settings SET
           allow_price_override                = COALESCE($1,  allow_price_override),
           max_discount_percent                = COALESCE($2,  max_discount_percent),
           require_discount_reason             = COALESCE($3,  require_discount_reason),
           warn_sell_below_cost                = COALESCE($4,  warn_sell_below_cost),
           allow_sell_below_cost               = COALESCE($5,  allow_sell_below_cost),
           require_customer_above_amount       = COALESCE($6,  require_customer_above_amount),
           void_same_day_only                  = COALESCE($7,  void_same_day_only),
           max_void_amount                     = COALESCE($8,  max_void_amount),
           require_manager_approval_void_above = COALESCE($9,  require_manager_approval_void_above),
           receipt_header_text                 = COALESCE($10, receipt_header_text),
           receipt_footer_text                 = COALESCE($11, receipt_footer_text),
           show_vat_on_receipt                 = COALESCE($12, show_vat_on_receipt),
           show_cashier_on_receipt             = COALESCE($13, show_cashier_on_receipt),
           receipt_copies                      = COALESCE($14, receipt_copies),
           auto_create_po_on_reorder           = COALESCE($15, auto_create_po_on_reorder),
           opening_float_required              = COALESCE($16, opening_float_required),
           min_opening_float                   = COALESCE($17, min_opening_float),
           max_credit_days                     = COALESCE($18, max_credit_days),
           auto_flag_overdue_after_days        = COALESCE($19, auto_flag_overdue_after_days),
           updated_at                          = NOW()
           WHERE store_id = $20"#,
        payload.allow_price_override,
        payload.max_discount_percent.map(to_dec),
        payload.require_discount_reason,
        payload.warn_sell_below_cost,
        payload.allow_sell_below_cost,
        payload.require_customer_above_amount.map(to_dec),
        payload.void_same_day_only,
        payload.max_void_amount.map(to_dec),
        payload.require_manager_approval_void_above.map(to_dec),
        payload.receipt_header_text,
        payload.receipt_footer_text,
        payload.show_vat_on_receipt,
        payload.show_cashier_on_receipt,
        payload.receipt_copies,
        payload.auto_create_po_on_reorder,
        payload.opening_float_required,
        payload.min_opening_float.map(to_dec),
        payload.max_credit_days,
        payload.auto_flag_overdue_after_days,
        payload.store_id,
    )
    .execute(&pool)
    .await?;

    fetch_settings(&pool, payload.store_id).await
}

// ── fetch_settings (pub(crate) so transactions.rs can use it) ─────────────────

pub(crate) async fn fetch_settings(pool: &sqlx::PgPool, store_id: i32) -> AppResult<StoreSettings> {
    sqlx::query_as!(
        StoreSettings,
        r#"SELECT store_id,
                  allow_price_override, max_discount_percent,
                  require_discount_reason, warn_sell_below_cost, allow_sell_below_cost,
                  require_customer_above_amount, void_same_day_only,
                  max_void_amount, require_manager_approval_void_above,
                  receipt_header_text, receipt_footer_text,
                  show_vat_on_receipt, show_cashier_on_receipt, receipt_copies,
                  auto_create_po_on_reorder,
                  opening_float_required, min_opening_float,
                  max_credit_days, auto_flag_overdue_after_days,
                  created_at, updated_at
           FROM store_settings WHERE store_id = $1"#,
        store_id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Store settings not found for store {store_id}")))
}
