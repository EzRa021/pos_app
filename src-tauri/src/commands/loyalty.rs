// ============================================================================
// LOYALTY POINTS ENGINE
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    models::loyalty::{
        LoyaltySettings, LoyaltyTransaction, LoyaltyBalance,
        UpdateLoyaltySettingsDto, EarnPointsDto, RedeemPointsDto, AdjustPointsDto,
    },
    state::AppState,
};
use super::auth::guard_permission;

// ── get_loyalty_settings ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_loyalty_settings(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<LoyaltySettings> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "INSERT INTO loyalty_settings (store_id) VALUES ($1) ON CONFLICT DO NOTHING",
        store_id,
    )
    .execute(&pool)
    .await?;
    fetch_settings(&pool, store_id).await
}

// ── update_loyalty_settings ───────────────────────────────────────────────────

#[tauri::command]
pub async fn update_loyalty_settings(
    state:   State<'_, AppState>,
    token:   String,
    payload: UpdateLoyaltySettingsDto,
) -> AppResult<LoyaltySettings> {
    guard_permission(&state, &token, "stores.manage").await?;
    let pool   = state.pool().await?;
    let to_dec = |v: f64| Decimal::try_from(v).unwrap_or_default();
    sqlx::query!(
        "INSERT INTO loyalty_settings (store_id) VALUES ($1) ON CONFLICT DO NOTHING",
        payload.store_id,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"UPDATE loyalty_settings SET
           points_per_naira           = COALESCE($1, points_per_naira),
           naira_per_point_redemption = COALESCE($2, naira_per_point_redemption),
           min_redemption_points      = COALESCE($3, min_redemption_points),
           expiry_days                = COALESCE($4, expiry_days),
           is_active                  = COALESCE($5, is_active),
           updated_at                 = NOW()
           WHERE store_id = $6"#,
        payload.points_per_naira.map(to_dec),
        payload.naira_per_point_redemption.map(to_dec),
        payload.min_redemption_points,
        payload.expiry_days,
        payload.is_active,
        payload.store_id,
    )
    .execute(&pool)
    .await?;
    fetch_settings(&pool, payload.store_id).await
}

// ── earn_points ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn earn_points(
    state:   State<'_, AppState>,
    token:   String,
    payload: EarnPointsDto,
) -> AppResult<LoyaltyTransaction> {
    let claims = guard_permission(&state, &token, "transactions.create").await?;
    let pool   = state.pool().await?;
    let settings = fetch_settings(&pool, payload.store_id).await?;
    if !settings.is_active {
        return Err(AppError::Validation("Loyalty programme is not active for this store".into()));
    }
    let sale          = Decimal::try_from(payload.sale_amount).unwrap_or_default();
    let points_earned = (sale * settings.points_per_naira)
        .round().to_string().parse::<i32>().unwrap_or(0);
    if points_earned <= 0 {
        return Err(AppError::Validation("Sale amount too small to earn points".into()));
    }
    record_points_tx(
        &pool, payload.customer_id, payload.store_id, payload.transaction_id,
        "earn", points_earned,
        Some(format!("Earned {points_earned} points on sale of ₦{sale:.2}")),
        claims.user_id,
    ).await
}

// ── earn_points_internal ──────────────────────────────────────────────────────

/// Called internally from create_transaction after commit — no token needed.
pub(crate) async fn earn_points_internal(
    pool:           &sqlx::PgPool,
    store_id:       i32,
    customer_id:    i32,
    transaction_id: i32,
    sale_amount:    Decimal,
    performed_by:   i32,
) -> AppResult<()> {
    let settings = match fetch_settings(pool, store_id).await {
        Ok(s) => s,
        Err(_) => return Ok(()), // loyalty not configured — skip silently
    };
    if !settings.is_active { return Ok(()); }

    let points_earned = (sale_amount * settings.points_per_naira)
        .round().to_string().parse::<i32>().unwrap_or(0);
    if points_earned <= 0 { return Ok(()); }

    record_points_tx(
        pool, customer_id, store_id, Some(transaction_id),
        "earn", points_earned,
        Some(format!("Earned {points_earned} points on sale")),
        performed_by,
    )
    .await
    .map(|_| ())
}

// ── redeem_points ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn redeem_points(
    state:   State<'_, AppState>,
    token:   String,
    payload: RedeemPointsDto,
) -> AppResult<LoyaltyTransaction> {
    let claims = guard_permission(&state, &token, "transactions.create").await?;
    let pool   = state.pool().await?;
    let settings = fetch_settings(&pool, payload.store_id).await?;
    if !settings.is_active {
        return Err(AppError::Validation("Loyalty programme is not active".into()));
    }
    if payload.points < settings.min_redemption_points {
        return Err(AppError::Validation(format!(
            "Minimum redemption is {} points", settings.min_redemption_points
        )));
    }
    let balance = current_balance(&pool, payload.customer_id).await?;
    if balance < payload.points {
        return Err(AppError::Validation(format!(
            "Insufficient points: balance is {balance}, requested {}", payload.points
        )));
    }
    record_points_tx(
        &pool, payload.customer_id, payload.store_id, payload.transaction_id,
        "redeem", -payload.points,
        Some(format!("Redeemed {} points", payload.points)),
        claims.user_id,
    ).await
}

// ── adjust_points ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn adjust_points(
    state:   State<'_, AppState>,
    token:   String,
    payload: AdjustPointsDto,
) -> AppResult<LoyaltyTransaction> {
    let claims = guard_permission(&state, &token, "stores.manage").await?;
    let pool   = state.pool().await?;
    if payload.points == 0 {
        return Err(AppError::Validation("Adjustment must be non-zero".into()));
    }
    if payload.points < 0 {
        let balance = current_balance(&pool, payload.customer_id).await?;
        if balance < payload.points.abs() {
            return Err(AppError::Validation(format!(
                "Cannot subtract {} points — balance is only {balance}", payload.points.abs()
            )));
        }
    }
    record_points_tx(
        &pool, payload.customer_id, payload.store_id, None,
        "adjust", payload.points, payload.notes, claims.user_id,
    ).await
}

// ── get_loyalty_history ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_loyalty_history(
    state:       State<'_, AppState>,
    token:       String,
    customer_id: i32,
    limit:       Option<i64>,
) -> AppResult<Vec<LoyaltyTransaction>> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool  = state.pool().await?;
    let limit = limit.unwrap_or(50).clamp(1, 500);
    sqlx::query_as!(
        LoyaltyTransaction,
        r#"SELECT id, customer_id, store_id, transaction_id,
                  type, points, balance_after, notes, created_by, created_at
           FROM loyalty_transactions
           WHERE customer_id = $1
           ORDER BY created_at DESC
           LIMIT $2"#,
        customer_id, limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── get_loyalty_balance ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_loyalty_balance(
    state:       State<'_, AppState>,
    token:       String,
    customer_id: i32,
    store_id:    i32,
) -> AppResult<LoyaltyBalance> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool     = state.pool().await?;
    let points   = current_balance(&pool, customer_id).await?;
    let settings = fetch_settings(&pool, store_id).await?;
    let naira_value = Decimal::from(points) * settings.naira_per_point_redemption;
    Ok(LoyaltyBalance { customer_id, points, naira_value })
}

// ── expire_old_points ─────────────────────────────────────────────────────────

/// Expires points older than `expiry_days` for a store. Run nightly.
#[tauri::command]
pub async fn expire_old_points(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<serde_json::Value> {
    let claims = guard_permission(&state, &token, "stores.manage").await?;
    let pool   = state.pool().await?;

    let settings = fetch_settings(&pool, store_id).await?;
    if settings.expiry_days == 0 {
        return Ok(serde_json::json!({ "expired": 0, "message": "Point expiry is disabled (expiry_days=0)" }));
    }

    // Find all customers with points earned before expiry cutoff in this store
    let cutoff = chrono::Utc::now() - chrono::Duration::days(settings.expiry_days as i64);

    let customers = sqlx::query!(
        r#"SELECT DISTINCT customer_id
           FROM loyalty_transactions
           WHERE store_id    = $1
             AND type        = 'earn'
             AND created_at  < $2
           "#,
        store_id,
        cutoff,
    )
    .fetch_all(&pool)
    .await?;

    let mut expired_count = 0i64;

    for row in customers {
        let customer_id = row.customer_id;
        let balance = current_balance(&pool, customer_id).await?;
        if balance <= 0 { continue; }

        // Expire all current points
        record_points_tx(
            &pool, customer_id, store_id, None,
            "expire", -balance,
            Some(format!("Points expired after {} days", settings.expiry_days)),
            claims.user_id,
        )
        .await
        .ok(); // non-fatal per customer

        expired_count += 1;
    }

    Ok(serde_json::json!({
        "expired":        expired_count,
        "expiry_days":    settings.expiry_days,
        "cutoff_date":    cutoff.to_rfc3339(),
    }))
}

// ── helpers ───────────────────────────────────────────────────────────────────

pub(crate) async fn fetch_settings(pool: &sqlx::PgPool, store_id: i32) -> AppResult<LoyaltySettings> {
    sqlx::query_as!(
        LoyaltySettings,
        r#"SELECT store_id, points_per_naira, naira_per_point_redemption,
                  min_redemption_points, expiry_days, is_active, created_at, updated_at
           FROM loyalty_settings WHERE store_id = $1"#,
        store_id,
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Loyalty settings not found for store {store_id}")))
}

pub(crate) async fn current_balance(pool: &sqlx::PgPool, customer_id: i32) -> AppResult<i32> {
    let balance: Option<i32> = sqlx::query_scalar!(
        "SELECT loyalty_points FROM customers WHERE id = $1",
        customer_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(balance.unwrap_or(0))
}

pub(crate) async fn record_points_tx(
    pool:           &sqlx::PgPool,
    customer_id:    i32,
    store_id:       i32,
    transaction_id: Option<i32>,
    r#type:         &str,
    points:         i32,
    notes:          Option<String>,
    created_by:     i32,
) -> AppResult<LoyaltyTransaction> {
    let mut tx = pool.begin().await?;

    let current: i32 = sqlx::query_scalar!(
        "SELECT COALESCE(loyalty_points, 0) FROM customers WHERE id = $1 FOR UPDATE",
        customer_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .flatten()
    .unwrap_or(0);

    let balance_after = (current + points).max(0);

    sqlx::query!(
        "UPDATE customers SET loyalty_points = $1, updated_at = NOW() WHERE id = $2",
        balance_after, customer_id,
    )
    .execute(&mut *tx)
    .await?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO loyalty_transactions
               (customer_id, store_id, transaction_id, type, points, balance_after, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id"#,
        customer_id, store_id, transaction_id, r#type, points, balance_after, notes, created_by,
    )
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    sqlx::query_as!(
        LoyaltyTransaction,
        r#"SELECT id, customer_id, store_id, transaction_id,
                  type, points, balance_after, notes, created_by, created_at
           FROM loyalty_transactions WHERE id = $1"#,
        id,
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}
