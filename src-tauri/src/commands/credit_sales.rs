// ============================================================================
// CREDIT SALE COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use serde::Serialize;
use crate::{
    error::{AppError, AppResult},
    models::credit_sale::{CreditSale, CreditPayment, RecordCreditPaymentDto, CreditSaleFilters},
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;

// ── Shared fetch ──────────────────────────────────────────────────────────────

async fn fetch_credit_sale(pool: &sqlx::PgPool, id: i32) -> AppResult<CreditSale> {
    sqlx::query_as!(
        CreditSale,
        r#"SELECT cs.id, cs.transaction_id, t.reference_no,
                  cs.store_id, cs.customer_id,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                  cs.total_amount, cs.amount_paid, cs.outstanding,
                  cs.due_date, cs.status, cs.notes,
                  cs.created_at, cs.updated_at
           FROM   credit_sales cs
           JOIN   transactions t ON t.id = cs.transaction_id
           JOIN   customers    c ON c.id = cs.customer_id
           WHERE  cs.id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Credit sale {id} not found")))
}

// ── List ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_credit_sales(
    state:   State<'_, AppState>,
    token:   String,
    filters: CreditSaleFilters,
) -> AppResult<PagedResult<CreditSale>> {
    guard_permission(&state, &token, "credit_sales.read").await?;
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
        r#"SELECT COUNT(*)
           FROM   credit_sales cs
           JOIN   transactions t ON t.id = cs.transaction_id
           JOIN   customers    c ON c.id = cs.customer_id
           WHERE ($1::int  IS NULL OR cs.store_id    = $1)
             AND ($2::int  IS NULL OR cs.customer_id = $2)
             AND ($3::text IS NULL OR cs.status      = $3)
             AND ($4::text IS NULL OR cs.created_at >= $4::timestamptz)
             AND ($5::text IS NULL OR cs.created_at <= $5::timestamptz)
             AND ($6::text IS NULL OR (
                   t.reference_no                          ILIKE $6
                OR CONCAT(c.first_name, ' ', c.last_name)  ILIKE $6
             ))"#,
        filters.store_id, filters.customer_id, filters.status, df, dt, search.as_deref(),
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let sales = sqlx::query_as!(
        CreditSale,
        r#"SELECT cs.id, cs.transaction_id, t.reference_no,
                  cs.store_id, cs.customer_id,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                  cs.total_amount, cs.amount_paid, cs.outstanding,
                  cs.due_date, cs.status, cs.notes,
                  cs.created_at, cs.updated_at
           FROM   credit_sales cs
           JOIN   transactions t ON t.id = cs.transaction_id
           JOIN   customers    c ON c.id = cs.customer_id
           WHERE ($1::int  IS NULL OR cs.store_id    = $1)
             AND ($2::int  IS NULL OR cs.customer_id = $2)
             AND ($3::text IS NULL OR cs.status      = $3)
             AND ($4::text IS NULL OR cs.created_at >= $4::timestamptz)
             AND ($5::text IS NULL OR cs.created_at <= $5::timestamptz)
             AND ($6::text IS NULL OR (
                   t.reference_no                          ILIKE $6
                OR CONCAT(c.first_name, ' ', c.last_name)  ILIKE $6
             ))
           ORDER  BY cs.created_at DESC
           LIMIT $7 OFFSET $8"#,
        filters.store_id, filters.customer_id, filters.status,
        df, dt, search.as_deref(), limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(sales, total, page, limit))
}

// ── Single ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_credit_sale(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<CreditSale> {
    guard_permission(&state, &token, "credit_sales.read").await?;
    let pool = state.pool().await?;
    fetch_credit_sale(&pool, id).await
}

// ── Record payment ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn record_credit_payment(
    state:   State<'_, AppState>,
    token:   String,
    payload: RecordCreditPaymentDto,
) -> AppResult<CreditSale> {
    let claims = guard_permission(&state, &token, "credit_sales.update").await?;
    let pool   = state.pool().await?;

    let cs = fetch_credit_sale(&pool, payload.credit_sale_id).await?;

    if cs.status == "paid" {
        return Err(AppError::Validation("Credit sale is already fully paid".into()));
    }
    if cs.status == "cancelled" {
        return Err(AppError::Validation("Cannot record payment for cancelled credit sale".into()));
    }

    let amount = Decimal::try_from(payload.amount)
        .map_err(|_| AppError::Validation("Invalid payment amount".into()))?;

    if amount <= Decimal::ZERO {
        return Err(AppError::Validation("Payment amount must be positive".into()));
    }
    if amount > cs.outstanding {
        return Err(AppError::Validation(format!(
            "Payment exceeds outstanding balance of {}", cs.outstanding
        )));
    }

    let mut db_tx = pool.begin().await?;

    sqlx::query!(
        r#"INSERT INTO credit_payments
               (credit_sale_id, amount, payment_method, reference, paid_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6)"#,
        payload.credit_sale_id,
        amount,
        payload.payment_method,
        payload.reference,
        claims.user_id,
        payload.notes,
    )
    .execute(&mut *db_tx)
    .await?;

    let new_paid        = cs.amount_paid + amount;
    let new_outstanding = cs.total_amount - new_paid;
    let new_status      = if new_outstanding <= Decimal::ZERO { "paid" }
                          else if new_paid > Decimal::ZERO { "partial" }
                          else { "outstanding" };

    sqlx::query!(
        r#"UPDATE credit_sales SET
           amount_paid = $1,
           outstanding = $2,
           status      = $3,
           updated_at  = NOW()
           WHERE id = $4"#,
        new_paid,
        new_outstanding.max(Decimal::ZERO),
        new_status,
        payload.credit_sale_id,
    )
    .execute(&mut *db_tx)
    .await?;

    // Update customer outstanding balance
    sqlx::query!(
        "UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1) WHERE id = $2",
        amount,
        cs.customer_id,
    )
    .execute(&mut *db_tx)
    .await?;

    db_tx.commit().await?;

    crate::database::sync::queue_row(
        &pool, "credit_sales", "UPDATE", &payload.credit_sale_id.to_string(),
        serde_json::json!({ "id": payload.credit_sale_id,
                            "store_id": cs.store_id,
                            "amount_paid": new_paid.to_string(),
                            "outstanding": new_outstanding.max(Decimal::ZERO).to_string(),
                            "status": new_status }),
        Some(cs.store_id),
    ).await;

    fetch_credit_sale(&pool, payload.credit_sale_id).await
}

// ── Get payments for a credit sale ────────────────────────────────────────────

#[tauri::command]
pub async fn get_credit_payments(
    state:          State<'_, AppState>,
    token:          String,
    credit_sale_id: i32,
) -> AppResult<Vec<CreditPayment>> {
    guard_permission(&state, &token, "credit_sales.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        CreditPayment,
        r#"SELECT id, credit_sale_id, amount, payment_method,
                  reference, paid_by, notes, created_at
           FROM   credit_payments
           WHERE  credit_sale_id = $1
           ORDER  BY created_at DESC"#,
        credit_sale_id
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Cancel credit sale ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cancel_credit_sale(
    state:  State<'_, AppState>,
    token:  String,
    id:     i32,
    reason: Option<String>,
) -> AppResult<CreditSale> {
    guard_permission(&state, &token, "credit_sales.update").await?;
    let pool = state.pool().await?;
    let cs   = fetch_credit_sale(&pool, id).await?;

    if cs.status == "paid" {
        return Err(AppError::Validation("Cannot cancel a fully paid credit sale".into()));
    }
    if cs.status == "cancelled" {
        return Err(AppError::Validation("Credit sale is already cancelled".into()));
    }
    if cs.amount_paid > Decimal::ZERO {
        return Err(AppError::Validation(
            "Cannot cancel credit sale with partial payments. Please refund payments first.".into()
        ));
    }

    let note_suffix = reason.unwrap_or_else(|| "No reason provided".to_string());
    let mut db_tx   = pool.begin().await?;

    sqlx::query!(
        r#"UPDATE credit_sales SET
           status     = 'cancelled',
           notes      = CONCAT(COALESCE(notes, ''), E'\n\nCancelled: ', $1::text),
           updated_at = NOW()
           WHERE id = $2"#,
        note_suffix,
        id,
    )
    .execute(&mut *db_tx)
    .await?;

    // Restore customer balance
    sqlx::query!(
        "UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - $1) WHERE id = $2",
        cs.outstanding,
        cs.customer_id,
    )
    .execute(&mut *db_tx)
    .await?;

    db_tx.commit().await?;

    fetch_credit_sale(&pool, id).await
}

// ── Outstanding balances report ───────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OutstandingBalance {
    pub customer_id:       i32,
    pub customer_name:     Option<String>,
    pub phone:             Option<String>,
    pub credit_limit:      Option<Decimal>,
    pub outstanding_balance: Option<Decimal>,
    pub available_credit:  Option<Decimal>,
    pub total_credit_sales: Option<i64>,
    pub outstanding_count: Option<i64>,
}

#[tauri::command]
pub async fn get_outstanding_balances(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<Vec<OutstandingBalance>> {
    guard_permission(&state, &token, "credit_sales.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        OutstandingBalance,
        r#"SELECT
               c.id                                                AS "customer_id!",
               CONCAT(c.first_name, ' ', c.last_name)            AS customer_name,
               c.phone,
               c.credit_limit,
               c.outstanding_balance,
               (c.credit_limit - c.outstanding_balance)          AS available_credit,
               COUNT(cs.id)                                       AS total_credit_sales,
               COUNT(cs.id) FILTER (WHERE cs.status IN ('outstanding','partial','overdue')) AS outstanding_count
           FROM customers c
           LEFT JOIN credit_sales cs ON cs.customer_id = c.id
             AND ($1::int IS NULL OR cs.store_id = $1)
           WHERE c.outstanding_balance > 0
             AND ($1::int IS NULL OR c.store_id = $1)
           GROUP BY c.id, c.first_name, c.last_name, c.phone, c.credit_limit, c.outstanding_balance
           ORDER BY c.outstanding_balance DESC"#,
        store_id,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Overdue sales ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OverdueSale {
    pub id:            i32,
    pub transaction_id: i32,
    pub reference_no:  Option<String>,
    pub store_id:      i32,
    pub customer_id:   i32,
    pub customer_name: Option<String>,
    pub phone:         Option<String>,
    pub total_amount:  Decimal,
    pub amount_paid:   Decimal,
    pub outstanding:   Decimal,
    pub due_date:      Option<chrono::DateTime<chrono::Utc>>,
    pub status:        String,
    pub days_overdue:  Option<i32>,
    pub created_at:    chrono::DateTime<chrono::Utc>,
}

#[tauri::command]
pub async fn get_overdue_sales(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<Vec<OverdueSale>> {
    guard_permission(&state, &token, "credit_sales.read").await?;
    let pool = state.pool().await?;

    sqlx::query_as!(
        OverdueSale,
        r#"SELECT
               cs.id, cs.transaction_id, t.reference_no,
               cs.store_id, cs.customer_id,
               CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
               c.phone,
               cs.total_amount, cs.amount_paid, cs.outstanding,
               cs.due_date, cs.status,
               EXTRACT(DAY FROM NOW() - cs.due_date)::int AS days_overdue,
               cs.created_at
           FROM   credit_sales cs
           JOIN   transactions t ON t.id = cs.transaction_id
           JOIN   customers    c ON c.id = cs.customer_id
           WHERE  cs.status IN ('outstanding', 'partial', 'overdue')
             AND  cs.due_date < NOW()
             AND ($1::int IS NULL OR cs.store_id = $1)
           ORDER  BY days_overdue DESC"#,
        store_id,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Update credit limit ───────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct UpdateCreditLimitDto {
    pub credit_limit:   Option<f64>,
    pub credit_enabled: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct CustomerCreditInfo {
    pub customer_id:       i32,
    pub credit_limit:      Option<Decimal>,
    pub outstanding_balance: Option<Decimal>,
    pub available_credit:  Option<Decimal>,
    pub credit_enabled:    Option<bool>,
}

#[tauri::command]
pub async fn update_credit_limit(
    state:       State<'_, AppState>,
    token:       String,
    customer_id: i32,
    payload:     UpdateCreditLimitDto,
) -> AppResult<CustomerCreditInfo> {
    guard_permission(&state, &token, "customers.update").await?;
    let pool         = state.pool().await?;
    let credit_limit = payload.credit_limit
        .map(|v| Decimal::try_from(v).map_err(|_| AppError::Validation("Invalid credit limit".into())))
        .transpose()?;

    sqlx::query!(
        r#"UPDATE customers SET
           credit_limit   = COALESCE($1, credit_limit),
           credit_enabled = COALESCE($2, credit_enabled),
           updated_at     = NOW()
           WHERE id = $3"#,
        credit_limit,
        payload.credit_enabled,
        customer_id,
    )
    .execute(&pool)
    .await?;

    let row = sqlx::query!(
        r#"SELECT id, credit_limit, outstanding_balance, credit_enabled
           FROM customers WHERE id = $1"#,
        customer_id,
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Customer {customer_id} not found")))?;

    let available = row.credit_limit - row.outstanding_balance;

    Ok(CustomerCreditInfo {
        customer_id:         row.id,
        credit_limit:        Some(row.credit_limit),
        outstanding_balance: Some(row.outstanding_balance),
        available_credit:    Some(available),
        credit_enabled:      Some(row.credit_enabled),
    })
}

// ── Credit summary ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CreditSummary {
    pub total_credit_sales:   i64,
    pub total_credit_amount:  Decimal,
    pub outstanding_amount:   Decimal,
    pub paid_amount:          Decimal,
    pub overdue_count:        i64,
    pub overdue_amount:       Decimal,
}

#[tauri::command]
pub async fn get_credit_summary(
    state:    State<'_, AppState>,
    token:    String,
    store_id: Option<i32>,
) -> AppResult<CreditSummary> {
    guard_permission(&state, &token, "credit_sales.read").await?;
    let pool = state.pool().await?;

    let row = sqlx::query!(
        r#"SELECT
               COUNT(*)                                                                  AS total_credit_sales,
               COALESCE(SUM(total_amount), 0)                                           AS total_credit_amount,
               COALESCE(SUM(outstanding),  0)                                           AS outstanding_amount,
               COALESCE(SUM(amount_paid),  0)                                           AS paid_amount,
               COUNT(*) FILTER (WHERE status = 'overdue' OR (due_date < NOW() AND status IN ('outstanding','partial'))) AS overdue_count,
               COALESCE(SUM(outstanding) FILTER (WHERE status = 'overdue' OR (due_date < NOW() AND status IN ('outstanding','partial'))), 0) AS overdue_amount
           FROM credit_sales
           WHERE ($1::int IS NULL OR store_id = $1)"#,
        store_id,
    )
    .fetch_one(&pool)
    .await?;

    Ok(CreditSummary {
        total_credit_sales:  row.total_credit_sales.unwrap_or(0),
        total_credit_amount: row.total_credit_amount.unwrap_or_default(),
        outstanding_amount:  row.outstanding_amount.unwrap_or_default(),
        paid_amount:         row.paid_amount.unwrap_or_default(),
        overdue_count:       row.overdue_count.unwrap_or(0),
        overdue_amount:      row.overdue_amount.unwrap_or_default(),
    })
}
