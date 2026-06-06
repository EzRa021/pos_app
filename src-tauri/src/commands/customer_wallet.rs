// ============================================================================
// CUSTOMER WALLET / ADVANCE PAYMENT
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::customer_wallet::{WalletTransaction, WalletBalance, DepositDto, AdjustWalletDto},
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;
use super::audit::write_audit_log;

// ── deposit_to_wallet ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deposit_to_wallet(
    state:   State<'_, AppState>,
    token:   String,
    payload: DepositDto,
) -> AppResult<WalletTransaction> {
    let claims = guard_permission(&state, &token, "customers.update").await?;
    let pool   = state.pool().await?;
    if payload.amount <= 0.0 {
        return Err(AppError::Validation("Deposit amount must be positive".into()));
    }
    let amount = Decimal::try_from(payload.amount).unwrap_or_default();
    wallet_tx(&pool, payload.customer_id, payload.store_id, None,
        "deposit", amount, payload.reference, payload.notes, claims.user_id).await
}

// ── get_wallet_balance ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_wallet_balance(
    state:       State<'_, AppState>,
    token:       String,
    customer_id: i32,
) -> AppResult<WalletBalance> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool = state.pool().await?;
    let row = sqlx::query!(
        r#"SELECT c.id,
               CONCAT(c.first_name,' ',c.last_name) AS customer_name,
               COALESCE(c.wallet_balance, 0) AS balance,
               COALESCE(SUM(cwt.amount) FILTER (WHERE cwt.type='deposit'), 0) AS total_deposited,
               COALESCE(SUM(cwt.amount) FILTER (WHERE cwt.type='debit'),   0) AS total_spent
           FROM customers c
           LEFT JOIN customer_wallet_transactions cwt ON cwt.customer_id=c.id
           WHERE c.id=$1
           GROUP BY c.id, c.first_name, c.last_name, c.wallet_balance"#,
        customer_id,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Customer {customer_id} not found")))?;

    Ok(WalletBalance {
        customer_id:     row.id,
        customer_name:   row.customer_name.unwrap_or_default(),
        balance:         row.balance.unwrap_or_default(),
        total_deposited: row.total_deposited.unwrap_or_default(),
        total_spent:     row.total_spent.unwrap_or_default(),
    })
}

// ── get_wallet_history ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_wallet_history(
    state:       State<'_, AppState>,
    token:       String,
    customer_id: i32,
    page:        Option<i64>,
    limit:       Option<i64>,
) -> AppResult<PagedResult<WalletTransaction>> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool  = state.pool().await?;
    let page = page.unwrap_or(1).max(1);
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let offset = (page - 1) * limit;

    let total = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM customer_wallet_transactions WHERE customer_id=$1",
        customer_id
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let rows = sqlx::query_as!(
        WalletTransaction,
        r#"SELECT id, customer_id, store_id, type, amount, balance_after,
                  reference, transaction_id, recorded_by, notes, created_at
           FROM customer_wallet_transactions
           WHERE customer_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"#,
        customer_id, limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(rows, total, page, limit))
}

// ── adjust_wallet ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn adjust_wallet(
    state:   State<'_, AppState>,
    token:   String,
    payload: AdjustWalletDto,
) -> AppResult<WalletTransaction> {
    let claims = guard_permission(&state, &token, "stores.manage").await?;
    let pool   = state.pool().await?;
    if payload.amount == 0.0 {
        return Err(AppError::Validation("Adjustment must be non-zero".into()));
    }
    let reason = payload.reason.trim().to_string();
    if reason.len() < 10 {
        return Err(AppError::Validation(
            "Adjustment reason must be at least 10 characters.".into()
        ));
    }

    let signed = Decimal::try_from(payload.amount).unwrap_or_default();
    let tx = wallet_tx(
        &pool,
        payload.customer_id,
        payload.store_id,
        None,
        "adjustment",
        signed,
        None,
        Some(reason.clone()),
        claims.user_id,
    )
    .await?;

    write_audit_log(
        &pool,
        claims.user_id,
        Some(payload.store_id),
        "adjust",
        "customer_wallet",
        &format!(
            "Adjusted wallet for customer {} by {} (after: {}) — {}",
            payload.customer_id,
            signed.round_dp(2),
            tx.balance_after.round_dp(2),
            reason
        ),
        "warning",
    )
    .await;

    Ok(tx)
}

// ── internal: debit_wallet ────────────────────────────────────────────────────

#[allow(dead_code)]
pub(crate) async fn debit_wallet(
    pool:           &sqlx::PgPool,
    customer_id:    i32,
    store_id:       i32,
    transaction_id: i32,
    amount:         Decimal,
    performed_by:   i32,
) -> AppResult<WalletTransaction> {
    let balance: Option<Decimal> = sqlx::query_scalar!(
        "SELECT wallet_balance FROM customers WHERE id=$1", customer_id
    )
    .fetch_optional(pool)
    .await?;

    if balance.unwrap_or_default() < amount {
        return Err(AppError::Validation(format!(
            "Insufficient wallet balance: available {:.2}, needed {:.2}",
            balance.unwrap_or_default(), amount
        )));
    }

    wallet_tx(pool, customer_id, store_id, Some(transaction_id),
        "debit", -amount, None, Some("POS sale debit".into()), performed_by).await
}

// ── shared helper ─────────────────────────────────────────────────────────────

pub(crate) async fn wallet_tx(
    pool:           &sqlx::PgPool,
    customer_id:    i32,
    store_id:       i32,
    transaction_id: Option<i32>,
    kind:           &str,
    amount:         Decimal,
    reference:      Option<String>,
    notes:          Option<String>,
    recorded_by:    i32,
) -> AppResult<WalletTransaction> {
    let mut tx = pool.begin().await?;

    let customer_store = sqlx::query_scalar!("SELECT store_id FROM customers WHERE id=$1", customer_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Customer {customer_id} not found")))?;
    if customer_store != store_id {
        return Err(AppError::Forbidden);
    }

    let current: Decimal = sqlx::query_scalar!(
        "SELECT COALESCE(wallet_balance, 0) FROM customers WHERE id=$1 FOR UPDATE",
        customer_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .flatten()
    .unwrap_or_default();

    let balance_after = current + amount;
    if balance_after < Decimal::ZERO {
        return Err(AppError::Validation("Insufficient wallet balance".into()));
    }
    sqlx::query!(
        "UPDATE customers SET wallet_balance=$1, updated_at=NOW() WHERE id=$2",
        balance_after, customer_id,
    )
    .execute(&mut *tx)
    .await?;

    let stored_amount = if kind == "adjustment" { amount } else { amount.abs() };
    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO customer_wallet_transactions
               (customer_id, store_id, type, amount, balance_after, reference,
                transaction_id, recorded_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id"#,
        customer_id, store_id, kind, stored_amount, balance_after,
        reference, transaction_id, recorded_by, notes,
    )
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    // Cloud sync (best-effort)
    crate::database::sync::queue_row(
        pool,
        "customers",
        "UPDATE",
        &customer_id.to_string(),
        serde_json::json!({ "id": customer_id, "store_id": store_id, "wallet_balance": balance_after }),
        Some(store_id),
    )
    .await;
    crate::database::sync::queue_row(
        pool,
        "customer_wallet_transactions",
        "INSERT",
        &id.to_string(),
        serde_json::json!({ "id": id, "customer_id": customer_id, "store_id": store_id, "type": kind, "amount": stored_amount, "balance_after": balance_after }),
        Some(store_id),
    )
    .await;

    sqlx::query_as!(
        WalletTransaction,
        r#"SELECT id, customer_id, store_id, type, amount, balance_after,
                  reference, transaction_id, recorded_by, notes, created_at
           FROM customer_wallet_transactions WHERE id=$1"#,
        id,
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}
