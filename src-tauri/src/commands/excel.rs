// ============================================================================
// EXCEL IMPORT / EXPORT COMMANDS
// ============================================================================
// Import: frontend parses Excel with SheetJS, sends rows[] as JSON.
// Export: backend returns JSON; frontend converts to Excel with SheetJS.
//
// Design notes:
//   • Every row write (create or update) is wrapped in its own DB transaction
//     so a partial failure never leaves orphaned records.
//   • Departments and categories are auto-created when not found; if they exist
//     but are inactive they are reactivated rather than silently linked.
//   • The same SKU appearing twice in one batch is detected and the second
//     occurrence is rejected with a clear error message.
// ============================================================================

use std::collections::{HashMap, HashSet};
use tauri::State;
use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use uuid::Uuid;
use crate::{
    error::AppResult,
    state::AppState,
};
use super::auth::guard_permission;
use crate::utils::ref_no::{next_item_sku, store_slug};

fn to_dec(v: f64) -> Decimal {
    Decimal::try_from(v).unwrap_or_default()
}

// ── Result types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub total:               usize,
    pub created:             usize,
    pub updated:             usize,
    pub failed:              usize,
    pub dry_run:             bool,
    pub errors:              Vec<ImportError>,
    pub created_departments: Vec<String>,
    pub created_categories:  Vec<String>,
    pub reactivated_departments: Vec<String>,
    pub reactivated_categories:  Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ImportError {
    pub row:     usize,
    pub sku:     String,
    pub action:  String,
    pub message: String,
}

// ── Stock-count result (simpler than full ImportResult) ───────────────────────
#[derive(Debug, Serialize)]
pub struct StockCountResult {
    pub total:   usize,
    pub updated: usize,
    pub failed:  usize,
    pub errors:  Vec<ImportError>,
}

// ── Item row — every column the user can supply in the spreadsheet ─────────────

#[derive(Debug, Deserialize)]
pub struct ImportItemRow {
    // ── Identity ─────────────────────────────────────────────────────────────
    /// "create" | "update" | absent → auto-detected from whether SKU already exists
    pub action:            Option<String>,
    /// Used for UPDATE row matching and batch duplicate detection.
    /// May be null/absent on CREATE rows — the system auto-generates the SKU.
    pub sku:               Option<String>,

    // ── Core ─────────────────────────────────────────────────────────────────
    pub item_name:         Option<String>,
    pub barcode:           Option<String>,
    pub description:       Option<String>,

    // ── Taxonomy (auto-created if the name is not found in the DB) ────────────
    pub department_name:   Option<String>,
    pub category_name:     Option<String>,

    // ── Pricing ───────────────────────────────────────────────────────────────
    pub selling_price:     Option<f64>,
    pub cost_price:        Option<f64>,
    pub discount_price:    Option<f64>,

    // ── Settings ─────────────────────────────────────────────────────────────
    pub is_active:         Option<bool>,
    pub track_stock:       Option<bool>,
    pub sellable:          Option<bool>,
    pub available_for_pos: Option<bool>,
    pub taxable:           Option<bool>,
    pub allow_discount:    Option<bool>,
    pub measurement_type:  Option<String>,
    pub unit_type:         Option<String>,
    pub min_stock_level:   Option<i32>,
    pub max_stock_level:   Option<i32>,

    // ── Stock ─────────────────────────────────────────────────────────────────
    /// Create → initial stock.   Update → SET stock to this exact value.
    pub quantity:          Option<f64>,
    /// Update only → ADD this amount to current stock (negative to subtract).
    pub stock_adjustment:  Option<f64>,
}

// ── Stock-count row ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StockCountRow {
    pub sku:      String,
    pub quantity: f64,
    pub notes:    Option<String>,
}

// ── Customer import row ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ImportCustomerRow {
    pub first_name: String,
    pub last_name:  String,
    pub email:      Option<String>,
    pub phone:      Option<String>,
    pub address:    Option<String>,
    pub city:       Option<String>,
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Find or create a department by name for the given store.
/// If the department exists but is inactive, it is reactivated.
/// Uses a `cache` to avoid extra DB round-trips within a single import.
async fn resolve_department(
    pool:        &sqlx::PgPool,
    cache:       &mut HashMap<String, i32>,
    created:     &mut Vec<String>,
    reactivated: &mut Vec<String>,
    name:        &str,
    store_id:    i32,
    dry_run:     bool,
) -> AppResult<Option<i32>> {
    let name = name.trim();
    if name.is_empty() { return Ok(None); }
    let key = name.to_lowercase();

    if let Some(&id) = cache.get(&key) {
        return Ok(Some(id));
    }

    // DB lookup — include inactive so we can reactivate instead of duplicating
    let row = sqlx::query!(
        r#"SELECT id, is_active FROM departments
           WHERE LOWER(department_name) = LOWER($1)
             AND (store_id = $2 OR store_id IS NULL)
           ORDER BY store_id NULLS LAST
           LIMIT 1"#,
        name, store_id
    )
    .fetch_optional(pool)
    .await?;

    if let Some(r) = row {
        // Reactivate if inactive (and not a dry run)
        if !r.is_active && !dry_run {
            sqlx::query!(
                "UPDATE departments SET is_active = TRUE, updated_at = NOW() WHERE id = $1",
                r.id
            )
            .execute(pool)
            .await?;
            reactivated.push(name.to_string());
        }
        cache.insert(key, r.id);
        return Ok(Some(r.id));
    }

    if dry_run {
        return Ok(Some(-1)); // sentinel — won't be persisted
    }

    let new_id: i32 = sqlx::query_scalar!(
        "INSERT INTO departments (department_name, store_id, is_active) VALUES ($1, $2, TRUE) RETURNING id",
        name, store_id
    )
    .fetch_one(pool)
    .await?;

    cache.insert(key, new_id);
    created.push(name.to_string());
    Ok(Some(new_id))
}

/// Find or create a category by name for the given store.
/// If it exists but is inactive, it is reactivated.
async fn resolve_category(
    pool:        &sqlx::PgPool,
    cache:       &mut HashMap<String, i32>,
    created:     &mut Vec<String>,
    reactivated: &mut Vec<String>,
    name:        &str,
    store_id:    i32,
    dept_id:     Option<i32>,
    dry_run:     bool,
) -> AppResult<Option<i32>> {
    let name = name.trim();
    if name.is_empty() { return Ok(None); }
    let key = name.to_lowercase();

    if let Some(&id) = cache.get(&key) {
        return Ok(Some(id));
    }

    let row = sqlx::query!(
        "SELECT id, is_active FROM categories WHERE LOWER(category_name) = LOWER($1) AND store_id = $2 LIMIT 1",
        name, store_id
    )
    .fetch_optional(pool)
    .await?;

    if let Some(r) = row {
        if !r.is_active && !dry_run {
            sqlx::query!(
                "UPDATE categories SET is_active = TRUE, updated_at = NOW() WHERE id = $1",
                r.id
            )
            .execute(pool)
            .await?;
            reactivated.push(name.to_string());
        }
        cache.insert(key, r.id);
        return Ok(Some(r.id));
    }

    if dry_run {
        return Ok(Some(-1));
    }

    let real_dept = if dept_id == Some(-1) { None } else { dept_id };

    let new_id: i32 = sqlx::query_scalar!(
        r#"INSERT INTO categories
               (category_name, store_id, department_id, is_active, is_visible_in_pos)
           VALUES ($1, $2, $3, TRUE, TRUE)
           RETURNING id"#,
        name, store_id, real_dept
    )
    .fetch_one(pool)
    .await?;

    cache.insert(key, new_id);
    created.push(name.to_string());
    Ok(Some(new_id))
}

// ── import_items ──────────────────────────────────────────────────────────────

/// Import items from a pre-parsed list of rows.
///
/// Each row write (INSERT or UPDATE) is wrapped in its own transaction so a
/// mid-row failure can never leave orphaned records.
///
/// Duplicate SKUs within the same batch are detected and the second occurrence
/// is rejected with a clear error message.
///
/// If `dry_run` is true the function validates every row and resolves
/// departments/categories, but does NOT write anything to the database.
#[tauri::command]
pub async fn import_items(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    rows:     Vec<ImportItemRow>,
    dry_run:  Option<bool>,
) -> AppResult<ImportResult> {
    let claims  = guard_permission(&state, &token, "items.create").await?;
    let pool    = state.pool().await?;
    let dry_run = dry_run.unwrap_or(false);

    // ── Resolve store slug once — used to auto-generate SKUs for new rows ──────
    let store_row = sqlx::query!(
        "SELECT store_name, store_code FROM stores WHERE id = $1",
        store_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| crate::error::AppError::Validation(
        format!("Store {} not found", store_id)
    ))?;
    let slug = store_slug(store_row.store_code.as_deref(), &store_row.store_name);

    // ── Pre-load existing SKUs ────────────────────────────────────────────────
    let mut sku_map: HashMap<String, Uuid> = {
        let rows = sqlx::query!(
            "SELECT id, sku FROM items WHERE store_id = $1",
            store_id
        )
        .fetch_all(&pool)
        .await?;
        rows.into_iter().map(|r| (r.sku.to_lowercase(), r.id)).collect()
    };

    // ── Pre-load taxonomy caches ──────────────────────────────────────────────
    let dept_raw = sqlx::query!(
        "SELECT id, department_name FROM departments WHERE store_id = $1 OR store_id IS NULL",
        store_id
    )
    .fetch_all(&pool)
    .await?;
    let mut dept_cache: HashMap<String, i32> = dept_raw.into_iter()
        .map(|r| (r.department_name.to_lowercase(), r.id))
        .collect();

    let cat_raw = sqlx::query!(
        "SELECT id, category_name FROM categories WHERE store_id = $1",
        store_id
    )
    .fetch_all(&pool)
    .await?;
    let mut cat_cache: HashMap<String, i32> = cat_raw.into_iter()
        .map(|r| (r.category_name.to_lowercase(), r.id))
        .collect();

    // ── Process rows ──────────────────────────────────────────────────────────
    let mut created             = 0usize;
    let mut updated             = 0usize;
    let mut errors: Vec<ImportError>  = Vec::new();
    let mut new_depts: Vec<String>    = Vec::new();
    let mut new_cats:  Vec<String>    = Vec::new();
    let mut reactiv_depts: Vec<String> = Vec::new();
    let mut reactiv_cats:  Vec<String> = Vec::new();

    // Track SKUs seen in THIS batch to detect duplicates within the same file
    let mut batch_seen: HashSet<String> = HashSet::new();

    const VALID_MEASUREMENT_TYPES: &[&str] = &["quantity", "weight", "volume", "length"];

    for (idx, row) in rows.iter().enumerate() {
        let row_num = idx + 2;
        // SKU is optional — null/blank is fine for creates (auto-generated)
        let sku = row.sku.as_deref().unwrap_or("").trim().to_string();
        // Unique key for batch dedup: use sku if present, else a positional sentinel
        let batch_key = if sku.is_empty() {
            format!("__row_{}", row_num)
        } else {
            sku.to_lowercase()
        };

        macro_rules! fail {
            ($action:expr, $msg:expr) => {{
                errors.push(ImportError {
                    row: row_num, sku: sku.clone(),
                    action: $action.to_string(),
                    message: $msg.to_string(),
                });
                continue;
            }};
        }

        let action_hint = row.action.as_deref().map(|s| s.trim().to_lowercase());

        // UPDATE rows must supply a SKU so we can look up the existing item
        if action_hint.as_deref() == Some("update") && sku.is_empty() {
            errors.push(ImportError {
                row: row_num, sku: String::new(),
                action: "update".into(),
                message: "SKU is required for update rows".into(),
            });
            continue;
        }

        if let Some(ref mt) = row.measurement_type {
            if !VALID_MEASUREMENT_TYPES.contains(&mt.to_lowercase().as_str()) {
                fail!("unknown",
                    format!("Invalid measurement_type '{}'. Valid: quantity, weight, volume, length", mt));
            }
        }

        // ── Duplicate SKU within same batch (only for rows that carry a SKU) ──
        let sku_lower = sku.to_lowercase();
        if !sku.is_empty() && batch_seen.contains(&sku_lower) {
            fail!("unknown",
                format!("SKU '{}' appears more than once in this file. Each SKU may only appear once per import.", sku));
        }
        batch_seen.insert(batch_key);

        // ── Detect action ────────────────────────────────────────────────────
        let existing_id = if sku.is_empty() { None } else { sku_map.get(&sku_lower).copied() };
        let action = match action_hint.as_deref() {
            Some("create") => "create",
            Some("update") => "update",
            _              => if existing_id.is_some() { "update" } else { "create" },
        }.to_string();

        // ── Action-specific validation ────────────────────────────────────────
        if action == "create" {
            if existing_id.is_some() {
                fail!(action,
                    format!("SKU '{}' already exists. Set action to 'update' to modify it.", sku));
            }
            if row.item_name.as_deref().map(str::trim).unwrap_or("").is_empty() {
                fail!(action, "item_name is required for new items");
            }
            if row.selling_price.map_or(true, |v| v <= 0.0) {
                fail!(action, "selling_price is required and must be > 0 for new items");
            }
            if row.quantity.is_some() && row.stock_adjustment.is_some() {
                fail!(action, "Provide 'quantity' (initial stock) OR 'stock_adjustment', not both");
            }
        } else {
            if existing_id.is_none() {
                fail!(action,
                    format!("SKU '{}' not found. Set action to 'create' to add it.", sku));
            }
            if row.quantity.is_some() && row.stock_adjustment.is_some() {
                fail!(action, "Provide 'quantity' (set exact) or 'stock_adjustment' (add/subtract), not both");
            }
        }

        // ── Resolve / auto-create department ─────────────────────────────────
        let dept_name_opt = row.department_name.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let dept_id = match dept_name_opt {
            None => None,
            Some(name) => match resolve_department(
                &pool, &mut dept_cache, &mut new_depts, &mut reactiv_depts,
                name, store_id, dry_run,
            ).await {
                Ok(id) => id,
                Err(e) => fail!(action, format!("Department '{}' resolution failed: {}", name, e)),
            },
        };

        // ── Resolve / auto-create category ────────────────────────────────────
        let cat_name_opt = row.category_name.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let cat_id = match cat_name_opt {
            None => None,
            Some(name) => match resolve_category(
                &pool, &mut cat_cache, &mut new_cats, &mut reactiv_cats,
                name, store_id, dept_id, dry_run,
            ).await {
                Ok(id) => id,
                Err(e) => fail!(action, format!("Category '{}' resolution failed: {}", name, e)),
            },
        };

        if dry_run {
            if action == "create" { created += 1; } else { updated += 1; }
            continue;
        }

        // Sanitise dry-run sentinels
        let real_dept = dept_id.filter(|&id| id > 0);
        let real_cat  = cat_id.filter(|&id| id > 0);

        // For CREATE: auto-generate the SKU — user's sku column is only used
        // for batch duplicate detection and error reporting, not stored.
        let (row_result, generated_sku): (Result<(), String>, Option<String>) =
            if action == "create" {
                match create_item_from_row(
                    &pool, row, store_id, real_cat, real_dept, claims.user_id, &slug,
                ).await {
                    Ok(gen_sku) => (Ok(()), Some(gen_sku)),
                    Err(e)      => (Err(e), None),
                }
            } else {
                let item_id = existing_id.unwrap();
                (
                    update_item_from_row(
                        &pool, row, &sku, item_id, store_id, real_cat, real_dept, claims.user_id,
                    ).await,
                    None,
                )
            };

        match row_result {
            Ok(()) => {
                if action == "create" {
                    // Register the generated SKU in sku_map so it can be found
                    // if referenced later in the same batch.
                    if let Some(ref gen_sku) = generated_sku {
                        if let Ok(new_id) = sqlx::query_scalar!(
                            "SELECT id FROM items WHERE store_id = $1 AND sku = $2",
                            store_id, gen_sku
                        ).fetch_one(&pool).await {
                            sku_map.insert(gen_sku.to_lowercase(), new_id);
                        }
                    }
                    created += 1;
                } else {
                    updated += 1;
                }
            }
            Err(msg) => {
                errors.push(ImportError { row: row_num, sku, action, message: msg });
            }
        }
    }

    Ok(ImportResult {
        total:               rows.len(),
        created,
        updated,
        failed:              errors.len(),
        dry_run,
        errors,
        created_departments:     new_depts,
        created_categories:      new_cats,
        reactivated_departments: reactiv_depts,
        reactivated_categories:  reactiv_cats,
    })
}

// ── Per-row write helpers — each wrapped in its own transaction ───────────────

async fn create_item_from_row(
    pool:     &sqlx::PgPool,
    row:      &ImportItemRow,
    store_id: i32,
    cat_id:   Option<i32>,
    dept_id:  Option<i32>,
    user_id:  i32,
    slug:     &str,
) -> Result<String, String> {
    // Auto-generate the unique SKU — user-supplied SKU in the spreadsheet is
    // only used as a row identifier; the system always assigns the real SKU.
    let sku = next_item_sku(pool, store_id, slug).await;

    // Barcode uniqueness — scoped to this store only
    if let Some(ref bc) = row.barcode {
        let bc = bc.trim();
        if !bc.is_empty() {
            let taken: bool = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM items WHERE barcode = $1 AND store_id = $2)", bc, store_id
            )
            .fetch_one(pool).await.map_err(|e| e.to_string())?
            .unwrap_or(false);
            if taken {
                return Err(format!("Barcode '{}' is already used by another item in this store", bc));
            }
        }
    }

    let cost   = to_dec(row.cost_price.unwrap_or(0.0));
    let sell   = to_dec(row.selling_price.unwrap_or(0.0));
    let disc   = row.discount_price.map(to_dec);
    let qty    = to_dec(row.quantity.unwrap_or(0.0));
    let bc_val = row.barcode.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let name   = row.item_name.as_deref().unwrap_or("").trim();
    let desc   = row.description.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let mt     = row.measurement_type.as_deref().unwrap_or("quantity");

    // ── Wrap all inserts in a single transaction ──────────────────────────────
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let item_id: Uuid = sqlx::query_scalar!(
        r#"INSERT INTO items
               (store_id, category_id, department_id, sku, barcode,
                item_name, description, cost_price, selling_price, discount_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id"#,
        store_id, cat_id, dept_id, sku, bc_val, name, desc, cost, sell, disc,
    )
    .fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;

    sqlx::query!(
        r#"INSERT INTO item_settings
               (item_id, store_id,
                is_active, sellable, available_for_pos, track_stock,
                taxable, allow_discount, measurement_type, unit_type,
                min_stock_level, max_stock_level)
           VALUES ($1,$2,
                   COALESCE($3,TRUE), COALESCE($4,TRUE), COALESCE($5,TRUE), COALESCE($6,TRUE),
                   COALESCE($7,FALSE), COALESCE($8,TRUE), $9, $10,
                   COALESCE($11,0), COALESCE($12,1000000))"#,
        item_id, store_id,
        row.is_active, row.sellable, row.available_for_pos, row.track_stock,
        row.taxable, row.allow_discount, mt, row.unit_type,
        row.min_stock_level, row.max_stock_level,
    )
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    sqlx::query!(
        "INSERT INTO item_stock (item_id, store_id, quantity, available_quantity) VALUES ($1,$2,$3,$3)",
        item_id, store_id, qty,
    )
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    sqlx::query!(
        r#"INSERT INTO item_history
               (item_id, store_id, event_type, event_description,
                quantity_before, quantity_after, quantity_change, performed_by)
           VALUES ($1,$2,'CREATE','Created via Excel import', 0,$3,$3,$4)"#,
        item_id, store_id, qty, user_id,
    )
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    // Return the generated SKU so the caller can register it in sku_map
    Ok(sku)
}

async fn update_item_from_row(
    pool:     &sqlx::PgPool,
    row:      &ImportItemRow,
    _sku:     &str,
    item_id:  Uuid,
    store_id: i32,
    cat_id:   Option<i32>,
    dept_id:  Option<i32>,
    user_id:  i32,
) -> Result<(), String> {
    // Barcode uniqueness — scoped to this store, excluding this item
    if let Some(ref bc) = row.barcode {
        let bc = bc.trim();
        if !bc.is_empty() {
            let taken: bool = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM items WHERE barcode = $1 AND id != $2 AND store_id = $3)",
                bc, item_id, store_id
            )
            .fetch_one(pool).await.map_err(|e| e.to_string())?
            .unwrap_or(false);
            if taken {
                return Err(format!("Barcode '{}' is already used by another item in this store", bc));
            }
        }
    }

    let cost   = row.cost_price.map(to_dec);
    let sell   = row.selling_price.map(to_dec);
    let disc   = row.discount_price.map(to_dec);
    let bc_val = row.barcode.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let name   = row.item_name.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let desc   = row.description.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let mt     = row.measurement_type.as_deref().map(str::to_lowercase);
    let mt_ref = mt.as_deref();

    // ── Wrap all updates in a single transaction ──────────────────────────────
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query!(
        r#"UPDATE items SET
           category_id    = COALESCE($1,  category_id),
           department_id  = COALESCE($2,  department_id),
           barcode        = COALESCE($3,  barcode),
           item_name      = COALESCE($4,  item_name),
           description    = COALESCE($5,  description),
           cost_price     = COALESCE($6,  cost_price),
           selling_price  = COALESCE($7,  selling_price),
           discount_price = COALESCE($8,  discount_price),
           updated_at     = NOW()
           WHERE id = $9"#,
        cat_id, dept_id, bc_val, name, desc, cost, sell, disc, item_id,
    )
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    sqlx::query!(
        r#"UPDATE item_settings SET
           is_active         = COALESCE($1,  is_active),
           sellable          = COALESCE($2,  sellable),
           available_for_pos = COALESCE($3,  available_for_pos),
           track_stock       = COALESCE($4,  track_stock),
           taxable           = COALESCE($5,  taxable),
           allow_discount    = COALESCE($6,  allow_discount),
           measurement_type  = COALESCE($7,  measurement_type),
           unit_type         = COALESCE($8,  unit_type),
           min_stock_level   = COALESCE($9,  min_stock_level),
           max_stock_level   = COALESCE($10, max_stock_level),
           updated_at        = NOW()
           WHERE item_id = $11"#,
        row.is_active, row.sellable, row.available_for_pos,
        row.track_stock, row.taxable, row.allow_discount,
        mt_ref, row.unit_type,
        row.min_stock_level, row.max_stock_level,
        item_id,
    )
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    // Stock: SET or ADJUST
    if let Some(qty_val) = row.quantity {
        let new_qty = to_dec(qty_val);
        if new_qty < Decimal::ZERO {
            tx.rollback().await.ok();
            return Err(format!("quantity cannot be negative (got {})", qty_val));
        }
        // Use quantity - reserved_quantity for available_quantity
        sqlx::query!(
            r#"UPDATE item_stock
               SET quantity           = $1,
                   available_quantity = GREATEST(0, $1 - COALESCE(reserved_quantity, 0)),
                   updated_at         = NOW()
               WHERE item_id = $2 AND store_id = $3"#,
            new_qty, item_id, store_id,
        )
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description, quantity_after, performed_by)
               VALUES ($1,$2,'IMPORT_STOCK_SET','Stock set via Excel import',$3,$4)"#,
            item_id, store_id, new_qty, user_id,
        )
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    } else if let Some(adj_val) = row.stock_adjustment {
        let adj = to_dec(adj_val);

        let current: Decimal = sqlx::query_scalar!(
            "SELECT COALESCE(quantity, 0) FROM item_stock WHERE item_id = $1 AND store_id = $2",
            item_id, store_id
        )
        .fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?
        .flatten()
        .unwrap_or_default();

        if current + adj < Decimal::ZERO {
            tx.rollback().await.ok();
            return Err(format!(
                "stock_adjustment of {} would result in negative stock (current: {})",
                adj_val, current
            ));
        }

        sqlx::query!(
            r#"UPDATE item_stock
               SET quantity           = quantity + $1,
                   available_quantity = GREATEST(0, available_quantity + $1),
                   updated_at         = NOW()
               WHERE item_id = $2 AND store_id = $3"#,
            adj, item_id, store_id,
        )
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;

        sqlx::query!(
            r#"INSERT INTO item_history
                   (item_id, store_id, event_type, event_description, quantity_change, performed_by)
               VALUES ($1,$2,'IMPORT_STOCK_ADJ','Stock adjusted via Excel import',$3,$4)"#,
            item_id, store_id, adj, user_id,
        )
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }

    sqlx::query!(
        r#"INSERT INTO item_history
               (item_id, store_id, event_type, event_description, performed_by)
           VALUES ($1,$2,'IMPORT_UPDATE','Updated via Excel import',$3)"#,
        item_id, store_id, user_id,
    )
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

// ── import_stock_count ────────────────────────────────────────────────────────
//
// Simpler "stock take" import: only SKU + quantity columns.
// Every row is treated as an UPDATE (set stock to exact quantity).
// No item creation, no taxonomy changes — much safer for regular stock counts.

async fn apply_stock_count_row(
    pool:     &sqlx::PgPool,
    item_id:  Uuid,
    store_id: i32,
    new_qty:  Decimal,
    user_id:  i32,
    notes:    &str,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query!(
        r#"UPDATE item_stock
           SET quantity           = $1,
               available_quantity = GREATEST(0, $1 - COALESCE(reserved_quantity, 0)),
               updated_at         = NOW()
           WHERE item_id = $2 AND store_id = $3"#,
        new_qty, item_id, store_id,
    )
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    sqlx::query!(
        r#"INSERT INTO item_history
               (item_id, store_id, event_type, event_description, quantity_after, performed_by, notes)
           VALUES ($1,$2,'STOCK_COUNT','Stock count via Excel',$3,$4,$5)"#,
        item_id, store_id, new_qty, user_id, notes,
    )
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn import_stock_count(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    rows:     Vec<StockCountRow>,
    dry_run:  Option<bool>,
) -> AppResult<StockCountResult> {
    let claims  = guard_permission(&state, &token, "inventory.adjust").await?;
    let pool    = state.pool().await?;
    let dry_run = dry_run.unwrap_or(false);

    let sku_map: HashMap<String, Uuid> = {
        let db_rows = sqlx::query!(
            "SELECT id, sku FROM items WHERE store_id = $1",
            store_id
        )
        .fetch_all(&pool)
        .await?;
        db_rows.into_iter().map(|r| (r.sku.to_lowercase(), r.id)).collect()
    };

    let mut batch_seen: HashSet<String> = HashSet::new();
    let mut updated = 0usize;
    let mut errors: Vec<ImportError> = Vec::new();

    for (idx, row) in rows.iter().enumerate() {
        let row_num   = idx + 2;
        let sku       = row.sku.trim().to_string();
        let sku_lower = sku.to_lowercase();

        macro_rules! fail {
            ($msg:expr) => {{
                errors.push(ImportError {
                    row: row_num, sku: sku.clone(),
                    action: "stock_count".into(),
                    message: $msg.to_string(),
                });
                continue;
            }};
        }

        if sku.is_empty() { fail!("SKU is required"); }

        if batch_seen.contains(&sku_lower) {
            fail!(format!("SKU '{}' appears more than once in this file", sku));
        }
        batch_seen.insert(sku_lower.clone());

        let item_id = match sku_map.get(&sku_lower) {
            Some(&id) => id,
            None      => fail!(format!("SKU '{}' not found in this store", sku)),
        };

        if row.quantity < 0.0 {
            fail!(format!("quantity cannot be negative (got {})", row.quantity));
        }

        if dry_run { updated += 1; continue; }

        let new_qty = to_dec(row.quantity);
        let notes   = row.notes.as_deref().unwrap_or("Stock count import");

        match apply_stock_count_row(&pool, item_id, store_id, new_qty, claims.user_id, notes).await {
            Ok(_)    => updated += 1,
            Err(msg) => errors.push(ImportError {
                row: row_num, sku, action: "stock_count".into(), message: msg,
            }),
        }
    }

    Ok(StockCountResult {
        total:   rows.len(),
        updated,
        failed:  errors.len(),
        errors,
    })
}

// ── import_customers ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn import_customers(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
    rows:     Vec<ImportCustomerRow>,
) -> AppResult<ImportResult> {
    guard_permission(&state, &token, "customers.create").await?;
    let pool = state.pool().await?;

    let mut created = 0usize;
    let mut errors: Vec<ImportError> = Vec::new();

    for (idx, row) in rows.iter().enumerate() {
        let row_num = idx + 2;

        if row.first_name.trim().is_empty() || row.last_name.trim().is_empty() {
            errors.push(ImportError {
                row: row_num, sku: String::new(), action: "create".into(),
                message: "first_name and last_name are required".into(),
            });
            continue;
        }

        let result = sqlx::query!(
            r#"INSERT INTO customers (store_id, first_name, last_name, email, phone, address, city)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT DO NOTHING"#,
            store_id, row.first_name.trim(), row.last_name.trim(),
            row.email, row.phone, row.address, row.city,
        )
        .execute(&pool)
        .await;

        match result {
            Ok(_)  => created += 1,
            Err(e) => errors.push(ImportError {
                row: row_num, sku: String::new(),
                action: "create".into(), message: e.to_string(),
            }),
        }
    }

    Ok(ImportResult {
        total: rows.len(), created, updated: 0,
        failed: errors.len(), dry_run: false, errors,
        created_departments: Vec::new(), created_categories: Vec::new(),
        reactivated_departments: Vec::new(), reactivated_categories: Vec::new(),
    })
}

// ── export_items ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_items(
    state:    State<'_, AppState>,
    token:    String,
    store_id: i32,
) -> AppResult<Vec<serde_json::Value>> {
    export_items_filtered(state, token, store_id, None, None, None, None).await
}

// ── export_items_filtered ─────────────────────────────────────────────────────
//
// Exports items matching optional filters so the user can download a subset
// (e.g. only electronics, only low-stock items, only active items).

#[tauri::command]
pub async fn export_items_filtered(
    state:         State<'_, AppState>,
    token:         String,
    store_id:      i32,
    department_id: Option<i32>,
    category_id:   Option<i32>,
    is_active:     Option<bool>,
    low_stock:     Option<bool>,
) -> AppResult<Vec<serde_json::Value>> {
    guard_permission(&state, &token, "items.read").await?;
    let pool = state.pool().await?;

    let rows = sqlx::query!(
        r#"SELECT
               i.sku,
               i.barcode,
               i.item_name,
               i.description,
               i.cost_price,
               i.selling_price,
               i.discount_price,
               c.category_name,
               d.department_name,
               ist.is_active,
               ist.sellable,
               ist.available_for_pos,
               ist.track_stock,
               ist.taxable,
               ist.allow_discount,
               ist.measurement_type,
               ist.unit_type,
               ist.min_stock_level,
               ist.max_stock_level,
               ist.min_increment,
               ist.default_qty,
               COALESCE(istock.quantity, 0)           AS quantity,
               COALESCE(istock.reserved_quantity, 0)  AS reserved_quantity
           FROM   items i
           LEFT JOIN categories  c     ON c.id = i.category_id
           LEFT JOIN departments d     ON d.id = i.department_id
           LEFT JOIN item_settings ist ON ist.item_id = i.id
           LEFT JOIN item_stock istock ON istock.item_id = i.id AND istock.store_id = i.store_id
           WHERE  i.store_id = $1
             AND  COALESCE(ist.archived_at, 'infinity'::timestamptz) > NOW()
             AND ($2::int  IS NULL OR i.department_id  = $2)
             AND ($3::int  IS NULL OR i.category_id    = $3)
             AND ($4::bool IS NULL OR ist.is_active     = $4)
             AND ($5::bool IS NULL OR (
                   $5 = FALSE
                   OR (ist.track_stock = TRUE AND istock.quantity <= ist.min_stock_level::numeric)
                 ))
           ORDER  BY d.department_name ASC NULLS LAST,
                     c.category_name   ASC NULLS LAST,
                     i.item_name       ASC"#,
        store_id, department_id, category_id, is_active, low_stock,
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "action":            "update",
        "sku":               r.sku,
        "item_name":         r.item_name,
        "barcode":           r.barcode,
        "description":       r.description,
        "department_name":   r.department_name,
        "category_name":     r.category_name,
        "cost_price":        r.cost_price,
        "selling_price":     r.selling_price,
        "discount_price":    r.discount_price,
        "is_active":         r.is_active,
        "sellable":          r.sellable,
        "available_for_pos": r.available_for_pos,
        "track_stock":       r.track_stock,
        "taxable":           r.taxable,
        "allow_discount":    r.allow_discount,
        "measurement_type":  r.measurement_type,
        "unit_type":         r.unit_type,
        "min_stock_level":   r.min_stock_level,
        "max_stock_level":   r.max_stock_level,
        "min_increment":     r.min_increment,
        "default_qty":       r.default_qty,
        // quantity is exported for reference.
        // On re-import: fill this column to overwrite stock, or leave blank to keep unchanged.
        "quantity":          r.quantity,
        "reserved_quantity": r.reserved_quantity,
    })).collect();

    Ok(result)
}

// ── export_customers ──────────────────────────────────────────────────────────

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

// ── export_expenses ───────────────────────────────────────────────────────────

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
        store_id,
        date_from.as_deref(),
        date_to.as_deref(),
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "expense_type":     r.expense_type,
        "category":         r.category,
        "description":      r.description,
        "amount":           r.amount,
        "payment_method":   r.payment_method,
        "payment_status":   r.payment_status,
        "approval_status":  r.approval_status,
        "expense_date":     r.expense_date,
        "reference_number": r.reference_number,
        "paid_to":          r.paid_to,
        "is_recurring":     r.is_recurring,
        "is_deductible":    r.is_deductible,
        "notes":            r.notes,
        "recorded_by":      r.recorded_by_name,
    })).collect();

    Ok(result)
}

// ── export_transactions ───────────────────────────────────────────────────────

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
        store_id,
        date_from.as_deref(),
        date_to.as_deref(),
    )
    .fetch_all(&pool)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "reference_no":   r.reference_no,
        "date":           r.created_at,
        "cashier":        r.cashier_name,
        "customer":       r.customer_name,
        "payment_method": r.payment_method,
        "subtotal":       r.subtotal,
        "discount":       r.discount_amount,
        "tax":            r.tax_amount,
        "total":          r.total_amount,
        "status":         r.status,
    })).collect();

    Ok(result)
}
