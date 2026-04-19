// ============================================================================
// PAYMENT METHOD SETTINGS COMMANDS
// ============================================================================

use tauri::State;
use crate::{
    error::{AppError, AppResult},
    models::payment_method_settings::{
        PaymentMethodSetting, UpsertPaymentMethodDto, ReorderPaymentMethodsDto,
    },
    state::AppState,
};
use super::auth::guard_permission;

// ── Seed helper: ensure all 5 default rows exist for a store ─────────────────

pub async fn ensure_defaults(pool: &sqlx::PgPool, store_id: i32) -> AppResult<()> {
    let defaults: &[(&str, &str, bool, bool, Option<&str>, i32)] = &[
        ("cash",          "Cash",          true,  false, None,                    0),
        ("card",          "POS Terminal",  true,  true,  Some("Terminal Reference"), 1),
        ("mobile_money",  "Mobile Money",  true,  true,  Some("Transaction ID"),  2),
        ("bank_transfer", "Bank Transfer", true,  true,  Some("Transfer Reference"), 3),
        ("split",         "Split Payment", false, false, None,                    4),
    ];
    for (key, name, enabled, req_ref, ref_label, order) in defaults {
        sqlx::query!(
            r#"INSERT INTO payment_method_settings
               (store_id, method_key, display_name, is_enabled, require_reference, reference_label, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (store_id, method_key) DO NOTHING"#,
            store_id, key, name, enabled, req_ref, *ref_label, order,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

// ── get ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_payment_methods(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<PaymentMethodSetting>> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;
    ensure_defaults(&pool, store_id).await?;

    sqlx::query_as!(
        PaymentMethodSetting,
        r#"SELECT id, store_id, method_key, display_name, is_enabled,
                  require_reference, reference_label, sort_order, created_at, updated_at
           FROM   payment_method_settings
           WHERE  store_id = $1
           ORDER  BY sort_order, id"#,
        store_id,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── upsert ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn upsert_payment_method(
    state:   State<'_, AppState>,
    token:   String,
    payload: UpsertPaymentMethodDto,
) -> AppResult<PaymentMethodSetting> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO payment_method_settings
           (store_id, method_key, display_name, is_enabled, require_reference, reference_label, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (store_id, method_key) DO UPDATE SET
               display_name      = EXCLUDED.display_name,
               is_enabled        = EXCLUDED.is_enabled,
               require_reference = EXCLUDED.require_reference,
               reference_label   = EXCLUDED.reference_label,
               sort_order        = EXCLUDED.sort_order,
               updated_at        = NOW()
           RETURNING id"#,
        payload.store_id,
        payload.method_key,
        payload.display_name,
        payload.is_enabled,
        payload.require_reference,
        payload.reference_label,
        payload.sort_order,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        PaymentMethodSetting,
        "SELECT id, store_id, method_key, display_name, is_enabled,
                require_reference, reference_label, sort_order, created_at, updated_at
         FROM   payment_method_settings WHERE id = $1",
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

// ── reorder ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn reorder_payment_methods(
    state:   State<'_, AppState>,
    token:   String,
    payload: ReorderPaymentMethodsDto,
) -> AppResult<()> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool = state.pool().await?;

    for (i, key) in payload.order.iter().enumerate() {
        sqlx::query!(
            "UPDATE payment_method_settings SET sort_order = $1, updated_at = NOW()
             WHERE store_id = $2 AND method_key = $3",
            i as i32,
            payload.store_id,
            key,
        )
        .execute(&pool)
        .await?;
    }
    Ok(())
}
