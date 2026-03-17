// ============================================================================
// SHIFT COMMANDS
// ============================================================================
// Mirrors quantum-pos-app shift.service.js:
//   - shift_number generated as SH-YYYYMMDD-NNN
//   - open_shift  → checks for existing open/active/suspended shift
//   - close_shift → computes expected_cash from running totals, stores diff
//   - suspend_shift / resume_shift
//   - add_cash_movement → deposit / withdrawal / payout
//   - get_cash_movements, get_shift_summary, reconcile_shift
//   - Non-global users are scoped to their own shifts automatically
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use chrono::Utc;
use crate::{
    error::{AppError, AppResult},
    models::shift::{
        Shift, CashMovement, ShiftSummary, ShiftDetailStats,
        OpenShiftDto, CloseShiftDto, SuspendShiftDto, CreateCashMovementDto,
        ShiftFilters,
    },
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard;

// ── helpers ───────────────────────────────────────────────────────────────────

fn to_dec(v: f64) -> AppResult<Decimal> {
    Decimal::try_from(v).map_err(|_| AppError::Validation("Invalid decimal value".into()))
}

async fn fetch_shift(pool: &sqlx::PgPool, id: i32) -> AppResult<Shift> {
    sqlx::query_as!(
        Shift,
        r#"SELECT
            s.id, s.shift_number, s.store_id, s.terminal_id,
            s.opened_by,
            CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
            s.opening_float, s.actual_cash, s.expected_cash, s.cash_difference,
            s.total_sales, s.total_cash_sales, s.total_card_sales,
            s.total_transfers, s.total_mobile_sales, s.transaction_count,
            s.total_cash_in, s.total_cash_out,
            s.total_returns, s.return_count,
            s.reconciled, s.reconciled_by, s.reconciled_at, s.discrepancy_notes,
            s.opening_notes, s.closing_notes,
            s.status, s.opened_at, s.closed_at, s.closed_by
           FROM shifts s
           JOIN users u ON u.id = s.opened_by
           WHERE s.id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Shift {id} not found")))
}

/// Generate SH-YYYYMMDD-NNN (matches quantum-pos-app generateShiftNumber)
async fn generate_shift_number(pool: &sqlx::PgPool) -> AppResult<String> {
    let today = Utc::now().format("%Y%m%d").to_string();
    let pattern = format!("SH-{}-{}", today, "%");

    // Latest shift number for today (or None if none yet)
    let last: Option<String> = sqlx::query_scalar!(
        "SELECT shift_number FROM shifts WHERE shift_number LIKE $1 ORDER BY id DESC LIMIT 1",
        pattern
    )
    .fetch_optional(pool)
    .await?;

    let next_num = last
        .as_deref()
        .and_then(|s| s.split('-').last())
        .and_then(|n| n.parse::<i32>().ok())
        .unwrap_or(0)
        + 1;

    Ok(format!("SH-{}-{:03}", today, next_num))
}

/// Generate CM-YYYYMMDD-NNNN (matches quantum-pos-app generateMovementNumber)
async fn generate_movement_number(pool: &sqlx::PgPool) -> AppResult<String> {
    let today = Utc::now().format("%Y%m%d").to_string();
    let pattern = format!("CM-{}-{}", today, "%");

    // Latest cash movement number for today (or None if none yet)
    let last: Option<String> = sqlx::query_scalar!(
        "SELECT movement_number FROM cash_movements WHERE movement_number LIKE $1 ORDER BY id DESC LIMIT 1",
        pattern
    )
    .fetch_optional(pool)
    .await?
    .flatten();

    let next_num = last
        .as_deref()
        .and_then(|s| s.split('-').last())
        .and_then(|n| n.parse::<i32>().ok())
        .unwrap_or(0)
        + 1;

    Ok(format!("CM-{}-{:04}", today, next_num))
}

// ── open_shift ────────────────────────────────────────────────────────────────

pub(crate) async fn open_shift_inner(
    state:   &AppState,
    token:   String,
    payload: OpenShiftDto,
) -> AppResult<Shift> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    // Check for existing open/active/suspended shift for this user in this store
    let active: Option<i32> = sqlx::query_scalar!(
        "SELECT id FROM shifts
         WHERE opened_by = $1 AND store_id = $2
           AND status IN ('open', 'active', 'suspended')
         LIMIT 1",
        claims.user_id,
        payload.store_id,
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(existing_id) = active {
        let existing = fetch_shift(&pool, existing_id).await?;
        return Err(AppError::Conflict(format!(
            "You already have an active shift ({}). Please close it first.",
            existing.shift_number
        )));
    }

    let shift_number = generate_shift_number(&pool).await?;
    let float        = to_dec(payload.opening_float)?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO shifts (
            shift_number, store_id, terminal_id, opened_by,
            opening_float, expected_cash, opening_notes, status
           ) VALUES ($1, $2, $3, $4, $5, $5, $6, 'open')
           RETURNING id"#,
        shift_number,
        payload.store_id,
        payload.terminal_id,
        claims.user_id,
        float,
        payload.opening_notes,
    )
    .fetch_one(&pool)
    .await?;

    // Log cash drawer event
    sqlx::query!(
        r#"INSERT INTO cash_drawer_events (shift_id, event_type, user_id, amount, notes)
           VALUES ($1, 'shift_opened', $2, $3, $4)"#,
        id,
        claims.user_id,
        float,
        format!("Shift opened with ₦{} opening float", float),
    )
    .execute(&pool)
    .await
    .ok(); // non-fatal

    fetch_shift(&pool, id).await
}

#[tauri::command]
pub async fn open_shift(
    state:   State<'_, AppState>,
    token:   String,
    payload: OpenShiftDto,
) -> AppResult<Shift> {
    open_shift_inner(&state, token, payload).await
}

// ── close_shift ───────────────────────────────────────────────────────────────

pub(crate) async fn close_shift_inner(
    state:   &AppState,
    token:   String,
    id:      i32,
    payload: CloseShiftDto,
) -> AppResult<Shift> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    let shift = fetch_shift(&pool, id).await?;

    if shift.status == "closed" {
        return Err(AppError::Validation("Shift is already closed".into()));
    }
    if shift.opened_by != claims.user_id && !claims.is_global {
        return Err(AppError::Forbidden);
    }

    let actual = to_dec(payload.actual_cash)?;

    // Compute expected cash from running totals (mirrors quantum-pos-app closeShift)
    let zero = Decimal::ZERO;
    let expected = shift.opening_float
        + shift.total_cash_sales.unwrap_or(zero)
        + shift.total_cash_in.unwrap_or(zero)
        - shift.total_cash_out.unwrap_or(zero)
        - shift.total_returns.unwrap_or(zero);

    let difference = actual - expected;

    sqlx::query!(
        r#"UPDATE shifts SET
            status          = 'closed',
            actual_cash     = $1,
            expected_cash   = $2,
            cash_difference = $3,
            closing_notes   = $4,
            closed_by       = $5,
            closed_at       = NOW()
           WHERE id = $6"#,
        actual,
        expected,
        difference,
        payload.closing_notes,
        claims.user_id,
        id,
    )
    .execute(&pool)
    .await?;

    // Log event
    sqlx::query!(
        r#"INSERT INTO cash_drawer_events (shift_id, event_type, user_id, amount, notes)
           VALUES ($1, 'shift_closed', $2, $3, $4)"#,
        id,
        claims.user_id,
        actual,
        format!(
            "Shift closed. Expected: ₦{}, Actual: ₦{}, Difference: ₦{}",
            expected.round_dp(2), actual, difference.round_dp(2)
        ),
    )
    .execute(&pool)
    .await
    .ok(); // non-fatal

    fetch_shift(&pool, id).await
}

#[tauri::command]
pub async fn close_shift(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: CloseShiftDto,
) -> AppResult<Shift> {
    close_shift_inner(&state, token, id, payload).await
}

// ── suspend_shift ─────────────────────────────────────────────────────────────

pub(crate) async fn suspend_shift_inner(
    state:   &AppState,
    token:   String,
    id:      i32,
    payload: SuspendShiftDto,
) -> AppResult<Shift> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    let shift = fetch_shift(&pool, id).await?;

    if shift.opened_by != claims.user_id && !claims.is_global {
        return Err(AppError::Forbidden);
    }

    let updated = sqlx::query_scalar!(
        "UPDATE shifts SET status = 'suspended', updated_at = NOW()
         WHERE id = $1 AND status IN ('open', 'active')
         RETURNING id",
        id,
    )
    .fetch_optional(&pool)
    .await?;

    if updated.is_none() {
        return Err(AppError::Validation("Shift not found or cannot be suspended".into()));
    }

    sqlx::query!(
        r#"INSERT INTO cash_drawer_events (shift_id, event_type, user_id, notes)
           VALUES ($1, 'shift_suspended', $2, $3)"#,
        id,
        claims.user_id,
        payload.reason.as_deref().unwrap_or("Shift suspended"),
    )
    .execute(&pool)
    .await
    .ok();

    fetch_shift(&pool, id).await
}

#[tauri::command]
pub async fn suspend_shift(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: SuspendShiftDto,
) -> AppResult<Shift> {
    suspend_shift_inner(&state, token, id, payload).await
}

// ── resume_shift ──────────────────────────────────────────────────────────────

pub(crate) async fn resume_shift_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Shift> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    let shift = fetch_shift(&pool, id).await?;

    if shift.opened_by != claims.user_id && !claims.is_global {
        return Err(AppError::Forbidden);
    }

    let updated = sqlx::query_scalar!(
        "UPDATE shifts SET status = 'active', updated_at = NOW()
         WHERE id = $1 AND status = 'suspended'
         RETURNING id",
        id,
    )
    .fetch_optional(&pool)
    .await?;

    if updated.is_none() {
        return Err(AppError::Validation("Shift not found or not suspended".into()));
    }

    sqlx::query!(
        r#"INSERT INTO cash_drawer_events (shift_id, event_type, user_id, notes)
           VALUES ($1, 'shift_resumed', $2, 'Shift resumed')"#,
        id,
        claims.user_id,
    )
    .execute(&pool)
    .await
    .ok();

    fetch_shift(&pool, id).await
}

#[tauri::command]
pub async fn resume_shift(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Shift> {
    resume_shift_inner(&state, token, id).await
}

// ── get_active_shift ──────────────────────────────────────────────────────────

pub(crate) async fn get_active_shift_inner(
    state:    &AppState,
    token:    String,
    store_id: i32,
) -> AppResult<Option<Shift>> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    let result = sqlx::query_as!(
        Shift,
        r#"SELECT
            s.id, s.shift_number, s.store_id, s.terminal_id,
            s.opened_by,
            CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
            s.opening_float, s.actual_cash, s.expected_cash, s.cash_difference,
            s.total_sales, s.total_cash_sales, s.total_card_sales,
            s.total_transfers, s.total_mobile_sales, s.transaction_count,
            s.total_cash_in, s.total_cash_out,
            s.total_returns, s.return_count,
            s.reconciled, s.reconciled_by, s.reconciled_at, s.discrepancy_notes,
            s.opening_notes, s.closing_notes,
            s.status, s.opened_at, s.closed_at, s.closed_by
           FROM shifts s
           JOIN users u ON u.id = s.opened_by
           WHERE s.opened_by = $1
             AND s.store_id  = $2
             AND s.status IN ('open', 'active', 'suspended')
           ORDER BY s.opened_at DESC
           LIMIT 1"#,
        claims.user_id,
        store_id,
    )
    .fetch_optional(&pool)
    .await?;

    Ok(result)
}

#[tauri::command]
pub async fn get_active_shift(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Option<Shift>> {
    get_active_shift_inner(&state, token, store_id).await
}

// ── get_shifts ────────────────────────────────────────────────────────────────

pub(crate) async fn get_shifts_inner(
    state:   &AppState,
    token:   String,
    filters: ShiftFilters,
) -> AppResult<PagedResult<Shift>> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    // Cashiers are always scoped to their own shifts
    let effective_cashier: Option<i32> = if !claims.is_global {
        Some(claims.user_id)
    } else {
        filters.cashier_id
    };

    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;
    let df     = filters.date_from.as_deref();
    let dt     = filters.date_to.as_deref();

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM shifts
           WHERE ($1::int  IS NULL OR store_id   = $1)
             AND ($2::int  IS NULL OR opened_by  = $2)
             AND ($3::text IS NULL OR status     = $3)
             AND ($4::text IS NULL OR opened_at >= $4::timestamptz)
             AND ($5::text IS NULL OR opened_at <= $5::timestamptz)"#,
        filters.store_id,
        effective_cashier,
        filters.status,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let shifts = sqlx::query_as!(
        Shift,
        r#"SELECT
            s.id, s.shift_number, s.store_id, s.terminal_id,
            s.opened_by,
            CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
            s.opening_float, s.actual_cash, s.expected_cash, s.cash_difference,
            s.total_sales, s.total_cash_sales, s.total_card_sales,
            s.total_transfers, s.total_mobile_sales, s.transaction_count,
            s.total_cash_in, s.total_cash_out,
            s.total_returns, s.return_count,
            s.reconciled, s.reconciled_by, s.reconciled_at, s.discrepancy_notes,
            s.opening_notes, s.closing_notes,
            s.status, s.opened_at, s.closed_at, s.closed_by
           FROM shifts s
           JOIN users u ON u.id = s.opened_by
           WHERE ($1::int  IS NULL OR s.store_id   = $1)
             AND ($2::int  IS NULL OR s.opened_by  = $2)
             AND ($3::text IS NULL OR s.status     = $3)
             AND ($4::text IS NULL OR s.opened_at >= $4::timestamptz)
             AND ($5::text IS NULL OR s.opened_at <= $5::timestamptz)
           ORDER BY s.opened_at DESC
           LIMIT $6 OFFSET $7"#,
        filters.store_id,
        effective_cashier,
        filters.status,
        df,
        dt,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(shifts, total, page, limit))
}

#[tauri::command]
pub async fn get_shifts(
    state:   State<'_, AppState>,
    token:   String,
    filters: ShiftFilters,
) -> AppResult<PagedResult<Shift>> {
    get_shifts_inner(&state, token, filters).await
}

// ── get_shift ─────────────────────────────────────────────────────────────────

pub(crate) async fn get_shift_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Shift> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;
    let shift  = fetch_shift(&pool, id).await?;

    if shift.opened_by != claims.user_id && !claims.is_global {
        return Err(AppError::Forbidden);
    }

    Ok(shift)
}

#[tauri::command]
pub async fn get_shift(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Shift> {
    get_shift_inner(&state, token, id).await
}

// ── add_cash_movement ─────────────────────────────────────────────────────────
// deposit    → adds cash to drawer  → increments total_cash_in
// withdrawal → removes cash         → increments total_cash_out
// payout     → expense from drawer  → increments total_cash_out

pub(crate) async fn add_cash_movement_inner(
    state:   &AppState,
    token:   String,
    payload: CreateCashMovementDto,
) -> AppResult<CashMovement> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    if !["deposit", "withdrawal", "payout"].contains(&payload.movement_type.as_str()) {
        return Err(AppError::Validation(
            "movement_type must be deposit, withdrawal, or payout".into(),
        ));
    }

    let amount = to_dec(payload.amount)?;
    if amount <= Decimal::ZERO {
        return Err(AppError::Validation("Amount must be greater than zero".into()));
    }

    // Verify shift is active
    let shift = fetch_shift(&pool, payload.shift_id).await?;
    if !["open", "active", "suspended"].contains(&shift.status.as_str()) {
        return Err(AppError::Validation("Shift is not open".into()));
    }
    if shift.opened_by != claims.user_id && !claims.is_global {
        return Err(AppError::Forbidden);
    }

    let movement_number = generate_movement_number(&pool).await?;

    let mut db_tx = pool.begin().await?;

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO cash_movements
            (shift_id, movement_number, movement_type, amount,
             reason, reference_number, performed_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id"#,
        payload.shift_id,
        movement_number,
        payload.movement_type,
        amount,
        payload.reason,
        payload.reference_number,
        claims.user_id,
    )
    .fetch_one(&mut *db_tx)
    .await?;

    // Update shift totals — deposit goes into total_cash_in, rest into total_cash_out
    if payload.movement_type == "deposit" {
        sqlx::query!(
            "UPDATE shifts SET total_cash_in  = COALESCE(total_cash_in,  0) + $1,
                               updated_at     = NOW()
             WHERE id = $2",
            amount, payload.shift_id,
        )
        .execute(&mut *db_tx)
        .await?;
    } else {
        sqlx::query!(
            "UPDATE shifts SET total_cash_out = COALESCE(total_cash_out, 0) + $1,
                               updated_at     = NOW()
             WHERE id = $2",
            amount, payload.shift_id,
        )
        .execute(&mut *db_tx)
        .await?;
    }

    // Log cash drawer event
    let event_type = match payload.movement_type.as_str() {
        "deposit"    => "cash_added",
        "withdrawal" => "cash_removed",
        _            => "payout",
    };

    sqlx::query!(
        r#"INSERT INTO cash_drawer_events (shift_id, event_type, user_id, amount, notes)
           VALUES ($1, $2, $3, $4, $5)"#,
        payload.shift_id,
        event_type,
        claims.user_id,
        amount,
        payload.reason,
    )
    .execute(&mut *db_tx)
    .await
    .ok();

    db_tx.commit().await?;

    sqlx::query_as!(
        CashMovement,
        "SELECT id, shift_id, movement_number, movement_type, amount,
                reason, reference_number, performed_by, created_at
         FROM cash_movements WHERE id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn add_cash_movement(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateCashMovementDto,
) -> AppResult<CashMovement> {
    add_cash_movement_inner(&state, token, payload).await
}

// ── get_cash_movements ────────────────────────────────────────────────────────

pub(crate) async fn get_cash_movements_inner(
    state:    &AppState,
    token:    String,
    shift_id: i32,
) -> AppResult<Vec<CashMovement>> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    let shift = fetch_shift(&pool, shift_id).await?;
    if shift.opened_by != claims.user_id && !claims.is_global {
        return Err(AppError::Forbidden);
    }

    sqlx::query_as!(
        CashMovement,
        "SELECT id, shift_id, movement_number, movement_type, amount,
                reason, reference_number, performed_by, created_at
         FROM cash_movements
         WHERE shift_id = $1
         ORDER BY created_at DESC",
        shift_id
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_cash_movements(
    state:    State<'_, AppState>,
    token:    String,
    shift_id: i32,
) -> AppResult<Vec<CashMovement>> {
    get_cash_movements_inner(&state, token, shift_id).await
}

// ── get_shift_summary ─────────────────────────────────────────────────────────

pub(crate) async fn get_shift_summary_inner(
    state:    &AppState,
    token:    String,
    shift_id: i32,
) -> AppResult<ShiftSummary> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    let shift = fetch_shift(&pool, shift_id).await?;
    if shift.opened_by != claims.user_id && !claims.is_global {
        return Err(AppError::Forbidden);
    }

    // Aggregate cash movements by type
    let row = sqlx::query!(
        r#"SELECT
            COALESCE(SUM(CASE WHEN movement_type = 'deposit'    THEN amount ELSE 0 END), 0) AS "deposits!: Decimal",
            COALESCE(SUM(CASE WHEN movement_type = 'withdrawal' THEN amount ELSE 0 END), 0) AS "withdrawals!: Decimal",
            COALESCE(SUM(CASE WHEN movement_type = 'payout'     THEN amount ELSE 0 END), 0) AS "payouts!: Decimal"
           FROM cash_movements
           WHERE shift_id = $1"#,
        shift_id
    )
    .fetch_one(&pool)
    .await?;

    let zero           = Decimal::ZERO;
    let opening_float  = shift.opening_float;
    let total_sales    = shift.total_sales.unwrap_or(zero);
    let total_cash_sales = shift.total_cash_sales.unwrap_or(zero);
    let total_returns  = shift.total_returns.unwrap_or(zero);
    let total_deposits = row.deposits;
    let total_withdrawals = row.withdrawals;
    let total_payouts  = row.payouts;

    // expected = opening_float + cash_sales + deposits - withdrawals - payouts - returns
    let expected_balance = opening_float
        + total_cash_sales
        + total_deposits
        - total_withdrawals
        - total_payouts
        - total_returns;

    Ok(ShiftSummary {
        shift_id: shift_id,
        opening_float,
        total_sales,
        total_returns,
        total_deposits,
        total_withdrawals,
        total_payouts,
        expected_balance,
    })
}

#[tauri::command]
pub async fn get_shift_summary(
    state:    State<'_, AppState>,
    token:    String,
    shift_id: i32,
) -> AppResult<ShiftSummary> {
    get_shift_summary_inner(&state, token, shift_id).await
}

// ── get_store_active_shifts ─────────────────────────────────────────────────
// Returns all currently active (open/active/suspended) shifts for a store.
// Global users see ALL cashiers' shifts.
// Non-global users see only their own shift (same as get_active_shift but as Vec).

pub(crate) async fn get_store_active_shifts_inner(
    state:    &AppState,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<Shift>> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    if claims.is_global {
        // Superadmin / manager — see every active shift in this store
        let shifts = sqlx::query_as!(
            Shift,
            r#"SELECT
                s.id, s.shift_number, s.store_id, s.terminal_id,
                s.opened_by,
                CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                s.opening_float, s.actual_cash, s.expected_cash, s.cash_difference,
                s.total_sales, s.total_cash_sales, s.total_card_sales,
                s.total_transfers, s.total_mobile_sales, s.transaction_count,
                s.total_cash_in, s.total_cash_out,
                s.total_returns, s.return_count,
                s.reconciled, s.reconciled_by, s.reconciled_at, s.discrepancy_notes,
                s.opening_notes, s.closing_notes,
                s.status, s.opened_at, s.closed_at, s.closed_by
               FROM shifts s
               JOIN users u ON u.id = s.opened_by
               WHERE s.store_id = $1
                 AND s.status IN ('open', 'active', 'suspended')
               ORDER BY s.opened_at ASC"#,
            store_id,
        )
        .fetch_all(&pool)
        .await?;
        Ok(shifts)
    } else {
        // Regular cashier — only their own shift (same scoping as get_active_shift)
        let shift = sqlx::query_as!(
            Shift,
            r#"SELECT
                s.id, s.shift_number, s.store_id, s.terminal_id,
                s.opened_by,
                CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                s.opening_float, s.actual_cash, s.expected_cash, s.cash_difference,
                s.total_sales, s.total_cash_sales, s.total_card_sales,
                s.total_transfers, s.total_mobile_sales, s.transaction_count,
                s.total_cash_in, s.total_cash_out,
                s.total_returns, s.return_count,
                s.reconciled, s.reconciled_by, s.reconciled_at, s.discrepancy_notes,
                s.opening_notes, s.closing_notes,
                s.status, s.opened_at, s.closed_at, s.closed_by
               FROM shifts s
               JOIN users u ON u.id = s.opened_by
               WHERE s.opened_by = $1
                 AND s.store_id  = $2
                 AND s.status IN ('open', 'active', 'suspended')
               ORDER BY s.opened_at DESC
               LIMIT 1"#,
            claims.user_id,
            store_id,
        )
        .fetch_optional(&pool)
        .await?;
        Ok(shift.into_iter().collect())
    }
}

#[tauri::command]
pub async fn get_store_active_shifts(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<Shift>> {
    get_store_active_shifts_inner(&state, token, store_id).await
}

// ── cancel_shift ──────────────────────────────────────────────────────────────
// Only global users (super_admin / global admin) may cancel a shift, and only
// if they themselves opened it. Useful when an admin accidentally opens a shift
// and wants to discard it without going through the full close-out process.

pub(crate) async fn cancel_shift_inner(
    state: &AppState,
    token: String,
    id:    i32,
) -> AppResult<Shift> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    // Only global (super_admin / global-role) users have this privilege
    if !claims.is_global {
        return Err(AppError::Forbidden);
    }

    let shift = fetch_shift(&pool, id).await?;

    // Must be their own shift
    if shift.opened_by != claims.user_id {
        return Err(AppError::Validation(
            "You can only cancel a shift that you opened.".into(),
        ));
    }

    if shift.status == "closed" || shift.status == "cancelled" {
        return Err(AppError::Validation(
            format!("Shift is already {}.", shift.status),
        ));
    }

    let updated = sqlx::query_scalar!(
        r#"UPDATE shifts
           SET status     = 'cancelled',
               closed_by  = $1,
               closed_at  = NOW(),
               updated_at = NOW()
           WHERE id = $2
             AND status IN ('open', 'active', 'suspended')
           RETURNING id"#,
        claims.user_id,
        id,
    )
    .fetch_optional(&pool)
    .await?;

    if updated.is_none() {
        return Err(AppError::Validation("Shift could not be cancelled.".into()));
    }

    sqlx::query!(
        r#"INSERT INTO cash_drawer_events (shift_id, event_type, user_id, notes)
           VALUES ($1, 'shift_cancelled', $2, 'Shift cancelled by admin')"#,
        id,
        claims.user_id,
    )
    .execute(&pool)
    .await
    .ok(); // non-fatal

    fetch_shift(&pool, id).await
}

#[tauri::command]
pub async fn cancel_shift(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Shift> {
    cancel_shift_inner(&state, token, id).await
}

// ── reconcile_shift ───────────────────────────────────────────────────────────

pub(crate) async fn reconcile_shift_inner(
    state:    &AppState,
    token:    String,
    id:       i32,
    notes:    Option<String>,
) -> AppResult<Shift> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    let updated = sqlx::query_scalar!(
        r#"UPDATE shifts SET
            reconciled         = true,
            reconciled_by      = $1,
            reconciled_at      = NOW(),
            discrepancy_notes  = $2,
            updated_at         = NOW()
           WHERE id = $3
           RETURNING id"#,
        claims.user_id,
        notes,
        id,
    )
    .fetch_optional(&pool)
    .await?;

    if updated.is_none() {
        return Err(AppError::NotFound(format!("Shift {id} not found")));
    }

    sqlx::query!(
        r#"INSERT INTO cash_drawer_events (shift_id, event_type, user_id, notes)
           VALUES ($1, 'reconciled', $2, $3)"#,
        id,
        claims.user_id,
        notes.as_deref().unwrap_or("Shift reconciled"),
    )
    .execute(&pool)
    .await
    .ok();

    fetch_shift(&pool, id).await
}

#[tauri::command]
pub async fn reconcile_shift(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
    notes: Option<String>,
) -> AppResult<Shift> {
    reconcile_shift_inner(&state, token, id, notes).await
}

// ── get_shift_detail_stats ────────────────────────────────────────────────────────────────────────
// Returns derived stats for the shift detail page that are NOT stored on the
// shifts row itself: total_items_sold, top item, unique customers, credit sales.

pub(crate) async fn get_shift_detail_stats_inner(
    state:    &AppState,
    token:    String,
    shift_id: i32,
) -> AppResult<ShiftDetailStats> {
    let claims = guard(state, &token).await?;
    let pool   = state.pool().await?;

    let shift = fetch_shift(&pool, shift_id).await?;
    if shift.opened_by != claims.user_id && !claims.is_global {
        return Err(AppError::Forbidden);
    }

    // Time window for this shift
    let opened_at = shift.opened_at;
    let closed_at = shift.closed_at.unwrap_or_else(Utc::now);

    // ── Aggregate stats from completed transactions ──────────────────────
    let agg = sqlx::query!(
        r#"SELECT
            COALESCE(SUM(ti.quantity), 0)                                        AS "total_items_sold!: rust_decimal::Decimal",
            COUNT(DISTINCT t.customer_id) FILTER (WHERE t.customer_id IS NOT NULL) AS "unique_customers!: i64",
            COUNT(*) FILTER (WHERE t.payment_method = 'credit')                  AS "credit_sales_count!: i64",
            COALESCE(SUM(t.total_amount) FILTER (WHERE t.payment_method = 'credit'), 0) AS "credit_sales_amount!: rust_decimal::Decimal"
           FROM transactions t
           LEFT JOIN transaction_items ti ON ti.tx_id = t.id
           WHERE t.cashier_id = $1
             AND t.store_id   = $2
             AND t.created_at >= $3
             AND t.created_at <= $4
             AND t.status     = 'completed'"#,
        shift.opened_by,
        shift.store_id,
        opened_at,
        closed_at,
    )
    .fetch_one(&pool)
    .await?;

    // ── Top item by quantity sold ─────────────────────────────────────────────
    let top = sqlx::query!(
        r#"SELECT ti.item_name, SUM(ti.quantity) AS "total_qty!: rust_decimal::Decimal"
           FROM transaction_items ti
           JOIN transactions t ON t.id = ti.tx_id
           WHERE t.cashier_id = $1
             AND t.store_id   = $2
             AND t.created_at >= $3
             AND t.created_at <= $4
             AND t.status     = 'completed'
           GROUP BY ti.item_name
           ORDER BY "total_qty!: rust_decimal::Decimal" DESC
           LIMIT 1"#,
        shift.opened_by,
        shift.store_id,
        opened_at,
        closed_at,
    )
    .fetch_optional(&pool)
    .await?;

    // Returns are already tracked on the Shift row — reuse those fields
    let return_count         = shift.return_count.unwrap_or(0);
    let total_returns_amount = shift.total_returns.unwrap_or(rust_decimal::Decimal::ZERO);

    let total_items_sold = agg.total_items_sold
        .to_string()
        .parse::<f64>()
        .unwrap_or(0.0);

    let (top_item_name, top_item_qty) = match top {
        Some(row) => {
            let qty = row.total_qty.to_string().parse::<f64>().unwrap_or(0.0);
            (Some(row.item_name), qty)
        }
        None => (None, 0.0),
    };

    Ok(ShiftDetailStats {
        shift_id,
        total_items_sold,
        unique_customers:    agg.unique_customers,
        credit_sales_count:  agg.credit_sales_count,
        credit_sales_amount: agg.credit_sales_amount,
        top_item_name,
        top_item_qty,
        return_count,
        total_returns_amount,
    })
}

#[tauri::command]
pub async fn get_shift_detail_stats(
    state:    State<'_, AppState>,
    token:    String,
    shift_id: i32,
) -> AppResult<ShiftDetailStats> {
    get_shift_detail_stats_inner(&state, token, shift_id).await
}
