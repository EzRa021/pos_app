// ============================================================================
// MULTI-CURRENCY / FX RATE SUPPORT
// ============================================================================
// NOTE: Uses query_unchecked! / query_as_unchecked! because migration 0048
// creates the exchange_rates table and may not be applied to the dev DB that
// sqlx checks against at compile time. The queries are still type-safe at
// runtime once the migration has been run.
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use chrono::Utc;
use crate::{
    error::{AppError, AppResult},
    models::fx_rates::{ExchangeRate, ConversionResult, SetRateDto, ConvertDto},
    state::AppState,
};
use super::auth::guard_permission;

// ── get_exchange_rate ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_exchange_rate(
    state:         State<'_, AppState>,
    token:         String,
    from_currency: String,
    to_currency:   String,
) -> AppResult<ExchangeRate> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool = state.pool().await?;
    sqlx::query_as_unchecked!(
        ExchangeRate,
        r#"SELECT id, from_currency, to_currency,
                  rate, effective_date, set_by, created_at
           FROM exchange_rates
           WHERE from_currency=$1 AND to_currency=$2
           ORDER BY effective_date DESC LIMIT 1"#,
        from_currency.to_uppercase(), to_currency.to_uppercase(),
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("No exchange rate found for {from_currency}/{to_currency}")))
}

// ── set_exchange_rate ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_exchange_rate(
    state:   State<'_, AppState>,
    token:   String,
    payload: SetRateDto,
) -> AppResult<ExchangeRate> {
    let claims = guard_permission(&state, &token, "stores.manage").await?;
    let pool   = state.pool().await?;

    if payload.rate <= 0.0 {
        return Err(AppError::Validation("Rate must be positive".into()));
    }

    let rate = Decimal::try_from(payload.rate).unwrap_or_default();
    let from = payload.from_currency.to_uppercase();
    let to   = payload.to_currency.to_uppercase();
    let effective_date = match payload.effective_date {
        Some(ref s) => s.parse::<chrono::NaiveDate>()
            .map_err(|_| AppError::Validation("Invalid effective_date (YYYY-MM-DD)".into()))?,
        None => Utc::now().date_naive(),
    };

    let id: i32 = sqlx::query_scalar_unchecked!(
        r#"INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date, set_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (from_currency, to_currency, effective_date)
           DO UPDATE SET rate=EXCLUDED.rate, set_by=EXCLUDED.set_by
           RETURNING id"#,
        from, to, rate, effective_date, claims.user_id,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as_unchecked!(
        ExchangeRate,
        r#"SELECT id, from_currency, to_currency,
                  rate, effective_date, set_by, created_at
           FROM exchange_rates WHERE id=$1"#,
        id,
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

// ── get_exchange_rate_history ─────────────────────────────────────────────────

#[tauri::command]
pub async fn get_exchange_rate_history(
    state:         State<'_, AppState>,
    token:         String,
    from_currency: String,
    to_currency:   String,
    limit:         Option<i64>,
) -> AppResult<Vec<ExchangeRate>> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool  = state.pool().await?;
    let limit = limit.unwrap_or(30).clamp(1, 365);
    sqlx::query_as_unchecked!(
        ExchangeRate,
        r#"SELECT id, from_currency, to_currency,
                  rate, effective_date, set_by, created_at
           FROM exchange_rates
           WHERE from_currency=$1 AND to_currency=$2
           ORDER BY effective_date DESC LIMIT $3"#,
        from_currency.to_uppercase(), to_currency.to_uppercase(), limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── convert_amount ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn convert_amount(
    state:   State<'_, AppState>,
    token:   String,
    payload: ConvertDto,
) -> AppResult<ConversionResult> {
    guard_permission(&state, &token, "stores.read").await?;
    let pool   = state.pool().await?;
    let amount = Decimal::try_from(payload.amount).unwrap_or_default();
    let from   = payload.from_currency.to_uppercase();
    let to     = payload.to_currency.to_uppercase();

    if from == to {
        return Ok(ConversionResult {
            from_currency: from.clone(), to_currency: to.clone(),
            original: amount, converted: amount,
            rate: Decimal::ONE, effective_date: Utc::now().date_naive(),
        });
    }

    let rate_row = sqlx::query_unchecked!(
        r#"SELECT rate, effective_date FROM exchange_rates
           WHERE from_currency=$1 AND to_currency=$2 ORDER BY effective_date DESC LIMIT 1"#,
        from, to,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("No rate for {from}/{to}")))?;

    let rate: Decimal = rate_row.rate;
    let effective_date: chrono::NaiveDate = rate_row.effective_date;

    Ok(ConversionResult {
        from_currency: from, to_currency: to,
        original: amount,
        converted: (amount * rate).round_dp(2),
        rate,
        effective_date,
    })
}
