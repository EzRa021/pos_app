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
use super::audit::write_audit_log;

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
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

async fn generate_supplier_code(pool: &sqlx::PgPool, store_id: i32) -> AppResult<String> {
    let last: Option<String> = sqlx::query_scalar!(
        "SELECT supplier_code FROM suppliers WHERE store_id = $1 ORDER BY id DESC LIMIT 1",
        store_id
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
    store_id: Option<i32>,
    limit: Option<i64>,
) -> AppResult<Vec<Supplier>> {
    let claims = guard_permission(&state, &token, "suppliers.read").await?;
    let pool   = state.pool().await?;
    let search = format!("%{}%", query.trim());
    let lim    = limit.unwrap_or(10).clamp(1, 50);
    let effective_store_id = if claims.is_global {
        store_id
    } else {
        Some(claims.store_id.ok_or(AppError::Forbidden)?)
    };

    sqlx::query_as!(
        Supplier,
        r#"SELECT id, store_id, supplier_code, supplier_name, contact_name, email, phone,
                  address, city, tax_id, payment_terms, credit_limit, current_balance,
                  is_active, created_at, updated_at
           FROM   suppliers
           WHERE  is_active = TRUE
             AND ($2::int IS NULL OR store_id = $2)
             AND (supplier_name ILIKE $1 OR supplier_code ILIKE $1
                  OR contact_name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1)
           ORDER  BY supplier_name
           LIMIT  $3"#,
        search,
        effective_store_id,
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
    let claims = guard_permission(&state, &token, "suppliers.read").await?;
    let pool = state.pool().await?;
    let supplier = fetch_supplier(&pool, id).await?;
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if supplier.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }
    Ok(supplier)
}

// ── Supplier stats ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SupplierStats {
    pub total_orders:       i64,
    pub completed_orders:   i64,
    pub pending_orders:     i64,
    pub cancelled_orders:   i64,
    pub total_spent:        Decimal,
    pub avg_order_value:    Option<Decimal>,
    /// Average days from ordered_at → received_at across completed POs
    pub avg_lead_time_days: Option<Decimal>,
}

#[derive(Debug, Serialize)]
pub struct SupplierMonthlySpend {
    /// "YYYY-MM"
    pub month:       String,
    pub total:       Decimal,
    pub order_count: i64,
}

#[tauri::command]
pub async fn get_supplier_stats(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<SupplierStats> {
    let claims = guard_permission(&state, &token, "suppliers.read").await?;
    let pool = state.pool().await?;
    let supplier = fetch_supplier(&pool, id).await?;
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if supplier.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    let row = sqlx::query!(
        r#"SELECT
               COUNT(*)                                                                   AS total_orders,
               COUNT(*) FILTER (WHERE status = 'received')                               AS completed_orders,
               COUNT(*) FILTER (WHERE status IN ('pending','approved'))                   AS pending_orders,
               COUNT(*) FILTER (WHERE status = 'cancelled')                              AS cancelled_orders,
               COALESCE(SUM(total_amount) FILTER (WHERE status = 'received'), 0)         AS total_spent,
               AVG(total_amount) FILTER (WHERE status = 'received')                      AS avg_order_value,
               AVG(
                   CASE WHEN received_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM received_at - ordered_at) / 86400.0
                        ELSE NULL END
               )                                                                          AS avg_lead_time_days
           FROM purchase_orders
           WHERE supplier_id = $1
             AND store_id = $2"#,
        id,
        supplier.store_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(SupplierStats {
        total_orders:       row.total_orders.unwrap_or(0),
        completed_orders:   row.completed_orders.unwrap_or(0),
        pending_orders:     row.pending_orders.unwrap_or(0),
        cancelled_orders:   row.cancelled_orders.unwrap_or(0),
        total_spent:        row.total_spent.unwrap_or_default(),
        avg_order_value:    row.avg_order_value,
        avg_lead_time_days: row.avg_lead_time_days,
    })
}

/// Monthly spend breakdown for a single supplier — last 13 months.
/// Used to render the "Spend over time" bar chart on the supplier detail page.
#[tauri::command]
pub async fn get_supplier_spend_timeline(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Vec<SupplierMonthlySpend>> {
    let claims = guard_permission(&state, &token, "suppliers.read").await?;
    let pool = state.pool().await?;
    let supplier = fetch_supplier(&pool, id).await?;
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if supplier.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    let rows = sqlx::query!(
        r#"SELECT
               TO_CHAR(DATE_TRUNC('month', ordered_at), 'YYYY-MM') AS "month!",
               COALESCE(SUM(total_amount), 0)                       AS "total!: Decimal",
               COUNT(*)                                             AS "order_count!: i64"
           FROM   purchase_orders
           WHERE  supplier_id = $1
             AND  store_id = $2
             AND  status IN ('received', 'pending', 'approved', 'partial')
             AND  ordered_at >= NOW() - INTERVAL '13 months'
           GROUP  BY DATE_TRUNC('month', ordered_at)
           ORDER  BY 1 ASC"#,
        id,
        supplier.store_id
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| SupplierMonthlySpend {
            month:       r.month,
            total:       r.total,
            order_count: r.order_count,
        })
        .collect())
}

// ── Create / Update ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_supplier(
    state:   State<'_, AppState>,
    token:   String,
    payload: CreateSupplierDto,
) -> AppResult<Supplier> {
    let claims   = guard_permission(&state, &token, "suppliers.create").await?;
    let pool         = state.pool().await?;
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if payload.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }
    let code         = generate_supplier_code(&pool, payload.store_id).await?;
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

    let supplier = fetch_supplier(&pool, id).await?;
    write_audit_log(&pool, claims.user_id, Some(payload.store_id), "create", "supplier",
        &format!("Created supplier '{}'", payload.supplier_name), "info").await;

    crate::database::sync::queue_row(
        &pool, "suppliers", "INSERT", &id.to_string(),
        serde_json::to_value(&supplier).unwrap_or_else(|_| serde_json::json!({
            "id": supplier.id,
            "store_id": supplier.store_id
        })),
        Some(payload.store_id),
    ).await;

    Ok(supplier)
}

#[tauri::command]
pub async fn update_supplier(
    state:   State<'_, AppState>,
    token:   String,
    id:      i32,
    payload: UpdateSupplierDto,
) -> AppResult<Supplier> {
    let claims   = guard_permission(&state, &token, "suppliers.update").await?;
    let pool         = state.pool().await?;
    let current = fetch_supplier(&pool, id).await?;
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if current.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }
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

    let supplier = fetch_supplier(&pool, id).await?;
    write_audit_log(&pool, claims.user_id, Some(supplier.store_id), "update", "supplier",
        &format!("Updated supplier id {id}"), "info").await;
    crate::database::sync::queue_row(
        &pool, "suppliers", "UPDATE", &id.to_string(),
        serde_json::to_value(&supplier).unwrap_or_else(|_| serde_json::json!({
            "id": supplier.id,
            "store_id": supplier.store_id
        })),
        Some(supplier.store_id),
    ).await;

    Ok(supplier)
}

// ── Activate / Deactivate / Delete ────────────────────────────────────────────

#[tauri::command]
pub async fn activate_supplier(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Supplier> {
    let claims = guard_permission(&state, &token, "suppliers.update").await?;
    let pool = state.pool().await?;
    let supplier = fetch_supplier(&pool, id).await?;
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if supplier.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }
    sqlx::query!("UPDATE suppliers SET is_active = TRUE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool).await?;
    let updated = fetch_supplier(&pool, id).await?;
    write_audit_log(&pool, claims.user_id, Some(updated.store_id), "activate", "supplier",
        &format!("Activated supplier '{}'", updated.supplier_name), "warning").await;
    Ok(updated)
}

#[tauri::command]
pub async fn deactivate_supplier(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<Supplier> {
    let claims = guard_permission(&state, &token, "suppliers.update").await?;
    let pool = state.pool().await?;
    let supplier = fetch_supplier(&pool, id).await?;
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if supplier.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }
    sqlx::query!("UPDATE suppliers SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id)
        .execute(&pool).await?;
    let updated = fetch_supplier(&pool, id).await?;
    write_audit_log(&pool, claims.user_id, Some(updated.store_id), "deactivate", "supplier",
        &format!("Deactivated supplier '{}'", updated.supplier_name), "warning").await;
    Ok(updated)
}

#[derive(Debug, Serialize)]
pub struct DeleteSupplierResult {
    pub deleted: bool,
    pub deactivated: bool,
}

#[tauri::command]
pub async fn delete_supplier(
    state: State<'_, AppState>,
    token: String,
    id:    i32,
) -> AppResult<DeleteSupplierResult> {
    let claims = guard_permission(&state, &token, "suppliers.delete").await?;
    let pool = state.pool().await?;
    let supplier = fetch_supplier(&pool, id).await?;
    if !claims.is_global {
        let user_store = claims.store_id.ok_or(AppError::Forbidden)?;
        if supplier.store_id != user_store {
            return Err(AppError::Forbidden);
        }
    }

    let mut tx = pool.begin().await?;
    let po_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = $1",
        id
    )
    .fetch_one(&mut *tx)
    .await?
    .unwrap_or(0);
    let payment_count: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM supplier_payments WHERE supplier_id = $1",
        id
    )
    .fetch_one(&mut *tx)
    .await?
    .unwrap_or(0);

    let result = if po_count > 0 || payment_count > 0 {
        // Cannot hard delete; soft-delete instead
        sqlx::query!("UPDATE suppliers SET is_active = FALSE, updated_at = NOW() WHERE id = $1", id)
            .execute(&mut *tx).await?;
        DeleteSupplierResult { deleted: false, deactivated: true }
    } else {
        sqlx::query!("DELETE FROM suppliers WHERE id = $1", id)
            .execute(&mut *tx).await?;
        DeleteSupplierResult { deleted: true, deactivated: false }
    };
    tx.commit().await?;

    write_audit_log(&pool, claims.user_id, Some(supplier.store_id), "delete", "supplier",
        &format!("Deleted supplier id {id}"), "warning").await;
    Ok(result)
}
