// ============================================================================
// CUSTOMER COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use serde::Serialize;
use crate::{
    error::{AppError, AppResult},
    models::customer::{Customer, CreateCustomerDto, UpdateCustomerDto, CustomerFilters},
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

// ── Shared fetch ─────────────────────────────────────────────────────────────
async fn fetch_customer(pool: &sqlx::PgPool, id: i32) -> AppResult<Customer> {
    sqlx::query_as!(
        Customer,
        r#"SELECT id, store_id, first_name, last_name, email, phone,
                  address, city, loyalty_points, credit_limit,
                  outstanding_balance, customer_type, credit_enabled,
                  is_active, created_at, updated_at
           FROM   customers WHERE id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Customer {id} not found")))
}

// ── List / Search ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_customers(
    state:   State<'_, AppState>,
    token:   String,
    filters: CustomerFilters,
) -> AppResult<PagedResult<Customer>> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;
    let search = filters.search.as_ref().map(|s| format!("%{s}%"));

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM customers
           WHERE ($1::int  IS NULL OR store_id       = $1)
             AND ($2::bool IS NULL OR is_active      = $2)
             AND ($3::text IS NULL OR customer_type  = $3)
             AND ($4::text IS NULL OR first_name ILIKE $4 OR last_name ILIKE $4
                  OR email ILIKE $4 OR phone ILIKE $4)"#,
        filters.store_id,
        filters.is_active,
        filters.customer_type,
        search,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let customers = sqlx::query_as!(
        Customer,
        r#"SELECT id, store_id, first_name, last_name, email, phone,
                  address, city, loyalty_points, credit_limit,
                  outstanding_balance, customer_type, credit_enabled,
                  is_active, created_at, updated_at
           FROM   customers
           WHERE ($1::int  IS NULL OR store_id       = $1)
             AND ($2::bool IS NULL OR is_active      = $2)
             AND ($3::text IS NULL OR customer_type  = $3)
             AND ($4::text IS NULL OR first_name ILIKE $4 OR last_name ILIKE $4
                  OR email ILIKE $4 OR phone ILIKE $4)
           ORDER  BY first_name, last_name
           LIMIT $5 OFFSET $6"#,
        filters.store_id,
        filters.is_active,
        filters.customer_type,
        search,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(customers, total, page, limit))
}

/// Lightweight search for POS autocomplete (name / phone / email).
#[tauri::command]
pub async fn search_customers(
    state:    State<'_, AppState>,
    token:    String,
    query:    String,
    store_id: Option<i32>,
    limit:    Option<i64>,
) -> AppResult<Vec<Customer>> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool   = state.pool().await?;
    let search = format!("%{}%", query.trim());
    let limit  = limit.unwrap_or(10).clamp(1, 50);

    sqlx::query_as!(
        Customer,
        r#"SELECT id, store_id, first_name, last_name, email, phone,
                  address, city, loyalty_points, credit_limit,
                  outstanding_balance, customer_type, credit_enabled,
                  is_active, created_at, updated_at
           FROM   customers
           WHERE  is_active = TRUE
             AND ($1::int IS NULL OR store_id = $1)
             AND (first_name ILIKE $2 OR last_name ILIKE $2
                  OR email ILIKE $2 OR phone ILIKE $2)
           ORDER  BY first_name, last_name
           LIMIT  $3"#,
        store_id,
        search,
        limit,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Single record ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_customer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Customer> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool = state.pool().await?;
    fetch_customer(&pool, id).await
}

// ── Stats & history (like quantum-pos-app getStats / getTransactions) ─────────

#[derive(Debug, Serialize)]
pub struct CustomerStats {
    pub customer_id:         i32,
    pub total_transactions:  i64,
    pub credit_transactions: i64,
    pub total_spent:         Decimal,
    pub credit_limit:        Decimal,
    pub outstanding_balance: Decimal,
    pub available_credit:    Decimal,
    pub credit_enabled:      bool,
}

#[tauri::command]
pub async fn get_customer_stats(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<CustomerStats> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool = state.pool().await?;

    let row = sqlx::query!(
        r#"SELECT
               c.id,
               c.credit_limit,
               c.outstanding_balance,
               c.credit_enabled,
               (c.credit_limit - COALESCE(c.outstanding_balance, 0)) as available_credit,
               COUNT(t.id)                                           as total_transactions,
               COUNT(t.id) FILTER (WHERE t.payment_method = 'credit') as credit_transactions,
               COALESCE(SUM(t.total_amount), 0)                      as total_spent
           FROM customers c
           LEFT JOIN transactions t ON t.customer_id = c.id AND t.status = 'completed'
           WHERE c.id = $1
           GROUP BY c.id, c.credit_limit, c.outstanding_balance, c.credit_enabled"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Customer {id} not found")))?;

    Ok(CustomerStats {
        customer_id:         row.id,
        total_transactions:  row.total_transactions.unwrap_or(0),
        credit_transactions: row.credit_transactions.unwrap_or(0),
        total_spent:         row.total_spent.unwrap_or_default(),
        credit_limit:        row.credit_limit,
        outstanding_balance: row.outstanding_balance,
        available_credit:    row.available_credit.unwrap_or_default(),
        credit_enabled:      row.credit_enabled,
    })
}

#[derive(Debug, Serialize)]
pub struct CustomerTransaction {
    pub id:             i32,
    pub reference_no:   String,
    pub total_amount:   Decimal,
    pub payment_method: String,
    pub status:         String,
    pub created_at:     chrono::DateTime<chrono::Utc>,
}

#[tauri::command]
pub async fn get_customer_transactions(
    state:    State<'_, AppState>,
    token:    String,
    id:       i32,
    page:     Option<i64>,
    limit:    Option<i64>,
    date_from: Option<String>,
    date_to:   Option<String>,
) -> AppResult<PagedResult<CustomerTransaction>> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool   = state.pool().await?;
    let page   = page.unwrap_or(1).max(1);
    let limit  = limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;
    let df     = date_from.as_deref();
    let dt     = date_to.as_deref();

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM transactions
           WHERE customer_id = $1
             AND ($2::text IS NULL OR created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR created_at <= $3::timestamptz)"#,
        id, df, dt,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let rows = sqlx::query!(
        r#"SELECT id, reference_no, total_amount, payment_method, status, created_at
           FROM transactions
           WHERE customer_id = $1
             AND ($2::text IS NULL OR created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR created_at <= $3::timestamptz)
           ORDER BY created_at DESC
           LIMIT $4 OFFSET $5"#,
        id, df, dt, limit, offset,
    )
    .fetch_all(&pool)
    .await?;

    let txns = rows.into_iter().map(|r| CustomerTransaction {
        id:             r.id,
        reference_no:   r.reference_no,
        total_amount:   r.total_amount,
        payment_method: r.payment_method,
        status:         r.status,
        created_at:     r.created_at,
    }).collect();

    Ok(PagedResult::new(txns, total, page, limit))
}

// ── Create / Update ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_customer(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateCustomerDto,
) -> AppResult<Customer> {
    guard_permission(&state, &token, "customers.create").await?;
    let pool    = state.pool().await?;
    // credit_limit is NOT NULL in the DB — default to 0 when caller omits it.
    let limit = payload.credit_limit.map(to_dec).unwrap_or(Decimal::ZERO);

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO customers
               (store_id, first_name, last_name, email, phone, address, city,
                credit_limit, customer_type, credit_enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                   COALESCE($9, 'regular'),
                   COALESCE($10, FALSE))
           RETURNING id"#,
        payload.store_id,
        payload.first_name,
        payload.last_name,
        payload.email,
        payload.phone,
        payload.address,
        payload.city,
        limit,         // always Decimal, never NULL
        payload.customer_type,
        payload.credit_enabled,
    )
    .fetch_one(&pool)
    .await?;

    fetch_customer(&pool, id).await
}

#[tauri::command]
pub async fn update_customer(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateCustomerDto,
) -> AppResult<Customer> {
    guard_permission(&state, &token, "customers.update").await?;
    let pool  = state.pool().await?;
    let limit = payload.credit_limit.map(to_dec);

    sqlx::query!(
        r#"UPDATE customers SET
           first_name      = COALESCE($1,  first_name),
           last_name       = COALESCE($2,  last_name),
           email           = COALESCE($3,  email),
           phone           = COALESCE($4,  phone),
           address         = COALESCE($5,  address),
           city            = COALESCE($6,  city),
           credit_limit    = COALESCE($7,  credit_limit),
           is_active       = COALESCE($8,  is_active),
           customer_type   = COALESCE($9,  customer_type),
           credit_enabled  = COALESCE($10, credit_enabled),
           updated_at      = NOW()
           WHERE id = $11"#,
        payload.first_name,
        payload.last_name,
        payload.email,
        payload.phone,
        payload.address,
        payload.city,
        limit,
        payload.is_active,
        payload.customer_type,
        payload.credit_enabled,
        id,
    )
    .execute(&pool)
    .await?;

    fetch_customer(&pool, id).await
}

// ── Activate / Deactivate / Delete ────────────────────────────────────────────

#[tauri::command]
pub async fn activate_customer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Customer> {
    guard_permission(&state, &token, "customers.update").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "UPDATE customers SET is_active = TRUE, updated_at = NOW() WHERE id = $1", id
    )
    .execute(&pool)
    .await?;
    fetch_customer(&pool, id).await
}

#[tauri::command]
pub async fn deactivate_customer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Customer> {
    guard_permission(&state, &token, "customers.update").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "UPDATE customers SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id
    )
    .execute(&pool)
    .await?;
    fetch_customer(&pool, id).await
}

#[tauri::command]
pub async fn delete_customer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    guard_permission(&state, &token, "customers.delete").await?;
    let pool = state.pool().await?;

    // Block delete if outstanding balance
    let balance: Decimal = sqlx::query_scalar!(
        "SELECT outstanding_balance FROM customers WHERE id = $1", id
    )
    .fetch_optional(&pool)
    .await?
    .unwrap_or_default();

    if balance > Decimal::ZERO {
        return Err(AppError::Validation(
            format!("Cannot delete customer with outstanding balance of {balance}. Clear balance first.")
        ));
    }

    sqlx::query!(
        "UPDATE customers SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id
    )
    .execute(&pool)
    .await?;
    Ok(())
}
