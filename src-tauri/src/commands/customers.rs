// ============================================================================
// CUSTOMER COMMANDS
// ============================================================================

use tauri::State;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use crate::{
    error::{AppError, AppResult},
    models::customer::{Customer, CreateCustomerDto, UpdateCustomerDto, CustomerFilters},
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;
use super::audit::write_audit_log;

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

fn parse_filter_date(raw: &str, field: &str) -> AppResult<DateTime<Utc>> {
    if let Ok(dt) = raw.parse::<DateTime<Utc>>() {
        return Ok(dt);
    }
    if let Ok(d) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        if let Some(dt) = d.and_hms_opt(0, 0, 0) {
            return Ok(dt.and_utc());
        }
    }
    Err(AppError::Validation(format!("Invalid {field} format")))
}

// ── Shared fetch ─────────────────────────────────────────────────────────────
async fn fetch_customer(pool: &sqlx::PgPool, id: i32) -> AppResult<Customer> {
    sqlx::query_as!(
        Customer,
        r#"SELECT id, store_id, first_name, last_name, email, phone,
                  address, city, loyalty_points, wallet_balance,
                  credit_limit, outstanding_balance, customer_type, credit_enabled,
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
    let claims = guard_permission(&state, &token, "customers.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;
    let search = filters.search.as_ref().map(|s| format!("%{s}%"));
    let scoped_store_id = if claims.is_global { filters.store_id } else { claims.store_id };

    let rows = sqlx::query!(
        r#"WITH filtered AS (
               SELECT id, store_id, first_name, last_name, email, phone,
                      address, city, loyalty_points, wallet_balance,
                      credit_limit, outstanding_balance, customer_type, credit_enabled,
                      is_active, created_at, updated_at
               FROM customers
               WHERE ($1::int  IS NULL OR store_id       = $1)
                 AND ($2::bool IS NULL OR is_active      = $2)
                 AND ($3::text IS NULL OR customer_type  = $3)
                 AND ($4::text IS NULL OR first_name ILIKE $4 OR last_name ILIKE $4
                      OR email ILIKE $4 OR phone ILIKE $4)
           )
           SELECT
               id as "id!: i32",
               store_id as "store_id!: i32",
               first_name as "first_name!: String",
               last_name as "last_name!: String",
               email,
               phone,
               address,
               city,
               loyalty_points as "loyalty_points!: i32",
               wallet_balance as "wallet_balance!: Decimal",
               credit_limit as "credit_limit!: Decimal",
               outstanding_balance as "outstanding_balance!: Decimal",
               customer_type,
               credit_enabled,
               is_active as "is_active!: bool",
               created_at as "created_at!: chrono::DateTime<chrono::Utc>",
               updated_at as "updated_at!: chrono::DateTime<chrono::Utc>",
               COUNT(*) OVER()::bigint as "total_count!: i64"
           FROM filtered
           ORDER BY first_name, last_name
           LIMIT $5 OFFSET $6"#,
        scoped_store_id,
        filters.is_active,
        filters.customer_type,
        search,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    let total = rows.first().map(|r| r.total_count).unwrap_or(0);
    let customers = rows.into_iter().map(|r| Customer {
        id: r.id,
        store_id: r.store_id,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        phone: r.phone,
        address: r.address,
        city: r.city,
        loyalty_points: r.loyalty_points,
        wallet_balance: r.wallet_balance,
        credit_limit: r.credit_limit,
        outstanding_balance: r.outstanding_balance,
        customer_type: r.customer_type,
        credit_enabled: Some(r.credit_enabled),
        is_active: r.is_active,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }).collect();

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
    let claims = guard_permission(&state, &token, "customers.read").await?;
    let pool   = state.pool().await?;
    let search = format!("%{}%", query.trim());
    let limit  = limit.unwrap_or(10).clamp(1, 50);
    let scoped_store_id = if claims.is_global { store_id } else { claims.store_id };

    sqlx::query_as!(
        Customer,
        r#"SELECT id, store_id, first_name, last_name, email, phone,
                  address, city, loyalty_points, wallet_balance,
                  credit_limit, outstanding_balance, customer_type, credit_enabled,
                  is_active, created_at, updated_at
           FROM   customers
           WHERE  is_active = TRUE
             AND ($1::int IS NULL OR store_id = $1)
             AND (first_name ILIKE $2 OR last_name ILIKE $2
                  OR email ILIKE $2 OR phone ILIKE $2)
           ORDER  BY first_name, last_name
           LIMIT  $3"#,
        scoped_store_id,
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
    let claims = guard_permission(&state, &token, "customers.read").await?;
    let pool = state.pool().await?;
    let customer = fetch_customer(&pool, id).await?;
    if !claims.is_global && claims.store_id != Some(customer.store_id) {
        return Err(AppError::Forbidden);
    }
    Ok(customer)
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
    let claims = guard_permission(&state, &token, "customers.read").await?;
    let pool = state.pool().await?;

    let row = sqlx::query!(
        r#"SELECT
               c.id,
               c.credit_limit,
               c.outstanding_balance,
               c.credit_enabled,
               GREATEST(c.credit_limit - COALESCE(c.outstanding_balance, 0), 0::numeric) as available_credit,
               c.store_id,
               COUNT(t.id)                                           as total_transactions,
               COUNT(t.id) FILTER (WHERE t.payment_method = 'credit') as credit_transactions,
               COALESCE(SUM(t.total_amount), 0)                      as total_spent
           FROM customers c
           LEFT JOIN transactions t ON t.customer_id = c.id AND t.status = 'completed'
           WHERE c.id = $1
           GROUP BY c.id, c.store_id, c.credit_limit, c.outstanding_balance, c.credit_enabled"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Customer {id} not found")))?;

    if !claims.is_global && claims.store_id != Some(row.store_id) {
        return Err(AppError::Forbidden);
    }

    Ok(CustomerStats {
        customer_id:         row.id,
        total_transactions:  row.total_transactions.unwrap_or(0),
        credit_transactions: row.credit_transactions.unwrap_or(0),
        total_spent:         row.total_spent.unwrap_or(Decimal::ZERO),
        credit_limit:        row.credit_limit,
        outstanding_balance: row.outstanding_balance,
        available_credit:    row.available_credit.unwrap_or(Decimal::ZERO),
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

#[derive(Debug, Serialize)]
pub struct CustomerSummary {
    pub total: i64,
    pub active_count: i64,
    pub inactive_count: i64,
    pub vip_count: i64,
    pub wholesale_count: i64,
    pub regular_count: i64,
}

#[tauri::command]
pub async fn get_customer_summary(
    state: State<'_, AppState>,
    token: String,
    store_id: Option<i32>,
) -> AppResult<CustomerSummary> {
    let claims = guard_permission(&state, &token, "customers.read").await?;
    let pool = state.pool().await?;
    let scoped_store_id = if claims.is_global { store_id } else { claims.store_id };

    let row = sqlx::query!(
        r#"SELECT
               COUNT(*)::bigint AS total,
               COUNT(*) FILTER (WHERE is_active = TRUE)::bigint AS active_count,
               COUNT(*) FILTER (WHERE is_active = FALSE)::bigint AS inactive_count,
               COUNT(*) FILTER (WHERE customer_type = 'vip')::bigint AS vip_count,
               COUNT(*) FILTER (WHERE customer_type = 'wholesale')::bigint AS wholesale_count,
               COUNT(*) FILTER (WHERE customer_type = 'regular' OR customer_type IS NULL)::bigint AS regular_count
           FROM customers
           WHERE ($1::int IS NULL OR store_id = $1)"#,
        scoped_store_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(CustomerSummary {
        total: row.total.unwrap_or(0),
        active_count: row.active_count.unwrap_or(0),
        inactive_count: row.inactive_count.unwrap_or(0),
        vip_count: row.vip_count.unwrap_or(0),
        wholesale_count: row.wholesale_count.unwrap_or(0),
        regular_count: row.regular_count.unwrap_or(0),
    })
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
    let claims = guard_permission(&state, &token, "customers.read").await?;
    let pool   = state.pool().await?;
    let page   = page.unwrap_or(1).max(1);
    let limit  = limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;
    if let Some(ref value) = date_from {
        parse_filter_date(value, "date_from")?;
    }
    if let Some(ref value) = date_to {
        parse_filter_date(value, "date_to")?;
    }
    let df = date_from.as_deref();
    let dt = date_to.as_deref();

    let customer_store = sqlx::query_scalar!("SELECT store_id FROM customers WHERE id = $1", id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Customer {id} not found")))?;
    if !claims.is_global && claims.store_id != Some(customer_store) {
        return Err(AppError::Forbidden);
    }

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
    let claims = guard_permission(&state, &token, "customers.create").await?;
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

    let created = fetch_customer(&pool, id).await?;
    crate::database::sync::queue_row(
        &pool, "customers", "INSERT", &id.to_string(),
        serde_json::to_value(&created).unwrap_or(serde_json::json!({ "id": id, "store_id": created.store_id })),
        Some(created.store_id),
    ).await;

    write_audit_log(&pool, claims.user_id, Some(created.store_id), "create", "customer",
        &format!("Created customer '{} {}'", created.first_name, created.last_name), "info").await;
    Ok(created)
}

#[tauri::command]
pub async fn update_customer(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateCustomerDto,
) -> AppResult<Customer> {
    let claims = guard_permission(&state, &token, "customers.update").await?;
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

    let result = fetch_customer(&pool, id).await?;

    crate::database::sync::queue_row(
        &pool, "customers", "UPDATE", &id.to_string(),
        serde_json::to_value(&result).unwrap_or(serde_json::json!({ "id": id, "store_id": result.store_id })),
        Some(result.store_id),
    ).await;

    write_audit_log(&pool, claims.user_id, Some(result.store_id), "update", "customer",
        &format!("Updated customer id {id}"), "info").await;
    Ok(result)
}

// ── Activate / Deactivate / Delete ────────────────────────────────────────────

#[tauri::command]
pub async fn activate_customer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Customer> {
    let claims = guard_permission(&state, &token, "customers.update").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "UPDATE customers SET is_active = TRUE, updated_at = NOW() WHERE id = $1", id
    )
    .execute(&pool)
    .await?;
    let customer = fetch_customer(&pool, id).await?;
    write_audit_log(&pool, claims.user_id, Some(customer.store_id), "activate", "customer",
        &format!("Activated customer id {id}"), "info").await;
    Ok(customer)
}

#[tauri::command]
pub async fn deactivate_customer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Customer> {
    let claims = guard_permission(&state, &token, "customers.update").await?;
    let pool = state.pool().await?;
    sqlx::query!(
        "UPDATE customers SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id
    )
    .execute(&pool)
    .await?;
    let customer = fetch_customer(&pool, id).await?;
    write_audit_log(&pool, claims.user_id, Some(customer.store_id), "deactivate", "customer",
        &format!("Deactivated customer id {id}"), "warning").await;
    Ok(customer)
}

#[tauri::command]
pub async fn delete_customer(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    let claims = guard_permission(&state, &token, "customers.delete").await?;
    let pool = state.pool().await?;
    let mut tx = pool.begin().await?;

    let customer = sqlx::query!(
        "SELECT store_id, outstanding_balance FROM customers WHERE id = $1 FOR UPDATE",
        id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Customer {id} not found")))?;

    if customer.outstanding_balance > Decimal::ZERO {
        return Err(AppError::Validation(
            format!(
                "Cannot delete customer with outstanding balance of {}. Clear balance first.",
                customer.outstanding_balance
            )
        ));
    }

    sqlx::query!(
        "UPDATE customers SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    crate::database::sync::queue_row(
        &pool, "customers", "UPDATE", &id.to_string(),
        serde_json::json!({ "id": id, "store_id": customer.store_id, "is_active": false }),
        Some(customer.store_id),
    ).await;

    write_audit_log(&pool, claims.user_id, Some(customer.store_id), "delete", "customer",
        &format!("Deleted customer id {id}"), "warning").await;
    Ok(())
}
