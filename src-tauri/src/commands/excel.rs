// ============================================================================
// EXCEL IMPORT / EXPORT COMMANDS
// ============================================================================

use tauri::State;
use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use crate::{
    error::{AppError, AppResult},
    state::AppState,
};
use super::auth::guard_permission;

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub total:     usize,
    pub succeeded: usize,
    pub failed:    usize,
    pub errors:    Vec<ImportError>,
}

#[derive(Debug, Serialize)]
pub struct ImportError {
    pub row:     usize,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct ImportItemRow {
    pub sku:           String,
    pub item_name:     String,
    pub category_name: Option<String>,
    pub barcode:       Option<String>,
    pub cost_price:    f64,
    pub selling_price: f64,
    pub initial_qty:   Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct ImportCustomerRow {
    pub first_name: String,
    pub last_name:  String,
    pub email:      Option<String>,
    pub phone:      Option<String>,
    pub address:    Option<String>,
    pub city:       Option<String>,
}

/// Import items from a parsed CSV/Excel payload (frontend parses the file,
/// sends rows as JSON to avoid filesystem complexity in Tauri sandbox).
#[tauri::command]
pub async fn import_items(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    rows:     Vec<ImportItemRow>,
) -> AppResult<ImportResult> {
    guard_permission(&state, &token, "items.create").await?;
    let pool = state.pool().await?;

    let mut succeeded = 0usize;
    let mut errors    = Vec::new();

    for (idx, row) in rows.iter().enumerate() {
        let row_num = idx + 2; // 1-based, row 1 = header

        // Resolve category
        let category_id: Option<i32> = if let Some(ref cat_name) = row.category_name {
            sqlx::query_scalar!(
                "SELECT id FROM categories WHERE store_id = $1 AND category_name ILIKE $2",
                store_id, cat_name
            )
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
        } else {
            None
        };

        let category_id = match category_id {
            Some(id) => id,
            None => {
                errors.push(ImportError {
                    row:     row_num,
                    message: format!("Category '{}' not found", row.category_name.as_deref().unwrap_or("(none)")),
                });
                continue;
            }
        };

        let cost  = Decimal::try_from(row.cost_price).unwrap_or_default();
        let sell  = Decimal::try_from(row.selling_price).unwrap_or_default();
        let qty   = Decimal::try_from(row.initial_qty.unwrap_or(0.0)).unwrap_or_default();

        let result: Result<_, sqlx::Error> = async {
            let item_id: uuid::Uuid = sqlx::query_scalar!(
                r#"INSERT INTO items
                       (store_id, category_id, sku, barcode, item_name, cost_price, selling_price)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)
                   ON CONFLICT (store_id, sku) DO UPDATE
                   SET item_name     = EXCLUDED.item_name,
                       cost_price    = EXCLUDED.cost_price,
                       selling_price = EXCLUDED.selling_price,
                       updated_at    = NOW()
                   RETURNING id"#,
                store_id, category_id, row.sku, row.barcode,
                row.item_name, cost, sell,
            )
            .fetch_one(&pool)
            .await?;

            // Upsert settings
            sqlx::query!(
                r#"INSERT INTO item_settings (item_id, store_id)
                   VALUES ($1, $2)
                   ON CONFLICT (item_id) DO NOTHING"#,
                item_id, store_id,
            )
            .execute(&pool)
            .await?;

            // Upsert stock
            sqlx::query!(
                r#"INSERT INTO item_stock (item_id, store_id, quantity, available_quantity)
                   VALUES ($1,$2,$3,$3)
                   ON CONFLICT (item_id, store_id) DO NOTHING"#,
                item_id, store_id, qty,
            )
            .execute(&pool)
            .await?;

            Ok(())
        }.await;

        match result {
            Ok(_)  => succeeded += 1,
            Err(e) => errors.push(ImportError { row: row_num, message: e.to_string() }),
        }
    }

    Ok(ImportResult {
        total:  rows.len(),
        succeeded,
        failed: errors.len(),
        errors,
    })
}

/// Import customers from parsed rows.
#[tauri::command]
pub async fn import_customers(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    rows:     Vec<ImportCustomerRow>,
) -> AppResult<ImportResult> {
    guard_permission(&state, &token, "customers.create").await?;
    let pool = state.pool().await?;

    let mut succeeded = 0usize;
    let mut errors    = Vec::new();

    for (idx, row) in rows.iter().enumerate() {
        let row_num = idx + 2;

        let result: Result<_, sqlx::Error> = sqlx::query!(
            r#"INSERT INTO customers (store_id, first_name, last_name, email, phone, address, city)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT DO NOTHING"#,
            store_id, row.first_name, row.last_name,
            row.email, row.phone, row.address, row.city,
        )
        .execute(&pool)
        .await
        .map(|_| ());

        match result {
            Ok(_)  => succeeded += 1,
            Err(e) => errors.push(ImportError { row: row_num, message: e.to_string() }),
        }
    }

    Ok(ImportResult {
        total:  rows.len(),
        succeeded,
        failed: errors.len(),
        errors,
    })
}

/// Export items for a store as structured JSON (frontend renders to Excel/CSV).
#[tauri::command]
pub async fn export_items(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<serde_json::Value>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;

    let rows = sqlx::query!(
        r#"SELECT i.sku, i.barcode, i.item_name, i.description,
                  i.cost_price, i.selling_price, i.discount_price,
                  c.category_name, d.department_name,
                  ist.is_active, ist.sellable, ist.available_for_pos, ist.track_stock,
                  ist.min_stock_level,
                  COALESCE(istock.quantity, 0) AS quantity
           FROM   items i
           LEFT JOIN categories  c     ON c.id = i.category_id
           LEFT JOIN departments d     ON d.id = i.department_id
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE  i.store_id = $1
           ORDER  BY i.item_name"#,
        store_id
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "sku":              r.sku,
        "barcode":          r.barcode,
        "item_name":        r.item_name,
        "description":      r.description,
        "cost_price":       r.cost_price,
        "selling_price":    r.selling_price,
        "discount_price":   r.discount_price,
        "category":         r.category_name,
        "department":       r.department_name,
        "is_active":        r.is_active,
        "track_stock":      r.track_stock,
        "min_stock_level":  r.min_stock_level,
        "quantity":         r.quantity,
    })).collect();

    Ok(result)
}

/// Export customers for a store as structured JSON.
#[tauri::command]
pub async fn export_customers(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<serde_json::Value>> {
    guard_permission(&state, &token, "customers.read").await?;
    let pool = state.pool().await?;

    let rows = sqlx::query!(
        r#"SELECT first_name, last_name, email, phone, address, city,
                  credit_limit, outstanding_balance, loyalty_points,
                  is_active, created_at
           FROM   customers
           WHERE  store_id = $1
           ORDER  BY last_name, first_name"#,
        store_id
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "first_name":          r.first_name,
        "last_name":           r.last_name,
        "email":               r.email,
        "phone":               r.phone,
        "address":             r.address,
        "city":                r.city,
        "credit_limit":        r.credit_limit,
        "outstanding_balance": r.outstanding_balance,
        "loyalty_points":      r.loyalty_points,
        "is_active":           r.is_active,
        "created_at":          r.created_at,
    })).collect();

    Ok(result)
}

/// Export expenses for a store as structured JSON.
#[tauri::command]
pub async fn export_expenses(
    state:     State<'_, AppState>,
    token:     String,
    store_id:  i32,
    date_from: Option<String>,
    date_to:   Option<String>,
) -> AppResult<Vec<serde_json::Value>> {
    guard_permission(&state, &token, "expenses.read").await?;
    let pool = state.pool().await?;
    let df   = date_from.as_deref();
    let dt   = date_to.as_deref();

    let rows = sqlx::query!(
        r#"SELECT e.expense_type, e.category, e.description, e.amount,
                  e.payment_method, e.payment_status, e.approval_status,
                  e.expense_date, e.reference_number, e.paid_to,
                  e.is_recurring, e.is_deductible, e.notes,
                  CONCAT(u.first_name, ' ', u.last_name) AS recorded_by_name
           FROM   expenses e
           LEFT JOIN users u ON u.id = e.recorded_by
           WHERE  e.store_id   = $1
             AND  e.deleted_at IS NULL
             AND ($2::text IS NULL OR e.expense_date >= $2::timestamptz)
             AND ($3::text IS NULL OR e.expense_date <= $3::timestamptz)
           ORDER  BY e.expense_date DESC"#,
        store_id, df, dt
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "expense_type":    r.expense_type,
        "category":        r.category,
        "description":     r.description,
        "amount":          r.amount,
        "payment_method":  r.payment_method,
        "payment_status":  r.payment_status,
        "approval_status": r.approval_status,
        "expense_date":    r.expense_date,
        "reference_number":r.reference_number,
        "paid_to":         r.paid_to,
        "is_recurring":    r.is_recurring,
        "is_deductible":   r.is_deductible,
        "notes":           r.notes,
        "recorded_by":     r.recorded_by_name,
    })).collect();

    Ok(result)
}

/// Export transactions for a store as structured JSON.
#[tauri::command]
pub async fn export_transactions(
    state:     State<'_, AppState>,
    token:     String,
    store_id:  i32,
    date_from: Option<String>,
    date_to:   Option<String>,
) -> AppResult<Vec<serde_json::Value>> {
    guard_permission(&state, &token, "transactions.read").await?;
    let pool = state.pool().await?;
    let df   = date_from.as_deref();
    let dt   = date_to.as_deref();

    let rows = sqlx::query!(
        r#"SELECT t.reference_no, t.created_at, t.payment_method,
                  t.subtotal, t.discount_amount, t.tax_amount, t.total_amount,
                  t.status,
                  CONCAT(u.first_name, ' ', u.last_name) AS cashier_name,
                  CONCAT(c.first_name, ' ', c.last_name) AS customer_name
           FROM   transactions t
           LEFT JOIN users     u ON u.id = t.cashier_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE  t.store_id = $1
             AND ($2::text IS NULL OR t.created_at >= $2::timestamptz)
             AND ($3::text IS NULL OR t.created_at <= $3::timestamptz)
           ORDER  BY t.created_at DESC"#,
        store_id, df, dt
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "reference_no":     r.reference_no,
        "date":             r.created_at,
        "cashier":          r.cashier_name,
        "customer":         r.customer_name,
        "payment_method":   r.payment_method,
        "subtotal":         r.subtotal,
        "discount":         r.discount_amount,
        "tax":              r.tax_amount,
        "total":            r.total_amount,
        "status":           r.status,
    })).collect();

    Ok(result)
}
