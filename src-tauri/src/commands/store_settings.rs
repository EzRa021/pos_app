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
           tax_inclusive                       = COALESCE($15, tax_inclusive),
           auto_create_po_on_reorder           = COALESCE($16, auto_create_po_on_reorder),
           opening_float_required              = COALESCE($17, opening_float_required),
           min_opening_float                   = COALESCE($18, min_opening_float),
           max_credit_days                     = COALESCE($19, max_credit_days),
           auto_flag_overdue_after_days        = COALESCE($20, auto_flag_overdue_after_days),
           currency                            = COALESCE($21, currency),
           locale                              = COALESCE($22, locale),
           notif_low_stock_enabled             = COALESCE($23, notif_low_stock_enabled),
           notif_low_stock_threshold           = COALESCE($24, notif_low_stock_threshold),
           notif_overdue_credit_enabled        = COALESCE($25, notif_overdue_credit_enabled),
           notif_overdue_credit_days           = COALESCE($26, notif_overdue_credit_days),
           notif_shift_end_reminder_enabled    = COALESCE($27, notif_shift_end_reminder_enabled),
           notif_shift_end_minutes             = COALESCE($28, notif_shift_end_minutes),
           notif_min_float_warning_enabled     = COALESCE($29, notif_min_float_warning_enabled),
           notif_min_float_amount              = COALESCE($30, notif_min_float_amount),
           notif_in_app_enabled               = COALESCE($31, notif_in_app_enabled),
           default_reorder_point               = COALESCE($32, default_reorder_point),
           default_reorder_qty                 = COALESCE($33, default_reorder_qty),
           updated_at                          = NOW()
           WHERE store_id = $34"#,
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
        payload.tax_inclusive,
        payload.auto_create_po_on_reorder,
        payload.opening_float_required,
        payload.min_opening_float.map(to_dec),
        payload.max_credit_days,
        payload.auto_flag_overdue_after_days,
        payload.currency,
        payload.locale,
        payload.notif_low_stock_enabled,
        payload.notif_low_stock_threshold,
        payload.notif_overdue_credit_enabled,
        payload.notif_overdue_credit_days,
        payload.notif_shift_end_reminder_enabled,
        payload.notif_shift_end_minutes,
        payload.notif_min_float_warning_enabled,
        payload.notif_min_float_amount.map(to_dec),
        payload.notif_in_app_enabled,
        payload.default_reorder_point,
        payload.default_reorder_qty,
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
                  tax_inclusive,
                  auto_create_po_on_reorder,
                  opening_float_required, min_opening_float,
                  max_credit_days, auto_flag_overdue_after_days,
                  currency, locale,
                  notif_low_stock_enabled, notif_low_stock_threshold,
                  notif_overdue_credit_enabled, notif_overdue_credit_days,
                  notif_shift_end_reminder_enabled, notif_shift_end_minutes,
                  notif_min_float_warning_enabled, notif_min_float_amount,
                  notif_in_app_enabled,
                  default_reorder_point, default_reorder_qty,
                  created_at, updated_at
           FROM store_settings WHERE store_id = $1"#,
        store_id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Store settings not found for store {store_id}")))
}
