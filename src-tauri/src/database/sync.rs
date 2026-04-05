// ============================================================================
// CLOUD SYNC WORKER  (bidirectional — push + pull)
// ============================================================================
//
// PUSH (local → Supabase):
//   • Polls local sync_queue every 5 s for status = 'pending' rows.
//   • Filtered to the current business_id — never leaks another business's data.
//   • Marks each row 'syncing', replays to Supabase, marks 'synced'.
//   • On failure: increments retries → 'failed' after MAX_RETRIES.
//
// PULL (Supabase → local):
//   • Polls Supabase every 5 s for rows newer than the stored cursor.
//   • Filters tables by business_id — EXCEPT the `businesses` table itself,
//     which has no business_id column; it is filtered by its own `id` column
//     via the `biz_id_filter_col` helper below.
//   • UPSERTs rows into local PostgreSQL — idempotent, safe to re-apply.
//   • Cursor stored in app_config key 'cloud_pull_cursor'.
//   • Skips silently when no cloud pool is configured (offline-first).
// ============================================================================

use sqlx::PgPool;
use serde_json::Value;
use uuid::Uuid;
use crate::state::AppState;
use chrono::Utc;

const MAX_RETRIES:  i32 = 100; // FK-chain failures can cascade for many cycles; 100 gives ~8 min at 5s poll before permanent failure
const POLL_SECS:    u64 = 5;
const BATCH_SIZE:   i64 = 50;
const PULL_BATCH:   i64 = 200;

/// Tables we replicate in both directions. Order matters for FK deps:
/// parent tables must come before child tables in both push and pull.
const SYNC_TABLES: &[&str] = &[
    // ── reference / parent tables ─────────────────────────────────────────────
    "businesses",   // must sync FIRST -- stores.business_id FK depends on it
    "stores",
    "users",
    "departments",
    "categories",
    "suppliers",
    // ── catalog ───────────────────────────────────────────────────────────────
    "items",
    "item_stock",
    // ── operations ────────────────────────────────────────────────────────────
    "customers",
    "shifts",
    "transactions",
    "transaction_items",
    "payments",
    "expenses",
    "credit_sales",
    "returns",
    "return_items",
    "purchase_orders",
    "purchase_order_items",
    "cash_movements",
    "reorder_alerts",
    "notifications",
];

/// Returns the column name to use when filtering a table by the current business.
///
/// Every table has a `business_id` column **except** `businesses` itself, whose
/// primary key `id` carries that role. Using `t.business_id` on the `businesses`
/// table causes a "column does not exist" error and silently skips the row,
/// which then breaks FK constraints on every downstream table (stores, departments, etc.).
fn biz_id_filter_col(table: &str) -> &'static str {
    match table {
        "businesses" => "id",
        _            => "business_id",
    }
}

/// Returns the SQL timestamp expression to use for cursor-based pull filtering,
/// based on which column(s) each table actually has on Supabase (pre-migration 0074).
/// After 0074 runs on Supabase, COALESCE(updated_at, created_at) works for all tables.
fn table_ts_expr(table: &str) -> &'static str {
    match table {
        // Only has updated_at (no created_at before migration 0074)
        "item_stock" => "t.updated_at",
        // Only has created_at (no updated_at before migration 0074)
        "transactions"     |
        "payments"         |
        "returns"          |
        "purchase_orders"  |
        "cash_movements"   |
        "reorder_alerts"   |
        "notifications"    |
        "expenses"         => "t.created_at",
        // Has neither before migration 0074 — fall back to created_at (added by 0074)
        "transaction_items"    |
        "return_items"         |
        "purchase_order_items" |
        "shifts"               => "t.created_at",
        // Reference tables: all have both columns already
        _ => "COALESCE(t.updated_at, t.created_at)",
    }
}

/// Load the current business_id from app_config. Returns None when onboarding
/// has not yet completed. Used as a fallback inside queue_row and backfill.
async fn load_biz_id(pool: &PgPool) -> Option<Uuid> {
    sqlx::query_scalar!("SELECT value FROM app_config WHERE key = 'business_id'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|s| s.parse::<Uuid>().ok())
}

/// Returns `true` when the user has opted into background cloud replication.
///
/// **Scope — background workers only:**
/// Both `run_sync_loop` (push) and `run_pull_loop` (pull) respect this flag.
/// Onboarding read operations (`check_business_exists`, `restore_business_from_cloud`)
/// bypass this flag entirely — they call the cloud pool directly and are never gated.
///
/// Defaults to `false` when the key is absent (safe for fresh installs that have
/// not yet run migration 0078 or where the user has never toggled the setting).
pub async fn is_cloud_sync_enabled(pool: &PgPool) -> bool {
    sqlx::query_scalar!("SELECT value FROM app_config WHERE key = 'cloud_sync_enabled'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

/// On startup, reset any sync_queue rows that failed due to FK-constraint
/// violations back to 'pending' with retries = 0.
///
/// These rows are safe to retry — they failed only because a parent row had
/// not yet arrived in Supabase, not because the data itself is invalid. With
/// the tier-ordered push worker now in place, the parent will always arrive
/// first on the next cycle.
///
/// Only FK-violation errors are reset; genuine data errors (e.g. NOT NULL
/// constraint, type mismatch) are left as 'failed' so they don't loop forever.
pub async fn reset_fk_failed_rows(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        r#"UPDATE sync_queue
           SET status  = 'pending',
               retries = 0,
               error   = NULL
           WHERE status = 'failed'
             AND error LIKE '%violates foreign key constraint%'"#
    )
    .execute(pool)
    .await?;

    let n = result.rows_affected();
    if n > 0 {
        tracing::info!("Sync: reset {n} FK-failed row(s) to pending for retry.");
    }
    Ok(n)
}

/// Backfill the sync_queue with ALL rows for the current business from every
/// allowlisted table that have not already been queued. Called once on first
/// sync setup or after a reset.
pub async fn backfill_sync_queue(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let biz_id = match load_biz_id(pool).await {
        Some(id) => id,
        None => {
            tracing::warn!("backfill_sync_queue: no business_id in app_config — skipping");
            return Ok(0);
        }
    };

    // (table_name, pk_col_cast_to_text, store_id_col_or_none)
    // Order matters: parent tables before children (FK deps)
    let tables: &[(&str, &str, Option<&str>)] = &[
        ("businesses",           "t.id::text",       None),          // FIRST: no FK deps
        ("stores",               "t.id::text",       None),
        ("users",                "t.id::text",       Some("t.store_id")),
        ("departments",          "t.id::text",       Some("t.store_id")),
        ("categories",           "t.id::text",       Some("t.store_id")),
        ("suppliers",            "t.id::text",       Some("t.store_id")),
        ("items",                "t.id::text",       Some("t.store_id")),
        ("item_stock",           "t.item_id::text",  Some("t.store_id")),
        ("customers",            "t.id::text",       Some("t.store_id")),
        ("shifts",               "t.id::text",       Some("t.store_id")),
        ("transactions",         "t.id::text",       Some("t.store_id")),
        ("transaction_items",    "t.id::text",       None),
        ("payments",             "t.id::text",       None),
        ("expenses",             "t.id::text",       Some("t.store_id")),
        ("credit_sales",         "t.id::text",       Some("t.store_id")),
        ("returns",              "t.id::text",       Some("t.store_id")),
        ("return_items",         "t.id::text",       None),
        ("purchase_orders",      "t.id::text",       Some("t.store_id")),
        ("purchase_order_items", "t.id::text",       None),
        ("cash_movements",       "t.id::text",       None),
        ("reorder_alerts",       "t.id::text",       Some("t.store_id")),
        ("notifications",        "t.id::text",       Some("t.store_id")),
    ];

    let biz_id_str = biz_id.to_string();
    let mut total: u64 = 0;

    for (table, pk, store_expr) in tables {
        let (col_list, val_list) = match store_expr {
            Some(sc) => (
                "table_name, operation, row_id, row_data, store_id, business_id".to_string(),
                format!("'{table}', 'INSERT', {pk}, row_to_json(t.*), {sc}, '{biz_id_str}'::uuid"),
            ),
            None => (
                "table_name, operation, row_id, row_data, business_id".to_string(),
                format!("'{table}', 'INSERT', {pk}, row_to_json(t.*), '{biz_id_str}'::uuid"),
            ),
        };

        let biz_col = biz_id_filter_col(table);
        let stmt = format!(
            "INSERT INTO sync_queue ({col_list})
             SELECT {val_list}
             FROM   {table} t
             WHERE  t.{biz_col} = '{biz_id_str}'::uuid
               AND  NOT EXISTS (
                 SELECT 1 FROM sync_queue sq
                 WHERE  sq.table_name = '{table}'
                   AND  sq.row_id     = {pk}
                   AND  sq.status IN ('pending','syncing','synced')
             )
             ON CONFLICT DO NOTHING"
        );

        let n = sqlx::query(&stmt)
            .execute(pool)
            .await
            .map(|r| r.rows_affected())
            .unwrap_or_else(|e| {
                tracing::warn!("Backfill failed for {table}: {e}");
                0
            });

        if n > 0 {
            tracing::info!("Backfill: queued {n} rows from {table}");
        }
        total += n;
    }

    Ok(total)
}

/// Queue a single row into the local sync_queue (non-fatal — called after every
/// successful local DB commit that should be replicated to the cloud).
/// business_id is extracted from row_data if present; otherwise falls back to
/// reading app_config so no caller needs to change.
pub async fn queue_row(
    pool:       &PgPool,
    table_name: &str,
    operation:  &str,
    row_id:     &str,
    row_data:   Value,
    store_id:   Option<i32>,
) {
    // Resolve business_id: try row_data first (fast path), then app_config (fallback).
    let business_id: Option<Uuid> = row_data
        .get("business_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Uuid>().ok())
        .or(load_biz_id(pool).await);

    let result = sqlx::query!(
        "INSERT INTO sync_queue (table_name, operation, row_id, row_data, store_id, business_id)
         VALUES ($1, $2, $3, $4, $5, $6)",
        table_name,
        operation,
        row_id,
        row_data,
        store_id,
        business_id,
    )
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::warn!("sync_queue insert failed (non-fatal): {e}");
    }
}

/// Spawn the background sync loop. Should be called once at app startup.
pub async fn run_sync_loop(state: AppState) {
    tracing::info!("Cloud sync worker started — polling every {POLL_SECS}s");
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(POLL_SECS)).await;

        // Get local pool — if DB isn't connected yet, just wait
        let local_pool = match state.pool().await {
            Ok(p)  => p,
            Err(_) => continue,
        };

        // Get cloud pool — if not yet connected but config exists, try to connect
        let cloud_pool = match state.cloud_pool().await {
            Some(p) => p,
            None => {
                let db_url = {
                    let guard = state.supabase_config.read().await;
                    guard.as_ref().map(|c| c.db_url.clone())
                };
                match db_url {
                    None => continue,
                    Some(url) if url.is_empty() => continue,
                    Some(url) => {
                        match super::pool::create_cloud_pool(&url).await {
                            Ok(pool) => {
                                *state.cloud_db.lock().await = Some(pool.clone());
                                tracing::info!("Sync worker: Supabase cloud DB reconnected.");
                                pool
                            }
                            Err(_) => continue,
                        }
                    }
                }
            }
        };

        if !super::pool::ping(&cloud_pool).await {
            tracing::debug!("Cloud DB unreachable — sync skipped this cycle.");
            continue;
        }

        if !is_cloud_sync_enabled(&local_pool).await {
            tracing::trace!("cloud_sync_enabled = false — push worker idle this cycle.");
            continue;
        }

        // Resolve business_id — skip the cycle if onboarding is not complete
        let business_id = match state.get_business_id().await {
            Some(id) => id,
            None => {
                // Try loading it from DB in case AppState cache is cold
                load_biz_id(&local_pool).await.unwrap_or_else(|| {
                    tracing::debug!("Push worker: no business_id yet — skipping cycle");
                    Uuid::nil()
                })
            }
        };
        if business_id.is_nil() {
            continue;
        }

        // Fetch a batch of pending rows scoped to this business only.
        // ORDER BY tier (via CASE) first so that even rows with identical
        // created_at timestamps come out in FK-safe dependency order.
        let rows = match sqlx::query!(
            r#"SELECT id, table_name, operation, row_id, row_data, store_id
               FROM sync_queue
               WHERE status = 'pending'
                 AND retries < $1
                 AND (business_id = $2 OR business_id IS NULL)
               ORDER BY
                 CASE table_name
                   WHEN 'businesses'          THEN 0
                   WHEN 'stores'              THEN 1
                   WHEN 'users'               THEN 1
                   WHEN 'departments'         THEN 2
                   WHEN 'categories'          THEN 2
                   WHEN 'suppliers'           THEN 2
                   WHEN 'items'               THEN 3
                   WHEN 'customers'           THEN 3
                   WHEN 'item_stock'          THEN 4
                   WHEN 'shifts'              THEN 5
                   WHEN 'transactions'        THEN 6
                   WHEN 'purchase_orders'     THEN 6
                   WHEN 'credit_sales'        THEN 6
                   WHEN 'expenses'            THEN 6
                   WHEN 'transaction_items'   THEN 7
                   WHEN 'payments'            THEN 7
                   WHEN 'returns'             THEN 7
                   WHEN 'purchase_order_items' THEN 7
                   WHEN 'cash_movements'      THEN 7
                   WHEN 'return_items'        THEN 8
                   WHEN 'reorder_alerts'      THEN 9
                   WHEN 'notifications'       THEN 9
                   ELSE 10
                 END ASC,
                 created_at ASC
               LIMIT $3"#,
            MAX_RETRIES,
            business_id,
            BATCH_SIZE,
        )
        .fetch_all(&local_pool)
        .await {
            Ok(r)  => r,
            Err(e) => {
                tracing::warn!("sync_queue read failed: {e}");
                continue;
            }
        };

        if rows.is_empty() {
            continue;
        }

        // Sort by FK-dependency tier so parent tables (businesses → stores →
        // categories → items …) always arrive in Supabase before their children,
        // regardless of how close their created_at timestamps are.
        let mut rows = rows;
        rows.sort_by_key(|r| table_tier(&r.table_name));

        tracing::debug!("Cloud sync: processing {} row(s)", rows.len());

        for row in rows {
            let id         = row.id;
            let table      = row.table_name.clone();
            let operation  = row.operation.clone();
            let row_id_str = row.row_id.clone();
            let data       = row.row_data.clone();

            // Mark as syncing so a concurrent worker doesn't double-process
            let claimed = sqlx::query!(
                "UPDATE sync_queue SET status = 'syncing' WHERE id = $1 AND status = 'pending'",
                id,
            )
            .execute(&local_pool)
            .await
            .map(|r| r.rows_affected() == 1)
            .unwrap_or(false);

            if !claimed {
                continue;
            }

            let result = replay_row(&cloud_pool, &table, &operation, &row_id_str, &data).await;

            match result {
                Ok(()) => {
                    let _ = sqlx::query!(
                        "UPDATE sync_queue SET status = 'synced', synced_at = NOW() WHERE id = $1",
                        id,
                    )
                    .execute(&local_pool)
                    .await;
                    tracing::debug!("Synced {table} row {row_id_str} to cloud.");
                }
                Err(e) => {
                    let err_str = e.to_string();
                    tracing::warn!("Cloud sync failed for {table} row {row_id_str}: {err_str}");
                    let _ = sqlx::query!(
                        r#"UPDATE sync_queue
                           SET status  = CASE WHEN retries + 1 >= $1 THEN 'failed' ELSE 'pending' END,
                               retries = retries + 1,
                               error   = $2
                           WHERE id = $3"#,
                        MAX_RETRIES,
                        err_str,
                        id,
                    )
                    .execute(&local_pool)
                    .await;
                }
            }
        }
    }
}

/// Returns the FK-dependency tier for a table so the push worker can sort a
/// mixed batch and guarantee parent rows are always replayed before children.
/// Lower number = synced first.
fn table_tier(table: &str) -> u8 {
    match table {
        "businesses"                                    => 0,
        "stores" | "users"                              => 1,
        "departments" | "categories" | "suppliers"      => 2,
        "items" | "customers"                          => 3,
        "item_stock"                                    => 4, // depends on items — must be a higher tier
        "shifts"                                        => 5,
        "transactions" | "purchase_orders"
            | "credit_sales" | "expenses"               => 6,
        "transaction_items" | "payments"
            | "returns" | "purchase_order_items"
            | "cash_movements"                          => 7,
        "return_items"                                  => 8,
        "reorder_alerts" | "notifications"              => 9,
        _                                               => 10,
    }
}

/// Returns the ON CONFLICT column list for a given table.
/// Most tables use a single `id` column. `item_stock` has a composite
/// primary key (item_id, store_id) so both columns are needed.
fn pk_col(table: &str) -> &'static str {
    match table {
        "item_stock" => "item_id, store_id",
        _ => "id",
    }
}

/// Spawn the background pull loop. Should be called once at app startup,
/// alongside `run_sync_loop`. Polls Supabase every POLL_SECS for rows that
/// are newer than the stored cursor and UPSERTs them into local PostgreSQL.
/// All tables are filtered by business_id directly (every table has the column
/// via migration 0055 + trigger 0075) — no indirect store_id resolution needed.
pub async fn run_pull_loop(state: AppState) {
    tracing::info!("Cloud pull worker started — polling every {POLL_SECS}s");
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(POLL_SECS)).await;

        let local_pool = match state.pool().await {
            Ok(p)  => p,
            Err(_) => continue,
        };

        let cloud_pool = match state.cloud_pool().await {
            Some(p) => p,
            None    => {
                let db_url = {
                    let guard = state.supabase_config.read().await;
                    guard.as_ref().map(|c| c.db_url.clone())
                };
                match db_url {
                    None => continue,
                    Some(ref s) if s.is_empty() => continue,
                    Some(url) => {
                        match super::pool::create_cloud_pool(&url).await {
                            Ok(pool) => {
                                *state.cloud_db.lock().await = Some(pool.clone());
                                pool
                            }
                            Err(_) => continue,
                        }
                    }
                }
            }
        };

        if !super::pool::ping(&cloud_pool).await {
            continue;
        }

        if !is_cloud_sync_enabled(&local_pool).await {
            tracing::trace!("cloud_sync_enabled = false — pull worker idle this cycle.");
            continue;
        }

        // Resolve business_id — if not onboarded yet, skip the pull cycle
        let business_id = match state.get_business_id().await {
            Some(id) => id,
            None     => match load_biz_id(&local_pool).await {
                Some(id) => id,
                None => {
                    tracing::debug!("Pull worker: no business_id yet — skipping cycle");
                    continue;
                }
            },
        };

        // Read cursor — default to epoch so first pull fetches everything
        let cursor: String = sqlx::query_scalar!(
            "SELECT value FROM app_config WHERE key = 'cloud_pull_cursor'"
        )
        .fetch_optional(&local_pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

        let biz_id_str = business_id.to_string();
        let mut any_pulled = false;

        for table in SYNC_TABLES {
            let ts_expr = table_ts_expr(table);

            // businesses.id serves as the business filter for that table;
            // every other table uses the business_id column directly.
            let biz_col = biz_id_filter_col(table);
            let stmt = format!(
                "SELECT row_to_json(t.*) \
                 FROM {table} t \
                 WHERE {ts_expr} > $1::timestamptz \
                   AND t.{biz_col} = $2::uuid \
                 ORDER BY {ts_expr} ASC \
                 LIMIT {PULL_BATCH}"
            );

            let cloud_rows: Vec<serde_json::Value> = match sqlx::query_scalar::<_, serde_json::Value>(&stmt)
                .bind(&cursor)
                .bind(&biz_id_str)
                .fetch_all(&cloud_pool)
                .await
            {
                Ok(r)  => r,
                Err(e) => { tracing::warn!("Pull fetch failed for {table}: {e}"); continue; }
            };

            if cloud_rows.is_empty() {
                continue;
            }

            tracing::debug!("Pull: {} row(s) from {table}", cloud_rows.len());
            any_pulled = true;

            for row_val in cloud_rows {
                let obj = match row_val.as_object() {
                    Some(o) => o,
                    None    => continue,
                };
                if obj.is_empty() { continue; }

                let cols: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
                let pk = pk_col(table);
                let updates: Vec<String> = cols
                    .iter()
                    .filter(|&&c| c != pk)
                    .map(|c| format!("{c} = EXCLUDED.{c}"))
                    .collect();

                let upsert = format!(
                    "INSERT INTO {table} \
                     SELECT * FROM jsonb_populate_record(null::{table}, $1::jsonb) \
                     ON CONFLICT ({pk}) DO UPDATE SET {upd}",
                    upd = updates.join(", "),
                );

                if let Err(e) = sqlx::query(&upsert)
                    .bind(row_val.clone())
                    .execute(&local_pool)
                    .await
                {
                    tracing::warn!("Pull UPSERT failed for {table}: {e}");
                }
            }
        }

        if any_pulled {
            let now = Utc::now().to_rfc3339();
            let _ = sqlx::query!(
                "INSERT INTO app_config (key, value) VALUES ('cloud_pull_cursor', $1)
                 ON CONFLICT (key) DO UPDATE SET value = $1",
                now,
            )
            .execute(&local_pool)
            .await;
        }
    }
}

/// Replay a single queued row to the cloud database using a generic UPSERT.
/// The row_data JSONB is expanded into named columns via a dynamic statement.
/// For DELETE operations, we issue a DELETE by primary key.
async fn replay_row(
    cloud_pool: &PgPool,
    table_name: &str,
    operation:  &str,
    row_id:     &str,
    row_data:   &Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Allowlist of tables we replicate — protects against injection if row_data
    // is somehow tampered with. Only add tables that are safe to replicate.
    let allowed_tables = [
        "businesses",
        "stores", "users", "departments", "categories", "suppliers",
        "items", "item_stock",
        "customers", "shifts",
        "transactions", "transaction_items", "payments",
        "expenses", "credit_sales",
        "returns", "return_items",
        "purchase_orders", "purchase_order_items",
        "cash_movements", "reorder_alerts", "notifications",
    ];
    if !allowed_tables.contains(&table_name) {
        return Err(format!("Table '{table_name}' is not in the sync allowlist").into());
    }

    match operation {
        "DELETE" => {
            let stmt = if row_id.parse::<i64>().is_ok() {
                format!("DELETE FROM {table_name} WHERE id = $1::bigint")
            } else {
                format!("DELETE FROM {table_name} WHERE id = $1::uuid")
            };
            sqlx::query(&stmt)
                .bind(row_id)
                .execute(cloud_pool)
                .await?;
        }
        "INSERT" | "UPDATE" => {
            let obj = match row_data.as_object() {
                Some(o) => o,
                None    => return Err("row_data is not a JSON object".into()),
            };

            if obj.is_empty() {
                return Ok(());
            }

            let cols: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
            let pk = pk_col(table_name);
            let updates: Vec<String> = cols
                .iter()
                .filter(|&&c| c != pk)
                .map(|c| format!("{c} = EXCLUDED.{c}"))
                .collect();

            let stmt = format!(
                "INSERT INTO {table_name} \
                 SELECT * FROM jsonb_populate_record(null::{table_name}, $1::jsonb) \
                 ON CONFLICT ({pk}) DO UPDATE SET {}",
                updates.join(", "),
            );

            sqlx::query(&stmt)
                .bind(row_data.clone())
                .execute(cloud_pool)
                .await?;
        }
        _ => {
            return Err(format!("Unknown operation: {operation}").into());
        }
    }

    Ok(())
}
