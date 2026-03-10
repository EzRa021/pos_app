// ============================================================================
// SUPPLIER COMMANDS
// ============================================================================

use tauri::State;
use rust_decimal::Decimal;
use serde::Serialize;
use crate::{
    error::{AppError, AppResult},
    models::supplier::{Supplier, CreateSupplierDto, UpdateSupplierDto, SupplierFilters},
    models::pagination::PagedResult,
    state::AppState,
};
use super::auth::guard_permission;

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

pub(crate) async fn get_suppliers_inner(state: &AppState, token: String, filters: SupplierFilters) -> AppResult<PagedResult<Supplier>> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; get_suppliers(s, token, filters).await
}
pub(crate) async fn get_supplier_inner(state: &AppState, token: String, id: i32) -> AppResult<Supplier> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; get_supplier(s, token, id).await
}
pub(crate) async fn create_supplier_inner(state: &AppState, token: String, payload: CreateSupplierDto) -> AppResult<Supplier> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; create_supplier(s, token, payload).await
}
pub(crate) async fn update_supplier_inner(state: &AppState, token: String, id: i32, payload: UpdateSupplierDto) -> AppResult<Supplier> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; update_supplier(s, token, id, payload).await
}
pub(crate) async fn delete_supplier_inner(state: &AppState, token: String, id: i32) -> AppResult<()> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; delete_supplier(s, token, id).await
}
pub(crate) async fn activate_supplier_inner(state: &AppState, token: String, id: i32) -> AppResult<Supplier> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; activate_supplier(s, token, id).await
}
pub(crate) async fn deactivate_supplier_inner(state: &AppState, token: String, id: i32) -> AppResult<Supplier> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; deactivate_supplier(s, token, id).await
}
pub(crate) async fn get_supplier_stats_inner(state: &AppState, token: String, id: i32) -> AppResult<SupplierStats> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; get_supplier_stats(s, token, id).await
}
pub(crate) async fn search_suppliers_inner(state: &AppState, token: String, query: String, limit: Option<i64>) -> AppResult<Vec<Supplier>> {
    let s: tauri::State<'_, AppState> = unsafe { std::mem::transmute(state) }; search_suppliers(s, token, query, limit).await
}

// ── Shared fetch ──────────────────────────────────────────────────────────────
async fn fetch_supplier(pool: &sqlx::PgPool, id: i32) -> AppResult<Supplier> {
    sqlx::query_as!(
        Supplier,
        r#"SELECT id, store_id, supplier_code, supplier_name, contact_name, email, phone,
                  address, city, tax_id, payment_terms, credit_limit, current_balance,
                  is_active, created_at, updated_at
           FROM   suppliers WHERE id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Supplier {id} not found")))
}

async fn generate_supplier_code(pool: &sqlx::PgPool) -> AppResult<String> {
    let last: Option<String> = sqlx::query_scalar!(
        "SELECT supplier_code FROM suppliers ORDER BY id DESC LIMIT 1"
    )
    .fetch_optional(pool)
    .await?;

    match last {
        Some(code) => {
            if let Some(num_str) = code.strip_prefix("SUP-") {
                if let Ok(n) = num_str.parse::<u32>() {
                    return Ok(format!("SUP-{:04}", n + 1));
                }
            }
            Ok("SUP-0001".to_string())
        }
        None => Ok("SUP-0001".to_string()),
    }
}

// ── List / Search ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_suppliers(
    state:   State<'_, AppState>,
    token:   String,
    filters: SupplierFilters,
) -> AppResult<PagedResult<Supplier>> {
    guard_permission(&state, &token, "suppliers.read").await?;
    let pool   = state.pool().await?;
    let page   = filters.page.unwrap_or(1).max(1);
    let limit  = filters.limit.unwrap_or(20).clamp(1, 200);
    let offset = (page - 1) * limit;
    let search = filters.search.as_ref().map(|s| format!("%{s}%"));

    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM suppliers
           WHERE ($1::int  IS NULL OR store_id  = $1)
             AND ($2::bool IS NULL OR is_active = $2)
             AND ($3::text IS NULL OR supplier_name ILIKE $3 OR supplier_code ILIKE $3
                  OR contact_name ILIKE $3 OR email ILIKE $3 OR phone ILIKE $3)"#,
        filters.store_id,
        filters.is_active,
        search,
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    let suppliers = sqlx::query_as!(
        Supplier,
        r#"SELECT id, store_id, supplier_code, supplier_name, contact_name, email, phone,
                  address, city, tax_id, payment_terms, credit_limit, current_balance,
                  is_active, created_at, updated_at
           FROM   suppliers
           WHERE ($1::int  IS NULL OR store_id  = $1)
             AND ($2::bool IS NULL OR is_active = $2)
             AND ($3::text IS NULL OR supplier_name ILIKE $3 OR supplier_code ILIKE $3
                  OR contact_name ILIKE $3 OR email ILIKE $3 OR phone ILIKE $3)
           ORDER  BY supplier_name
           LIMIT $4 OFFSET $5"#,
        filters.store_id,
        filters.is_active,
        search,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await?;

    Ok(PagedResult::new(suppliers, total, page, limit))
}

/// Lightweight search for PO autocomplete.
#[tauri::command]
pub async fn search_suppliers(
    state: State<'_, AppState>,
    token: String,
    query: String,
    limit: Option<i64>,
) -> AppResult<Vec<Supplier>> {
    guard_permission(&state, &token, "suppliers.read").await?;
    let pool   = state.pool().await?;
    let search = format!("%{}%", query.trim());
    let lim    = limit.unwrap_or(10).clamp(1, 50);

    sqlx::query_as!(
        Supplier,
        r#"SELECT id, store_id, supplier_code, supplier_name, contact_name, email, phone,
                  address, city, tax_id, payment_terms, credit_limit, current_balance,
                  is_active, created_at, updated_at
           FROM   suppliers
           WHERE  is_active = TRUE
             AND (supplier_name ILIKE $1 OR supplier_code ILIKE $1
                  OR contact_name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1)
           ORDER  BY supplier_name
           LIMIT  $2"#,
        search,
        lim,
    )
    .fetch_all(&pool)
    .await
    .map_err(AppError::from)
}

// ── Single record ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_supplier(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Supplier> {
    guard_permission(&state, &token, "suppliers.read").await?;
    let pool = state.pool().await?;
    fetch_supplier(&pool, id).await
}

// ── Supplier stats ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SupplierStats {
    pub total_orders:     i64,
    pub completed_orders: i64,
    pub pending_orders:   i64,
    pub total_spent:      Decimal,
    pub avg_order_value:  Option<Decimal>,
}

#[tauri::command]
pub async fn get_supplier_stats(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<SupplierStats> {
    guard_permission(&state, &token, "suppliers.read").await?;
    let pool = state.pool().await?;

    let row = sqlx::query!(
        r#"SELECT
               COUNT(*)                                                              AS total_orders,
               COUNT(*) FILTER (WHERE status = 'received')                          AS completed_orders,
               COUNT(*) FILTER (WHERE status IN ('pending','approved'))              AS pending_orders,
               COALESCE(SUM(total_amount) FILTER (WHERE status = 'received'), 0)    AS total_spent,
               AVG(total_amount)          FILTER (WHERE status = 'received')        AS avg_order_value
           FROM purchase_orders
           WHERE supplier_id = $1"#,
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(SupplierStats {
        total_orders:     row.total_orders.unwrap_or(0),
        completed_orders: row.completed_orders.unwrap_or(0),
        pending_orders:   row.pending_orders.unwrap_or(0),
        total_spent:      row.total_spent.unwrap_or_default(),
        avg_order_value:  row.avg_order_value,
    })
}

// ── Create / Update ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_supplier(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateSupplierDto,
) -> AppResult<Supplier> {
    guard_permission(&state, &token, "suppliers.create").await?;
    let pool         = state.pool().await?;
    let code         = generate_supplier_code(&pool).await?;
    let credit_limit = payload.credit_limit.map(|v| to_dec(v));

    let id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO suppliers
               (store_id, supplier_code, supplier_name, contact_name, email, phone,
                address, city, tax_id, payment_terms, credit_limit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                   COALESCE($10, 'Net 30'),
                   COALESCE($11, 0::numeric))
           RETURNING id"#,
        payload.store_id,
        code,
        payload.supplier_name,
        payload.contact_name,
        payload.email,
        payload.phone,
        payload.address,
        payload.city,
        payload.tax_id,
        payload.payment_terms,
        credit_limit,
    )
    .fetch_one(&pool)
    .await?;

    fetch_supplier(&pool, id).await
}

#[tauri::command]
pub async fn update_supplier(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateSupplierDto,
) -> AppResult<Supplier> {
    guard_permission(&state, &token, "suppliers.update").await?;
    let pool         = state.pool().await?;
    let credit_limit = payload.credit_limit.map(|v| to_dec(v));

    sqlx::query!(
        r#"UPDATE suppliers SET
           supplier_name  = COALESCE($1,  supplier_name),
           contact_name   = COALESCE($2,  contact_name),
           email          = COALESCE($3,  email),
           phone          = COALESCE($4,  phone),
           address        = COALESCE($5,  address),
           city           = COALESCE($6,  city),
           tax_id         = COALESCE($7,  tax_id),
           payment_terms  = COALESCE($8,  payment_terms),
           credit_limit   = COALESCE($9,  credit_limit),
           is_active      = COALESCE($10, is_active),
           updated_at     = NOW()
           WHERE id = $11"#,
        payload.supplier_name,
        payload.contact_name,
        payload.email,
        payload.phone,
        payload.address,
        payload.city,
        payload.tax_id,
        payload.payment_terms,
        credit_limit,
        payload.is_active,
        id,
    )
    .execute(&pool)
    .await?;

    fetch_supplier(&pool, id).await
}

// ── Activate / Deactivate / Delete ────────────────────────────────────────────

#[tauri::command]
pub async fn activate_supplier(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Supplier> {
    guard_permission(&state, &token, "suppliers.update").await?;
    let pool = state.pool().await?;
    sqlx::query!("UPDATE suppliers SET is_active = TRUE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool).await?;
    fetch_supplier(&pool, id).await
}

#[tauri::command]
pub async fn deactivate_supplier(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Supplier> {
    guard_permission(&state, &token, "suppliers.update").await?;
    let pool = state.pool().await?;
    sqlx::query!("UPDATE suppliers SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool).await?;
    fetch_supplier(&pool, id).await
}

#[tauri::command]
pub async fn delete_supplier(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<()> {
    guard_permission(&state, &token, "suppliers.delete").await?;
    let pool = state.pool().await?;

    let po_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = $1", id
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or(0);

    if po_count > 0 {
        // Cannot hard delete; soft-delete instead
        sqlx::query!("UPDATE suppliers SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id)
            .execute(&pool).await?;
    } else {
        sqlx::query!("DELETE FROM suppliers WHERE id = $1", id)
            .execute(&pool).await?;
    }
    Ok(())
}
