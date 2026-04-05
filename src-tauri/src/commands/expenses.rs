// ============================================================================
// EXPENSE COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use serde::Serialize;
use crate::{
    error::{AppError, AppResult},
    models::expense::{Expense, CreateExpenseDto, UpdateExpenseDto, ExpenseFilters},
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::{guard, guard_permission};
use super::audit::write_audit_log;

// ── Shared fetch ─────────────────────────────────────────────────────────────

async fn fetch_expense(pool: &sqlx::PgPool, id: i32) -> AppResult<Expense> {
    sqlx::query_as!(
        Expense,
        r#"SELECT id, store_id, category, expense_type, description, amount, paid_to,
                  payment_method, reference, reference_number, reference_type, reference_id,
                  expense_date, recorded_by, approved_by, approved_at,
                  status, approval_status, payment_status,
                  is_recurring, is_deductible, notes, deleted_at, created_at, updated_at
           FROM   expenses WHERE id = $1 AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Expense {id} not found")))
}

// ── List ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_expenses(
    state:   State<'_, AppState>,
    token:   String,
    filters: ExpenseFilters,
) -> AppResult<PagedResult<Expense>> {
    guard_permission(&state, &token, "expenses.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;
    let df     = filters.date_from.as_deref();
    let dt     = filters.date_to.as_deref();

    let search = filters.search.as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM expenses
           WHERE deleted_at IS NULL
             AND ($1::int  IS NULL OR store_id        = $1)
             AND ($2::text IS NULL OR expense_type    = $2)
             AND ($3::text IS NULL OR approval_status = $3)
             AND ($4::text IS NULL OR payment_status  = $4)
             AND ($5::text IS NULL OR expense_date >= $5::timestamptz)
             AND ($6::text IS NULL OR expense_date <= $6::timestamptz)
             AND ($7::text IS NULL OR (
                   description ILIKE $7
                OR paid_to     ILIKE $7
                OR category    ILIKE $7
             ))"#,
        filters.store_id,
        filters.expense_type,
        filters.approval_status,
        filters.payment_status,
        df,
        dt,
        search.as_deref(),
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let expenses = sqlx::query_as!(
        Expense,
        r#"SELECT id, store_id, category, expense_type, description, amount, paid_to,
                  payment_method, reference, reference_number, reference_type, reference_id,
                  expense_date, recorded_by, approved_by, approved_at,
                  status, approval_status, payment_status,
                  is_recurring, is_deductible, notes, deleted_at, created_at, updated_at
           FROM   expenses
           WHERE deleted_at IS NULL
             AND ($1::int  IS NULL OR store_id        = $1)
             AND ($2::text IS NULL OR expense_type    = $2)
             AND ($3::text IS NULL OR approval_status = $3)
             AND ($4::text IS NULL OR payment_status  = $4)
             AND ($5::text IS NULL OR expense_date >= $5::timestamptz)
             AND ($6::text IS NULL OR expense_date <= $6::timestamptz)
             AND ($7::text IS NULL OR (
                   description ILIKE $7
                OR paid_to     ILIKE $7
                OR category    ILIKE $7
             ))
           ORDER  BY expense_date DESC, created_at DESC
           LIMIT $8 OFFSET $9"#,
        filters.store_id,
        filters.expense_type,
        filters.approval_status,
        filters.payment_status,
        df,
        dt,
        search.as_deref(),
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(expenses, total, page, limit))
}

// ── Single ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_expense(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Expense> {
    guard_permission(&state, &token, "expenses.read").await?;
    let pool = state.pool().await?;
    fetch_expense(&pool, id).await
}

// ── Create ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_expense(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateExpenseDto,
) -> AppResult<Expense> {
    let claims = guard(&state, &token).await?;
    guard_permission(&state, &token, "expenses.create").await?;
    let pool   = state.pool().await?;
    let amount = Decimal::try_from(payload.amount)
        .map_err(|_| AppError::Validation("Invalid amount".into()))?;

    // Auto-approve only for users with expenses.approve permission (managers/admins).
    // Cashiers and other roles create expenses as 'pending' for approval.
    let can_approve     = guard_permission(&state, &token, "expenses.approve").await.is_ok();
    let approval_status = if can_approve { "approved" } else { "pending" };
    let approved_by     = if approval_status == "approved" { Some(claims.user_id) } else { None };

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO expenses
               (store_id, category, expense_type, description, amount, paid_to,
                payment_method, reference, reference_number, reference_type, reference_id,
                expense_date, recorded_by, approved_by, approved_at,
                approval_status, payment_status, is_recurring, is_deductible, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                   COALESCE($12::text::timestamptz, NOW()),
                   $13,$14,
                   CASE WHEN $15 = 'approved' THEN NOW() ELSE NULL END,
                   $15,$16,$17,$18,$19)
           RETURNING id"#,
        payload.store_id,
        payload.category,
        payload.expense_type,
        payload.description,
        amount,
        payload.paid_to,
        payload.payment_method,
        payload.reference,
        payload.reference_number,
        payload.reference_type,
        payload.reference_id,
        payload.expense_date.as_deref(),
        claims.user_id,
        approved_by,
        approval_status,
        payload.payment_status.as_deref().unwrap_or("paid"),
        payload.is_recurring.unwrap_or(false),
        payload.is_deductible.unwrap_or(true),
        payload.notes,
    )
    .fetch_one(&pool)
    .await?;

    let expense = fetch_expense(&pool, id).await?;

    crate::database::sync::queue_row(
        &pool, "expenses", "INSERT", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": payload.store_id,
                            "description": payload.description, "amount": amount,
                            "category": payload.category }),
        Some(payload.store_id),
    ).await;

    write_audit_log(&pool, claims.user_id, Some(payload.store_id), "create", "expense",
        &format!("Expense ₦{} — {}", amount, payload.description), "info").await;
    Ok(expense)
}

// ── Update ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_expense(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateExpenseDto,
) -> AppResult<Expense> {
    guard_permission(&state, &token, "expenses.update").await?;
    let pool   = state.pool().await?;
    let _existing = fetch_expense(&pool, id).await?; // ensure exists

    let amount = payload.amount
        .map(|v| Decimal::try_from(v).map_err(|_| AppError::Validation("Invalid amount".into())))
        .transpose()?;

    sqlx::query!(
        r#"UPDATE expenses SET
           category         = COALESCE($1,  category),
           expense_type     = COALESCE($2,  expense_type),
           description      = COALESCE($3,  description),
           amount           = COALESCE($4,  amount),
           paid_to          = COALESCE($5,  paid_to),
           payment_method   = COALESCE($6,  payment_method),
           reference        = COALESCE($7,  reference),
           reference_number = COALESCE($8,  reference_number),
           expense_date     = COALESCE($9::text::timestamptz, expense_date),
           payment_status   = COALESCE($10, payment_status),
           is_recurring     = COALESCE($11, is_recurring),
           is_deductible    = COALESCE($12, is_deductible),
           notes            = COALESCE($13, notes),
           updated_at       = NOW()
           WHERE id = $14 AND deleted_at IS NULL"#,
        payload.category,
        payload.expense_type,
        payload.description,
        amount,
        payload.paid_to,
        payload.payment_method,
        payload.reference,
        payload.reference_number,
        payload.expense_date.as_deref(),
        payload.payment_status,
        payload.is_recurring,
        payload.is_deductible,
        payload.notes,
        id,
    )
    .execute(&pool)
    .await?;

    fetch_expense(&pool, id).await
}

// ── Approve ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn approve_expense(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Expense> {
    let claims = guard_permission(&state, &token, "expenses.approve").await?;
    let pool   = state.pool().await?;

    sqlx::query!(
        r#"UPDATE expenses SET
           approval_status = 'approved',
           approved_by     = $1,
           approved_at     = NOW(),
           updated_at      = NOW()
           WHERE id = $2 AND deleted_at IS NULL"#,
        claims.user_id,
        id,
    )
    .execute(&pool)
    .await?;

    let expense = fetch_expense(&pool, id).await?;

    crate::database::sync::queue_row(
        &pool, "expenses", "UPDATE", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": expense.store_id,
                            "approval_status": "approved" }),
        Some(expense.store_id),
    ).await;

    write_audit_log(&pool, claims.user_id, Some(expense.store_id), "approve", "expense",
        &format!("Approved expense id {id}"), "info").await;
    Ok(expense)
}

// ── Reject ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn reject_expense(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Expense> {
    guard_permission(&state, &token, "expenses.approve").await?;
    let pool = state.pool().await?;

    sqlx::query!(
        "UPDATE expenses SET approval_status = 'rejected', updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
        id,
    )
    .execute(&pool)
    .await?;

    fetch_expense(&pool, id).await
}

// ── Soft delete ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn delete_expense(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    let claims = guard_permission(&state, &token, "expenses.delete").await?;
    let pool   = state.pool().await?;
    let _existing = fetch_expense(&pool, id).await?; // ensure exists

    sqlx::query!(
        "UPDATE expenses SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2",
        claims.user_id,
        id,
    )
    .execute(&pool)
    .await?;

    Ok(())
}

// ── Summary ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ExpenseSummary {
    pub expense_count:    i64,
    pub total_amount:     Decimal,
    pub paid_amount:      Decimal,
    pub pending_amount:   Decimal,
    pub deductible_amount: Decimal,
}

#[tauri::command]
pub async fn get_expense_summary(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    date_from: Option<String>,
    date_to:   Option<String>,
) -> AppResult<ExpenseSummary> {
    guard_permission(&state, &token, "expenses.read").await?;
    let pool = state.pool().await?;
    let df   = date_from.as_deref();
    let dt   = date_to.as_deref();

    let row = sqlx::query!(
        r#"SELECT
               COUNT(*)                                                                        AS expense_count,
               COALESCE(SUM(amount), 0)                                                       AS total_amount,
               COALESCE(SUM(CASE WHEN payment_status = 'paid'    THEN amount ELSE 0 END), 0) AS paid_amount,
               COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN amount ELSE 0 END), 0) AS pending_amount,
               COALESCE(SUM(CASE WHEN is_deductible = TRUE       THEN amount ELSE 0 END), 0) AS deductible_amount
           FROM expenses
           WHERE store_id       = $1
             AND approval_status = 'approved'
             AND deleted_at      IS NULL
             AND ($2::text IS NULL OR expense_date >= $2::timestamptz)
             AND ($3::text IS NULL OR expense_date <= $3::timestamptz)"#,
        store_id,
        df,
        dt,
    )
    .fetch_one(&pool)
    .await?;

    Ok(ExpenseSummary {
        expense_count:     row.expense_count.unwrap_or(0),
        total_amount:      row.total_amount.unwrap_or_default(),
        paid_amount:       row.paid_amount.unwrap_or_default(),
        pending_amount:    row.pending_amount.unwrap_or_default(),
        deductible_amount: row.deductible_amount.unwrap_or_default(),
    })
}

// ── Breakdown by type ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ExpenseBreakdown {
    pub expense_type:  Option<String>,
    pub expense_count: i64,
    pub total_amount:  Decimal,
}

#[tauri::command]
pub async fn get_expense_breakdown(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    date_from: Option<String>,
    date_to:   Option<String>,
) -> AppResult<Vec<ExpenseBreakdown>> {
    guard_permission(&state, &token, "expenses.read").await?;
    let pool = state.pool().await?;
    let df   = date_from.as_deref();
    let dt   = date_to.as_deref();

    sqlx::query_as!(
        ExpenseBreakdown,
        r#"SELECT
               expense_type,
               COUNT(*)           AS "expense_count!",
               COALESCE(SUM(amount), 0) AS "total_amount!"
           FROM expenses
           WHERE store_id        = $1
             AND approval_status = 'approved'
             AND deleted_at      IS NULL
             AND ($2::text IS NULL OR expense_date >= $2::timestamptz)
             AND ($3::text IS NULL OR expense_date <= $3::timestamptz)
           GROUP BY expense_type
           ORDER BY 3 DESC"#,
        store_id,
        df,
        dt,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}
