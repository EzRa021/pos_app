// ============================================================================
// SUPPLIER PAYMENTS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::supplier_payment::{
        SupplierPayment, SupplierBalance,
        RecordSupplierPaymentDto, SupplierPaymentFilters,
    },
    state::AppState,
};
use super::auth::guard_permission;

// ── record_supplier_payment ───────────────────────────────────────────────────

#[tauri::command]
pub async fn record_supplier_payment(
    state:   State<'_, AppState>,
    token:   String,
    payload: RecordSupplierPaymentDto,
) -> AppResult<SupplierPayment> {
    let claims = guard_permission(&state, &token, "purchase_orders.manage").await?;
    let pool   = state.pool().await?;

    if payload.amount <= 0.0 {
        return Err(AppError::Validation("Payment amount must be positive".into()));
    }

    let amount = Decimal::try_from(payload.amount).unwrap_or_default();
    let method = payload.payment_method.unwrap_or_else(|| "cash".into());
    let mut tx = pool.begin().await?;

    let exists: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM suppliers WHERE id = $1)",
        payload.supplier_id,
    )
    .fetch_one(&mut *tx)
    .await?
    .unwrap_or(false);

    if !exists {
        return Err(AppError::NotFound(format!("Supplier {} not found", payload.supplier_id)));
    }

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO supplier_payments
               (supplier_id, store_id, po_id, amount, payment_method, reference, notes, paid_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id"#,
        payload.supplier_id, payload.store_id, payload.po_id,
        amount, method, payload.reference, payload.notes, claims.user_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query!(
        r#"UPDATE suppliers
           SET current_balance = GREATEST(COALESCE(current_balance, 0) - $1, 0),
               updated_at = NOW()
           WHERE id = $2"#,
        amount, payload.supplier_id,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    fetch_payment(&pool, id).await
}

// ── get_supplier_payments ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_supplier_payments(
    state:   State<'_, AppState>,
    token:   String,
    filters: SupplierPaymentFilters,
) -> AppResult<Vec<SupplierPayment>> {
    guard_permission(&state, &token, "purchase_orders.read").await?;
    let pool  = state.pool().await?;
    let limit = filters.limit.unwrap_or(50).clamp(1, 500);
    let page  = filters.page.unwrap_or(1).max(1);
    let off   = (page - 1) * limit;

    sqlx::query_as!(
        SupplierPayment,
        r#"SELECT sp.id, sp.supplier_id, s.supplier_name, sp.store_id, sp.po_id,
               po.po_number, sp.amount AS "amount!: Decimal",
               sp.payment_method, sp.reference, sp.notes,
               sp.paid_by, sp.paid_at, sp.created_at
           FROM supplier_payments sp
           JOIN suppliers s ON s.id = sp.supplier_id
           LEFT JOIN purchase_orders po ON po.id = sp.po_id
           WHERE ($1::int IS NULL OR sp.supplier_id = $1)
             AND ($2::int IS NULL OR sp.store_id    = $2)
           ORDER BY sp.paid_at DESC
           LIMIT $3 OFFSET $4"#,
        filters.supplier_id, filters.store_id, limit, off,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── get_supplier_balance ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_supplier_balance(
    state:       State<'_, AppState>,
    token:       String,
    supplier_id: i32,
) -> AppResult<SupplierBalance> {
    guard_permission(&state, &token, "purchase_orders.read").await?;
    let pool = state.pool().await?;

    let row = sqlx::query!(
        r#"SELECT s.id, s.supplier_name,
               COALESCE(s.current_balance, 0) AS current_balance,
               COALESCE(SUM(sp.amount), 0)    AS total_paid,
               COALESCE(SUM(po.total_amount) FILTER (
                   WHERE po.status IN ('received','partially_received')
               ), 0) AS total_po_value
           FROM suppliers s
           LEFT JOIN supplier_payments sp ON sp.supplier_id = s.id
           LEFT JOIN purchase_orders   po ON po.supplier_id = s.id
           WHERE s.id = $1
           GROUP BY s.id, s.supplier_name, s.current_balance"#,
        supplier_id,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Supplier {supplier_id} not found")))?;

    Ok(SupplierBalance {
        supplier_id:    row.id,
        supplier_name:  row.supplier_name,
        current_balance: row.current_balance.unwrap_or_default(),
        total_paid:      row.total_paid.unwrap_or_default(),
        total_po_value:  row.total_po_value.unwrap_or_default(),
    })
}

// ── get_all_supplier_payables ─────────────────────────────────────────────────

/// Returns all suppliers with outstanding balances > 0, ordered by balance desc.
#[tauri::command]
pub async fn get_all_supplier_payables(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<SupplierBalance>> {
    guard_permission(&state, &token, "purchase_orders.read").await?;
    let pool = state.pool().await?;

    let rows = sqlx::query!(
        r#"SELECT s.id, s.supplier_name,
               COALESCE(s.current_balance, 0) AS current_balance,
               COALESCE(SUM(sp.amount), 0)    AS total_paid,
               COALESCE(SUM(po.total_amount) FILTER (
                   WHERE po.status IN ('received','partially_received')
               ), 0) AS total_po_value
           FROM suppliers s
           LEFT JOIN supplier_payments sp ON sp.supplier_id = s.id AND sp.store_id = $1
           LEFT JOIN purchase_orders   po ON po.supplier_id = s.id AND po.store_id = $1
           WHERE s.store_id = $1
             AND COALESCE(s.current_balance, 0) > 0
             AND s.is_active = TRUE
           GROUP BY s.id, s.supplier_name, s.current_balance
           ORDER BY s.current_balance DESC"#,
        store_id,
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows.into_iter().map(|r| SupplierBalance {
        supplier_id:    r.id,
        supplier_name:  r.supplier_name,
        current_balance: r.current_balance.unwrap_or_default(),
        total_paid:      r.total_paid.unwrap_or_default(),
        total_po_value:  r.total_po_value.unwrap_or_default(),
    }).collect())
}

// ── helper ────────────────────────────────────────────────────────────────────

async fn fetch_payment(pool: &sqlx::PgPool, id: i32) -> AppResult<SupplierPayment> {
    sqlx::query_as!(
        SupplierPayment,
        r#"SELECT sp.id, sp.supplier_id, s.supplier_name, sp.store_id, sp.po_id,
               po.po_number, sp.amount AS "amount!: Decimal",
               sp.payment_method, sp.reference, sp.notes,
               sp.paid_by, sp.paid_at, sp.created_at
           FROM supplier_payments sp
           JOIN suppliers s ON s.id = sp.supplier_id
           LEFT JOIN purchase_orders po ON po.id = sp.po_id
           WHERE sp.id = $1"#,
        id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Supplier payment {id} not found")))
}
