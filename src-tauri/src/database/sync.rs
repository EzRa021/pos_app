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
use std::collections::HashSet;
use crate::state::AppState;
use chrono::Utc;
use tokio::sync::Notify;

/// Woken by `queue_row` the moment a change lands in sync_queue so the push
/// worker starts replaying within milliseconds instead of waiting out the
/// poll interval. The 5s tick remains as the reliability fallback.
static PUSH_WAKE: Notify = Notify::const_new();

const MAX_RETRIES:  i32 = 100; // FK-chain failures can cascade for many cycles; 100 gives ~8 min at 5s poll before permanent failure
const POLL_SECS:    u64 = 5;
const BATCH_SIZE:   i64 = 50;
/// Housekeeping cadence, counted in idle cycles (~5s each). 720 ≈ once an hour
/// of continuous idling — often enough to keep sync_queue/sync_event_log bounded,
/// rare enough that the DELETE never competes with real sync traffic.
const PRUNE_EVERY_N_CYCLES: u32 = 720;
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
    "tax_categories",   // parent of items.tax_category_id — must precede items
    // ── catalog ───────────────────────────────────────────────────────────────
    "items",
    "item_stock",       // seed-only: pulled with ON CONFLICT DO NOTHING
    "stock_movements",  // delta log — the authoritative sync channel for stock
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
    // ── money/points ledgers (0102) — parents: customers, suppliers,
    //    transactions, purchase_orders — all earlier in this list ────────────
    "supplier_payments",
    "customer_wallet_transactions",
    "loyalty_transactions",
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

/// Pull-cursor column. Migration 0098 adds `cloud_synced_at` to every synced
/// table, stamped to NOW() by a trigger on each insert/update — so on the
/// CLOUD database it always reflects the cloud's own clock at the moment the
/// row arrived there. Cursoring on it (instead of device-local created_at /
/// updated_at) means a row created offline and pushed hours later is still
/// seen by every other device: its cloud stamp is "now", ahead of all cursors.
const PULL_TS_COL: &str = "cloud_synced_at";

// ============================================================================
// CONFLICT STRATEGY — one per data category, not blanket last-write-wins
// ============================================================================

/// How a replicated row is applied to the target database.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum SyncStrategy {
    /// Created once, never contested-edited: INSERT … ON CONFLICT DO NOTHING.
    /// Delivery is guaranteed by PK/UUID dedupe + the retry/tier system.
    AppendOnly,
    /// Genuinely mutable reference data: guarded last-write-wins on
    /// (sync_version, updated_at, origin_device_id). Rejected writes are
    /// logged to sync_conflicts — never silent.
    Lww,
    /// Rows with a status state machine: a higher-ranked status always wins
    /// regardless of timestamp (a closed shift is never reopened by a stale
    /// pull). Same-rank edits fall back to the LWW guard.
    StateMachine,
    /// item_stock: seed-only. The row is inserted when absent and NEVER
    /// overwritten — quantities are maintained exclusively by applying
    /// stock_movements deltas.
    StockSeed,
    /// stock_movements: append-only PLUS applying the delta/set to the
    /// target side's item_stock the first time the movement is seen.
    StockMovement,
}

fn sync_strategy(table: &str) -> SyncStrategy {
    match table {
        "businesses" | "stores" | "users" | "departments" | "categories"
        | "suppliers" | "tax_categories" | "items" | "customers" => SyncStrategy::Lww,
        "shifts" | "transactions" | "credit_sales" | "purchase_orders"
        | "returns" | "reorder_alerts" | "expenses" => SyncStrategy::StateMachine,
        "item_stock"      => SyncStrategy::StockSeed,
        "stock_movements" => SyncStrategy::StockMovement,
        // transaction_items, payments, return_items, purchase_order_items,
        // cash_movements, notifications, …
        _ => SyncStrategy::AppendOnly,
    }
}

/// SQL CASE expression ranking a table's status values. Higher rank = more
/// final. An incoming row may only overwrite when its status rank is >= the
/// current row's rank — so terminal states (closed, voided, paid, …) are
/// never regressed by a stale write from another device. Unknown statuses
/// rank 0 and therefore resolve via the LWW fallback.
fn status_rank_case(table: &str, row_expr: &str) -> Option<String> {
    let ranks: &[(&str, i32)] = match table {
        "shifts"          => &[("open", 0), ("active", 0), ("suspended", 1), ("closed", 2)],
        "transactions"    => &[("completed", 0), ("partially_refunded", 1),
                               ("refunded", 2), ("voided", 2), ("cancelled", 2)],
        "credit_sales"    => &[("open", 0), ("partial", 1), ("paid", 2), ("cancelled", 2)],
        "purchase_orders" => &[("draft", 0), ("pending", 0), ("approved", 1),
                               ("partial", 2), ("partially_received", 2),
                               ("received", 3), ("fully_received", 3), ("cancelled", 3)],
        "returns"         => &[("completed", 0), ("voided", 1), ("cancelled", 1)],
        "reorder_alerts"  => &[("pending", 0), ("acknowledged", 1), ("ordered", 2),
                               ("resolved", 2), ("dismissed", 2)],
        "expenses"        => &[("pending", 0), ("approved", 1), ("rejected", 1)],
        _ => return None,
    };
    let whens: String = ranks
        .iter()
        .map(|(s, r)| format!(" WHEN '{s}' THEN {r}"))
        .collect();
    Some(format!("(CASE {row_expr}.status{whens} ELSE 0 END)"))
}

/// LWW guard: the incoming (EXCLUDED) row wins only if it is strictly ahead —
/// by sync_version first, then updated_at, then origin_device_id as a stable
/// tie-breaker so two devices resolve the same conflict identically.
fn lww_guard_sql(table: &str) -> String {
    let cur_ts = format!("COALESCE({table}.updated_at, {table}.created_at)");
    let inc_ts = "COALESCE(EXCLUDED.updated_at, EXCLUDED.created_at)";
    format!(
        "({table}.sync_version < COALESCE(EXCLUDED.sync_version, 0) \
          OR ({table}.sync_version = COALESCE(EXCLUDED.sync_version, 0) AND {cur_ts} < {inc_ts}) \
          OR ({table}.sync_version = COALESCE(EXCLUDED.sync_version, 0) AND {cur_ts} = {inc_ts} \
              AND COALESCE({table}.origin_device_id::text, '') < COALESCE(EXCLUDED.origin_device_id::text, '')))"
    )
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
/// Detect a change of cloud database and reset the sync bookkeeping when it
/// happens — regardless of HOW the credentials changed (Settings save, .env
/// rebuild, embedded default flip). Stores the last-seen cloud host in
/// app_config('cloud_identity'); when it differs from the current target:
///   • 'synced' rows are purged (they are history about a DIFFERENT database
///     and block backfill's dedupe, stranding children in FK retries),
///   • 'failed' rows are re-queued (they failed against the old database),
///   • the pull cursor restarts from epoch (new timeline; applies are
///     idempotent so re-pulling is safe).
/// Idempotent and cheap when the identity is unchanged.
/// Supabase's Supavisor pooler exposes the SAME database on two ports:
/// 5432 = session mode (supports `LISTEN/NOTIFY`), 6543 = transaction mode
/// (does NOT — each query may land on a different backend connection, so a
/// registered LISTEN is silently worthless). Supabase's own dashboard
/// defaults the copy-paste "Connection Pooling" string to 6543, which is the
/// wrong one for this app: the pull worker's `PgListener` needs 5432 to get
/// instant wake-ups instead of falling back to the 5s poll on every cycle.
/// Rewrite it automatically so users who paste the dashboard default still
/// get realtime wake-ups.
pub fn normalize_supabase_db_url(db_url: &str) -> String {
    if db_url.contains(".pooler.supabase.com:6543") {
        let fixed = db_url.replace(".pooler.supabase.com:6543", ".pooler.supabase.com:5432");
        tracing::info!(
            "Supabase DB URL used the transaction pooler (6543) — rewritten to the session pooler (5432) so LISTEN/NOTIFY realtime wake-ups work."
        );
        fixed
    } else {
        db_url.to_string()
    }
}

pub async fn ensure_cloud_identity(local_pool: &PgPool, db_url: &str) {
    // host:port/dbname — never the credentials.
    let host = db_url.split('@').nth(1).unwrap_or("<unknown>");

    let prev: Option<String> = sqlx::query_scalar!(
        "SELECT value FROM app_config WHERE key = 'cloud_identity'"
    )
    .fetch_optional(local_pool)
    .await
    .ok()
    .flatten();

    if prev.as_deref() == Some(host) {
        return; // same database as last time — nothing to do
    }

    if let Some(ref old) = prev {
        tracing::info!("Cloud database changed ({old} → {host}) — resetting sync bookkeeping.");
        match sqlx::query!("DELETE FROM sync_queue WHERE status = 'synced'")
            .execute(local_pool).await
        {
            Ok(r) if r.rows_affected() > 0 =>
                tracing::info!("Cloud switch: purged {} stale 'synced' rows.", r.rows_affected()),
            Ok(_)  => {}
            Err(e) => tracing::warn!("Cloud switch: synced purge failed: {e}"),
        }
        match sqlx::query!(
            "UPDATE sync_queue SET status='pending', retries=0, error=NULL WHERE status='failed'"
        )
        .execute(local_pool).await
        {
            Ok(r) if r.rows_affected() > 0 =>
                tracing::info!("Cloud switch: re-queued {} previously-failed rows.", r.rows_affected()),
            Ok(_)  => {}
            Err(e) => tracing::warn!("Cloud switch: failed-row reset failed: {e}"),
        }
        if let Err(e) = sqlx::query!(
            "INSERT INTO app_config (key, value) VALUES ('cloud_pull_cursor', '1970-01-01T00:00:00Z')
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
        )
        .execute(local_pool).await
        {
            tracing::warn!("Cloud switch: pull-cursor reset failed: {e}");
        }
    }

    let _ = sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('cloud_identity', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        host,
    )
    .execute(local_pool)
    .await;
}

pub async fn is_cloud_sync_enabled(pool: &PgPool) -> bool {
    sqlx::query_scalar!("SELECT value FROM app_config WHERE key = 'cloud_sync_enabled'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

/// On startup, reset any sync_queue rows stuck in 'syncing' status back to
/// 'pending' so they are retried. Rows get stuck when the app crashes or is
/// force-quit while a push cycle is in progress — the worker claims the row
/// ('syncing') but never marks it 'synced' or 'failed'. Without this reset
/// they would be permanently invisible to the push worker on the next launch.
pub async fn reset_syncing_rows(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        r#"UPDATE sync_queue
           SET status  = 'pending',
               error   = 'Reset from syncing state on startup'
           WHERE status = 'syncing'"#
    )
    .execute(pool)
    .await?;

    let n = result.rows_affected();
    if n > 0 {
        tracing::info!("Sync: reset {n} stuck 'syncing' row(s) to pending on startup.");
    }
    Ok(n)
}

/// Auto-enable cloud sync when embedded Supabase credentials connect
/// successfully on first launch. Uses INSERT ... ON CONFLICT DO NOTHING so a
/// user who has explicitly disabled sync is never overridden.
pub async fn auto_enable_sync_if_needed(pool: &PgPool) {
    let result = sqlx::query!(
        "INSERT INTO app_config (key, value) VALUES ('cloud_sync_enabled', 'true')
         ON CONFLICT (key) DO NOTHING"
    )
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            tracing::info!("Sync: cloud_sync_enabled auto-enabled via embedded credentials.");
        }
        Ok(_) => {
            tracing::debug!("Sync: cloud_sync_enabled already set — not overriding.");
        }
        Err(e) => {
            tracing::warn!("Sync: could not auto-enable cloud_sync_enabled: {e}");
        }
    }
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

    // Ordered list of tables to backfill. Order matters: parent tables first.
    let tables: &[&str] = &[
        "businesses",
        "stores", "users",
        "departments", "categories", "suppliers",
        "tax_categories",
        "items", "item_stock",
        "customers", "shifts",
        "transactions", "transaction_items", "payments",
        "expenses", "credit_sales",
        "returns", "return_items",
        "purchase_orders", "purchase_order_items",
        "cash_movements",
        "supplier_payments", "customer_wallet_transactions", "loyalty_transactions",
        "reorder_alerts", "notifications",
    ];

    let biz_id_str = biz_id.to_string();
    let mut total: u64 = 0;

    for table in tables {
        let meta = match table_backfill_meta(table) {
            Some(m) => m,
            None    => continue,
        };
        let pk = meta.pk_expr;

        let (col_list, val_list) = match meta.store_expr {
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
        // For the `businesses` table biz_col = "id" (never NULL); for all other
        // tables we also include rows where business_id IS NULL — these are rows
        // that pre-date the business_id column being populated. They belong to
        // the single local business and must be synced so child FK references resolve.
        let biz_filter = if table == &"businesses" {
            format!("t.{biz_col} = '{biz_id_str}'::uuid")
        } else {
            format!("(t.{biz_col} = '{biz_id_str}'::uuid OR t.{biz_col} IS NULL)")
        };
        let stmt = format!(
            "INSERT INTO sync_queue ({col_list})
             SELECT {val_list}
             FROM   {table} t
             WHERE  {biz_filter}
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

    if total > 0 {
        PUSH_WAKE.notify_one();
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
    } else {
        PUSH_WAKE.notify_one();
    }
}

/// Per-table backfill metadata used by both the startup backfill and the
/// on-demand `force_resync_table` triggered by FK failures.
struct TableMeta {
    pk_expr:    &'static str,          // SQL expression producing the row PK as TEXT
    store_expr: Option<&'static str>,  // SQL expression for the store_id column, or None
}

fn table_backfill_meta(table: &str) -> Option<TableMeta> {
    Some(match table {
        "businesses"           => TableMeta { pk_expr: "t.id::text",      store_expr: None },
        "stores"               => TableMeta { pk_expr: "t.id::text",      store_expr: None },
        "users"                => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "departments"          => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "categories"           => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "suppliers"            => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        // Business-global (no store_id) — same shape as businesses.
        "tax_categories"       => TableMeta { pk_expr: "t.id::text",      store_expr: None },
        "items"                => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        // Composite PK (item_id, store_id) — must match the `item_id:store_id`
        // format that fresh_rows_for_push() parses, or every backfilled row is
        // rejected as malformed and never pushed.
        "item_stock"           => TableMeta { pk_expr: "(t.item_id::text || ':' || t.store_id::text)", store_expr: Some("t.store_id") },
        "customers"            => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "shifts"               => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "transactions"         => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "transaction_items"    => TableMeta { pk_expr: "t.id::text",      store_expr: None },
        "payments"             => TableMeta { pk_expr: "t.id::text",      store_expr: None },
        "expenses"             => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "credit_sales"         => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "returns"              => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "return_items"         => TableMeta { pk_expr: "t.id::text",      store_expr: None },
        "purchase_orders"      => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "purchase_order_items" => TableMeta { pk_expr: "t.id::text",      store_expr: None },
        "cash_movements"       => TableMeta { pk_expr: "t.id::text",      store_expr: None },
        "reorder_alerts"       => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "notifications"        => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "supplier_payments"    => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        "customer_wallet_transactions" => TableMeta { pk_expr: "t.id::text", store_expr: Some("t.store_id") },
        "loyalty_transactions" => TableMeta { pk_expr: "t.id::text",      store_expr: Some("t.store_id") },
        _ => return None,
    })
}

/// When a row fails with a FK violation, infer which parent table needs to be
/// re-synced and return its name. Keyed on the FK constraint name suffix that
/// PostgreSQL embeds in the error message.
///
/// Pattern: `"violates foreign key constraint \"items_category_id_fkey\""`
/// → column name `category_id` → parent table `categories`.
fn fk_parent_table(error_msg: &str) -> Option<&'static str> {
    // Most specific matches first (avoid false positives)
    if error_msg.contains("item_stock_item_id_fkey")         { return Some("items"); }
    if error_msg.contains("item_stock_store_id_fkey")         { return Some("stores"); }
    // Generic column-name inference — matches any table's FK to these parents
    if error_msg.contains("_category_id_fkey")   { return Some("categories"); }
    if error_msg.contains("_department_id_fkey")  { return Some("departments"); }
    if error_msg.contains("_supplier_id_fkey")    { return Some("suppliers"); }
    if error_msg.contains("_customer_id_fkey")    { return Some("customers"); }
    if error_msg.contains("_store_id_fkey")       { return Some("stores"); }
    if error_msg.contains("_business_id_fkey")    { return Some("businesses"); }
    if error_msg.contains("_item_id_fkey")        { return Some("items"); }
    if error_msg.contains("_shift_id_fkey")       { return Some("shifts"); }
    if error_msg.contains("_transaction_id_fkey") { return Some("transactions"); }
    // transaction_items.tx_id and returns.original_tx_id both end in _tx_id —
    // this was the missing mapping that left transaction_items retrying an
    // FK failure forever after a cloud-DB switch (no force-resync fired).
    if error_msg.contains("_tax_category_id_fkey"){ return Some("tax_categories"); }
    if error_msg.contains("_tx_id_fkey")          { return Some("transactions"); }
    if error_msg.contains("_po_id_fkey")          { return Some("purchase_orders"); }
    if error_msg.contains("_return_id_fkey")      { return Some("returns"); }
    if error_msg.contains("_user_id_fkey")        { return Some("users"); }
    // Audit-style columns (opened_by, cashier_id, …) all reference users.
    const USER_FK: &[&str] = &[
        "_cashier_id_fkey",   "_opened_by_fkey",   "_closed_by_fkey",
        "_created_by_fkey",   "_updated_by_fkey",  "_performed_by_fkey",
        "_processed_by_fkey", "_recorded_by_fkey", "_paid_by_fkey",
        "_ordered_by_fkey",   "_approved_by_fkey", "_voided_by_fkey",
        "_cancelled_by_fkey", "_requested_by_fkey","_acknowledged_by_fkey",
        "_sent_by_fkey",      "_received_by_fkey", "_changed_by_fkey",
    ];
    if USER_FK.iter().any(|s| error_msg.contains(s)) { return Some("users"); }
    None
}

/// Force a complete re-sync of `parent_table` when a child fails with a FK
/// violation. Two-phase approach that covers every failure scenario:
///
/// **Phase 1 — Reset existing queue rows**
/// Any sync_queue row for this table that is not currently being processed
/// ('syncing') is reset to 'pending' with retries=0. This covers:
///   • Rows marked 'synced' that never actually landed (Supabase DB reset, etc.)
///   • Rows in 'failed' status from previous sessions
///
/// **Phase 2 — Backfill missing rows**
/// Inserts fresh queue entries for any rows in the source table that are
/// NOT currently pending or syncing. This covers the case where a parent
/// row was never queued at all (e.g. created before sync was set up, or
/// the initial backfill was interrupted).
async fn force_resync_table(pool: &PgPool, table: &str) {
    // Phase 1: reset all non-active queue rows to pending
    match sqlx::query!(
        "UPDATE sync_queue
         SET status = 'pending', retries = 0, error = NULL
         WHERE table_name = $1 AND status NOT IN ('syncing')",
        table,
    )
    .execute(pool)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            tracing::info!(
                "Sync: reset {} '{}' queue row(s) to pending for re-verification.",
                r.rows_affected(), table
            );
        }
        Ok(_)  => {}
        Err(e) => tracing::warn!("force_resync_table({table}) phase-1 error: {e}"),
    }

    // Phase 2: insert queue entries for rows not yet queued at all
    let biz_id = match load_biz_id(pool).await {
        Some(id) => id,
        None     => return, // not onboarded yet
    };
    let biz_id_str = biz_id.to_string();

    let meta = match table_backfill_meta(table) {
        Some(m) => m,
        None    => return, // table not in allowlist
    };
    let pk = meta.pk_expr;

    let (col_list, val_list) = match meta.store_expr {
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
    // Also include rows where business_id IS NULL: these pre-date the column
    // being populated and are the most common cause of "parent never reaches
    // Supabase" FK loops. The businesses table uses id as its PK so IS NULL
    // can never match there.
    let biz_filter = if table == "businesses" {
        format!("t.{biz_col} = '{biz_id_str}'::uuid")
    } else {
        format!("(t.{biz_col} = '{biz_id_str}'::uuid OR t.{biz_col} IS NULL)")
    };
    // NOT EXISTS excludes only 'pending'/'syncing' — 'synced'/'failed' rows
    // were already reset to 'pending' in Phase 1, so they appear as 'pending'
    // here and are correctly excluded from duplication.
    let stmt = format!(
        "INSERT INTO sync_queue ({col_list})
         SELECT {val_list}
         FROM   {table} t
         WHERE  {biz_filter}
           AND  NOT EXISTS (
             SELECT 1 FROM sync_queue sq
             WHERE  sq.table_name = '{table}'
               AND  sq.row_id     = {pk}
               AND  sq.status IN ('pending','syncing')
         )
         ON CONFLICT DO NOTHING"
    );

    match sqlx::query(&stmt).execute(pool).await {
        Ok(r) if r.rows_affected() > 0 => {
            tracing::info!(
                "Sync: backfilled {} missing '{}' row(s) into sync_queue.",
                r.rows_affected(), table
            );
        }
        Ok(_)  => {}
        Err(e) => tracing::warn!("force_resync_table({table}) phase-2 error: {e}"),
    }
}

/// Seed the CLOUD database's business scope. Runs once per app session, as
/// soon as the push worker has a healthy cloud pool and a business_id.
///
/// Root-cause fix for "row created directly in Supabase never appears
/// locally": every pull query filters `WHERE business_id = <uuid>`, and the
/// 0075 auto-stamp trigger fills business_id from app_config — but the CLOUD
/// app_config was never seeded, so rows inserted directly in Supabase (table
/// editor / SQL) got business_id = NULL and were invisible to every device.
///
/// Two steps, both idempotent:
///   1. Seed cloud app_config.business_id → the 0075 trigger now stamps all
///      FUTURE direct inserts automatically.
///   2. Repair EXISTING NULL business_id rows in synced tables. The 0098
///      stamp trigger bumps cloud_synced_at on the repaired rows, so they
///      land ahead of every device's pull cursor and sync down on the next
///      cycle — the fix is self-healing, no manual resync needed.
async fn seed_cloud_business_scope(cloud_pool: &PgPool, business_id: Uuid) {
    let biz = business_id.to_string();

    match sqlx::query(
        "INSERT INTO app_config (key, value) VALUES ('business_id', $1)
         ON CONFLICT (key) DO NOTHING",
    )
    .bind(&biz)
    .execute(cloud_pool)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            tracing::info!("Sync: seeded cloud app_config.business_id — direct cloud inserts will now be auto-stamped.");
        }
        Ok(_)  => {}
        Err(e) => {
            tracing::warn!("Sync: could not seed cloud business_id: {e}");
            return;
        }
    }

    for table in SYNC_TABLES {
        if *table == "businesses" {
            continue; // keyed by id, no business_id column
        }
        let stmt = format!("UPDATE {table} SET business_id = $1::uuid WHERE business_id IS NULL");
        match sqlx::query(&stmt).bind(&biz).execute(cloud_pool).await {
            Ok(r) if r.rows_affected() > 0 => {
                tracing::info!(
                    "Sync: claimed {} orphaned '{}' cloud row(s) (business_id was NULL — likely inserted directly in Supabase).",
                    r.rows_affected(), table
                );
            }
            Ok(_)  => {}
            Err(e) => tracing::debug!("Sync: business_id repair skipped for {table}: {e}"),
        }
    }
}

// ── Live sync events (Tauri) ──────────────────────────────────────────────────
// Emitted by the workers on state transitions so Settings → Sync renders live
// progress instead of polling. Events only reach the UI on the server device;
// client-mode devices keep the get_sync_status RPC.

// ════════════════════════════════════════════════════════════════════════════
// SYNC CYCLE INSTRUMENTATION
// ════════════════════════════════════════════════════════════════════════════
// Replaces the old `sync:status` event, which was a status indicator being
// asked to do a log's job. Its specific failure modes, all fixed here:
//
//   • Push and pull both wrote to one channel with no coordination, so a pull
//     finishing mid-push painted the UI "idle" while a push was still running.
//     Every event is now tagged with `cycle_id` + `direction`; the frontend
//     tracks the two independently and they can no longer overwrite each other.
//
//   • "Pushing N changes" was emitted BEFORE the work, using the count of rows
//     claimed. Tier-gating then skipped most of them and nothing corrected the
//     number. Totals are now reported at cycle END from actual outcomes.
//
//   • Every failure showed one hardcoded sentence. The real error was written
//     to sync_queue.error and never surfaced. Errors are now classified into
//     an error_code and the detail is carried through to the UI.
//
//   • Pull-side apply failures went to tracing::warn! and nowhere else — they
//     were structurally invisible. Pull now runs through the same cycle
//     recorder as push.
// ════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SyncDirection { Push, Pull }

impl SyncDirection {
    fn as_str(self) -> &'static str {
        match self { SyncDirection::Push => "push", SyncDirection::Pull => "pull" }
    }
}

/// Coarse failure classification so the UI can group and explain failures
/// rather than printing one sentence for every error class.
///
/// Matching is on message text because sqlx surfaces most of these as opaque
/// `Database` errors; we check the most specific patterns first.
fn classify_error(err: &str) -> &'static str {
    let e = err.to_ascii_lowercase();
    if e.contains("violates foreign key constraint")             { return "fk_violation"; }
    if e.contains("violates unique constraint")
        || e.contains("violates check constraint")
        || e.contains("violates not-null constraint")            { return "constraint"; }
    if e.contains("could not serialize")
        || e.contains("deadlock detected")                       { return "serialization"; }
    if e.contains("password authentication failed")
        || e.contains("permission denied")
        || e.contains("jwt")
        || e.contains("not authorized")                          { return "auth"; }
    if e.contains("connection")
        || e.contains("timed out")
        || e.contains("timeout")
        || e.contains("dns")
        || e.contains("broken pipe")
        || e.contains("os error")                                { return "network"; }
    "unknown"
}

/// One buffered row-level outcome. Held in memory for the duration of a cycle
/// and flushed in a single batch INSERT — writing per-row would double the
/// database traffic of the sync itself.
struct SyncLogEntry {
    table_name:   String,
    row_id:       Option<String>,
    operation:    Option<String>,
    outcome:      &'static str,
    error_code:   Option<&'static str>,
    error_detail: Option<String>,
    duration_ms:  Option<i32>,
    attempt:      i32,
}

/// Accumulates one worker pass: per-row outcomes plus the counters the UI needs.
pub struct SyncCycle {
    id:        Uuid,
    direction: SyncDirection,
    started:   std::time::Instant,
    attempted: u32,
    succeeded: u32,
    failed:    u32,
    skipped:   u32,
    conflicts: u32,
    /// Idempotent no-ops: duplicate delivery, self-echo, or a row that lost a
    /// conflict. Counted for an honest summary but deliberately NOT written to
    /// sync_event_log — the pull worker re-reads rows this device just pushed, so
    /// logging every no-op would bury real events under self-echo noise.
    noop:      u32,
    tables:    std::collections::BTreeSet<String>,
    entries:   Vec<SyncLogEntry>,
}

impl SyncCycle {
    fn new(direction: SyncDirection) -> Self {
        Self {
            id: Uuid::new_v4(),
            direction,
            started: std::time::Instant::now(),
            attempted: 0, succeeded: 0, failed: 0, skipped: 0, conflicts: 0, noop: 0,
            tables: std::collections::BTreeSet::new(),
            entries: Vec::new(),
        }
    }

    /// True when nothing happened at all — no logged entries and no no-ops.
    fn is_empty(&self) -> bool { self.entries.is_empty() && self.noop == 0 }

    /// Count an idempotent no-op without writing a log row (see `noop` field).
    fn noop(&mut self, table: &str) {
        self.attempted += 1;
        self.noop += 1;
        self.tables.insert(table.to_string());
    }

    fn elapsed_ms(&self) -> i64 { self.started.elapsed().as_millis() as i64 }

    /// Record a successful row apply.
    fn ok(&mut self, table: &str, row_id: &str, op: &str, dur_ms: Option<i32>, attempt: i32) {
        self.attempted += 1;
        self.succeeded += 1;
        self.tables.insert(table.to_string());
        self.entries.push(SyncLogEntry {
            table_name: table.to_string(),
            row_id: Some(row_id.to_string()),
            operation: Some(op.to_string()),
            outcome: "ok",
            error_code: None,
            error_detail: None,
            duration_ms: dur_ms,
            attempt,
        });
    }

    /// Record a failed row apply, classifying the error for the UI.
    fn fail(&mut self, table: &str, row_id: &str, op: &str, err: &str, dur_ms: Option<i32>, attempt: i32) {
        self.attempted += 1;
        self.failed += 1;
        self.tables.insert(table.to_string());
        self.entries.push(SyncLogEntry {
            table_name: table.to_string(),
            row_id: Some(row_id.to_string()),
            operation: Some(op.to_string()),
            outcome: "failed",
            error_code: Some(classify_error(err)),
            // Cap the stored detail: some Postgres FK errors embed the whole
            // offending row and would otherwise bloat the log table.
            error_detail: Some(err.chars().take(500).collect()),
            duration_ms: dur_ms,
            attempt,
        });
    }

    /// Record a row that was never attempted because a lower FK tier failed.
    /// Previously these vanished — the UI showed them inside "Pushing N" and
    /// then simply never mentioned them again.
    fn skip(&mut self, table: &str, row_id: &str, op: &str, reason: &str) {
        self.skipped += 1;
        self.tables.insert(table.to_string());
        self.entries.push(SyncLogEntry {
            table_name: table.to_string(),
            row_id: Some(row_id.to_string()),
            operation: Some(op.to_string()),
            outcome: "skipped",
            error_code: None,
            error_detail: Some(reason.to_string()),
            duration_ms: None,
            attempt: 0,
        });
    }

    /// Persist the buffered entries in one round trip, then emit the summary.
    async fn finish(mut self, local_pool: &PgPool, state: &AppState) {
        if !self.entries.is_empty() {
            let entries = std::mem::take(&mut self.entries);

            let cycle_ids:  Vec<Uuid>           = vec![self.id; entries.len()];
            let directions: Vec<String>         = vec![self.direction.as_str().to_string(); entries.len()];
            let tables:     Vec<String>         = entries.iter().map(|e| e.table_name.clone()).collect();
            let row_ids:    Vec<Option<String>> = entries.iter().map(|e| e.row_id.clone()).collect();
            let ops:        Vec<Option<String>> = entries.iter().map(|e| e.operation.clone()).collect();
            let outcomes:   Vec<String>         = entries.iter().map(|e| e.outcome.to_string()).collect();
            let codes:      Vec<Option<String>> = entries.iter().map(|e| e.error_code.map(str::to_string)).collect();
            let details:    Vec<Option<String>> = entries.iter().map(|e| e.error_detail.clone()).collect();
            let durations:  Vec<Option<i32>>    = entries.iter().map(|e| e.duration_ms).collect();
            let attempts:   Vec<i32>            = entries.iter().map(|e| e.attempt).collect();

            if let Err(e) = sqlx::query(
                r#"INSERT INTO sync_event_log
                     (cycle_id, direction, table_name, row_id, operation,
                      outcome, error_code, error_detail, duration_ms, attempt)
                   SELECT * FROM UNNEST(
                     $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[],
                     $6::text[], $7::text[], $8::text[], $9::int[],  $10::int[]
                   )"#,
            )
            .bind(&cycle_ids).bind(&directions).bind(&tables).bind(&row_ids).bind(&ops)
            .bind(&outcomes).bind(&codes).bind(&details).bind(&durations).bind(&attempts)
            .execute(local_pool)
            .await
            {
                // Logging must never break syncing.
                tracing::warn!("sync_event_log insert failed (non-fatal): {e}");
            }
        }

        emit_cycle(state, &self, "end").await;
    }
}

#[derive(serde::Serialize, Clone)]
struct SyncCycleEvent {
    cycle_id:  String,
    direction: &'static str,
    /// start | progress | end
    phase:     &'static str,
    attempted: u32,
    succeeded: u32,
    failed:    u32,
    skipped:   u32,
    conflicts: u32,
    noop:      u32,
    tables:    Vec<String>,
    duration_ms: i64,
    /// Live queue depth, so the UI never has to reconcile two sources.
    pending:      i64,
    failed_total: i64,
}

/// Emit a `sync:cycle` event. Never fails the caller.
async fn emit_cycle(state: &AppState, cycle: &SyncCycle, phase: &'static str) {
    use tauri::Emitter;
    let handle = { state.app_handle.lock().await.clone() };
    let Some(handle) = handle else { return };

    let (pending, failed_total) = queue_depth(state).await;

    let _ = handle.emit("sync:cycle", SyncCycleEvent {
        cycle_id:  cycle.id.to_string(),
        direction: cycle.direction.as_str(),
        phase,
        attempted: cycle.attempted,
        succeeded: cycle.succeeded,
        failed:    cycle.failed,
        skipped:   cycle.skipped,
        conflicts: cycle.conflicts,
        noop:      cycle.noop,
        tables:    cycle.tables.iter().cloned().collect(),
        duration_ms: cycle.elapsed_ms(),
        pending,
        failed_total,
    });
}

/// Current queue depth as (pending, failed).
///
/// This used to be two separate `COUNT(*)` scans fired on EVERY status event.
/// One grouped scan replaces both — and since synced rows are now pruned
/// (see prune_sync_queue), the table it scans no longer grows without bound.
async fn queue_depth(state: &AppState) -> (i64, i64) {
    let Ok(pool) = state.pool().await else { return (0, 0) };

    let rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT status, COUNT(*) FROM sync_queue
          WHERE status IN ('pending', 'failed')
          GROUP BY status",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let mut pending = 0;
    let mut failed  = 0;
    for (status, count) in rows {
        match status.as_str() {
            "pending" => pending = count,
            "failed"  => failed  = count,
            _ => {}
        }
    }
    (pending, failed)
}

/// Emit a lightweight offline/idle notice with no cycle attached.
async fn emit_simple_state(state: &AppState, phase: &'static str, direction: SyncDirection) {
    let cycle = SyncCycle::new(direction);
    emit_cycle(state, &cycle, phase).await;
}

/// Drop old terminal rows so sync_queue and sync_event_log stay bounded.
///
/// Before this, the only DELETE on sync_queue happened when the cloud database
/// was switched — meaning 'synced' rows accumulated for the life of the
/// install, slowing every status poll (see the index note in 0105_sync_event_log).
async fn prune_sync_history(local_pool: &PgPool) {
    // Keep a week of successful pushes: enough to investigate a report of
    // "yesterday's sale is missing", far short of unbounded.
    match sqlx::query(
        "DELETE FROM sync_queue
          WHERE status = 'synced' AND synced_at < NOW() - INTERVAL '7 days'",
    )
    .execute(local_pool)
    .await
    {
        Ok(r) if r.rows_affected() > 0 =>
            tracing::info!("Sync prune: removed {} old synced queue row(s).", r.rows_affected()),
        Err(e) => tracing::warn!("Sync prune (queue) failed: {e}"),
        _ => {}
    }

    // The log is chattier than the queue, so it gets a shorter window.
    match sqlx::query(
        "DELETE FROM sync_event_log WHERE created_at < NOW() - INTERVAL '3 days'",
    )
    .execute(local_pool)
    .await
    {
        Ok(r) if r.rows_affected() > 0 =>
            tracing::info!("Sync prune: removed {} old sync_event_log row(s).", r.rows_affected()),
        Err(e) => tracing::warn!("Sync prune (log) failed: {e}"),
        _ => {}
    }
}

/// Emit `sync:applied` after a pull cycle lands rows locally, so the frontend
/// invalidates the matching React Query caches and pulled changes (new store,
/// price edit, …) appear on screen without a manual refresh.
async fn emit_sync_applied(state: &AppState, tables: &[&str]) {
    use tauri::Emitter;
    if let Some(handle) = state.app_handle.lock().await.clone() {
        let _ = handle.emit("sync:applied", serde_json::json!({ "tables": tables }));
    }
}

/// Spawn the background sync loop. Should be called once at app startup.
///
/// # Tier-gated processing
/// Rows are fetched already ordered by FK-dependency tier (businesses=0 →
/// stores=1 → categories=2 → items=3 → item_stock=4 → …). Within each poll
/// cycle the loop groups rows by tier and processes them in strict order:
///
///   • If ALL rows in tier N succeed → proceed to tier N+1.
///   • If ANY row in tier N fails    → release all unclaimed tier > N rows
///     back to 'pending' and end the cycle. Children are never attempted
///     when their parents failed.
///
/// Additionally, on any FK constraint failure the parent table's already-
/// 'synced' rows are reset to 'pending' so a stale parent that never really
/// landed in Supabase is automatically re-pushed on the next cycle.
pub async fn run_sync_loop(state: AppState) {
    tracing::info!("Cloud sync worker started — instant wake + {POLL_SECS}s fallback poll");
    // Once-per-session cloud scope seeding (see seed_cloud_business_scope).
    let mut cloud_scope_seeded = false;
    // Last emitted phase — quiet states (offline/idle) fire on transition only,
    // so a terminal sitting idle overnight doesn't emit thousands of events.
    // Real cycles always emit, because each one carries distinct results.
    let mut last_quiet: &'static str = "";
    // Prune runs on a slow counter rather than every cycle (every 5s would be
    // pointless write traffic for a housekeeping job).
    let mut cycles_since_prune: u32 = 0;

    loop {
        // Instant wake on queue_row, 5s tick as the reliability fallback.
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(POLL_SECS)) => {}
            _ = PUSH_WAKE.notified() => {}
        }

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
            if last_quiet != "offline" {
                last_quiet = "offline";
                emit_simple_state(&state, "offline", SyncDirection::Push).await;
            }
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
                load_biz_id(&local_pool).await.unwrap_or_else(|| {
                    tracing::debug!("Push worker: no business_id yet — skipping cycle");
                    Uuid::nil()
                })
            }
        };
        if business_id.is_nil() {
            continue;
        }

        // One-time cloud scope seed + orphan repair (see fn docs — this is
        // what makes rows inserted directly in Supabase reach the devices).
        if !cloud_scope_seeded {
            seed_cloud_business_scope(&cloud_pool, business_id).await;
            cloud_scope_seeded = true;
        }

        // Fetch a batch of pending rows, tier-ordered so parents come first.
        // We fetch more than BATCH_SIZE here so that tier-gating doesn't
        // accidentally leave parent rows out when a full batch is all one table.
        let rows = match sqlx::query!(
            r#"SELECT id, table_name, operation, row_id, row_data, store_id, retries
               FROM sync_queue
               WHERE status = 'pending'
                 AND retries < $1
                 AND (business_id = $2 OR business_id IS NULL)
               ORDER BY
                 CASE table_name
                   WHEN 'businesses'           THEN 0
                   WHEN 'stores'               THEN 1
                   WHEN 'users'                THEN 1
                   WHEN 'departments'          THEN 2
                   WHEN 'categories'           THEN 2
                   WHEN 'suppliers'            THEN 2
                   WHEN 'tax_categories'       THEN 2
                   WHEN 'items'                THEN 3
                   WHEN 'customers'            THEN 3
                   WHEN 'item_stock'           THEN 4
                   WHEN 'stock_movements'      THEN 5
                   WHEN 'shifts'               THEN 5
                   WHEN 'transactions'         THEN 6
                   WHEN 'purchase_orders'      THEN 6
                   WHEN 'credit_sales'         THEN 6
                   WHEN 'expenses'             THEN 6
                   WHEN 'transaction_items'    THEN 7
                   WHEN 'payments'             THEN 7
                   WHEN 'returns'              THEN 7
                   WHEN 'purchase_order_items' THEN 7
                   WHEN 'cash_movements'       THEN 7
                   WHEN 'return_items'         THEN 8
                   WHEN 'supplier_payments'    THEN 9
                   WHEN 'customer_wallet_transactions' THEN 9
                   WHEN 'loyalty_transactions' THEN 9
                   WHEN 'reorder_alerts'       THEN 9
                   WHEN 'notifications'        THEN 9
                   ELSE 10
                 END ASC,
                 created_at ASC
               LIMIT $3"#,
            MAX_RETRIES,
            business_id,
            BATCH_SIZE,
        )
        .fetch_all(&local_pool)
        .await
        {
            Ok(r)  => r,
            Err(e) => { tracing::warn!("sync_queue read failed: {e}"); continue; }
        };

        if rows.is_empty() {
            // Transition back to idle after a busy/offline stretch. Housekeeping
            // happens here, on a quiet cycle, so it never delays real work.
            if last_quiet != "idle" && !last_quiet.is_empty() {
                last_quiet = "idle";
                emit_simple_state(&state, "idle", SyncDirection::Push).await;
            }
            cycles_since_prune += 1;
            if cycles_since_prune >= PRUNE_EVERY_N_CYCLES {
                cycles_since_prune = 0;
                prune_sync_history(&local_pool).await;
            }
            continue;
        }

        tracing::debug!("Cloud sync: processing {} row(s)", rows.len());

        // A real cycle is starting — anything we emit from here is attributable
        // to this cycle_id, so the pull worker can no longer overwrite it.
        last_quiet = "";
        let mut cycle = SyncCycle::new(SyncDirection::Push);
        emit_cycle(&state, &cycle, "start").await;

        // ── Tier-gated processing ─────────────────────────────────────────────
        // Group by tier, then process each tier completely before moving to the
        // next. If any row fails in tier N, all rows from tiers > N are released
        // back to 'pending' untouched — children are never attempted when their
        // parents haven't landed yet.
        //
        // We collect into a Vec<(tier, row)> first so we can iterate tiers in
        // order and know which rows belong to which tier.
        let mut tier_rows: Vec<(u8, _)> = rows
            .into_iter()
            .map(|r| (table_tier(&r.table_name), r))
            .collect();
        tier_rows.sort_by_key(|(t, _)| *t);

        // The highest tier that had at least one failure. Once set, all rows
        // from higher tiers are skipped this cycle.
        let mut failed_at_tier: Option<u8> = None;
        // Parent tables that need a forced resync this cycle. Collected here so
        // we call force_resync_table at most once per table per cycle instead of
        // once per failing row (which caused repeated "reset 57 rows" log spam
        // and redundant DB writes when multiple items fail in the same batch).
        let mut tables_to_resync: HashSet<&'static str> = HashSet::new();

        for (tier, row) in tier_rows {
            // If a lower tier failed, just leave this row as-is (still 'pending').
            // These used to disappear silently: counted in the up-front "Pushing
            // N" figure, then never mentioned again. Now they are recorded as
            // 'skipped' with the reason, so the numbers reconcile.
            if failed_at_tier.map_or(false, |ft| tier > ft) {
                cycle.skip(
                    &row.table_name,
                    &row.row_id,
                    &row.operation,
                    "Parent table failed earlier in this cycle — deferred to next cycle",
                );
                continue;
            }

            let id         = row.id;
            let table      = row.table_name.clone();
            let operation  = row.operation.clone();
            let row_id_str = row.row_id.clone();
            let data       = row.row_data.clone();
            let attempt    = row.retries + 1;

            // Atomic claim: only one worker processes each row
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

            let row_started = std::time::Instant::now();
            let result = replay_row(&cloud_pool, &local_pool, &table, &operation, &row_id_str, &data).await;
            let row_ms = row_started.elapsed().as_millis() as i32;

            match result {
                Ok(()) => {
                    let _ = sqlx::query!(
                        "UPDATE sync_queue SET status = 'synced', synced_at = NOW() WHERE id = $1",
                        id,
                    )
                    .execute(&local_pool)
                    .await;
                    tracing::debug!("Synced {table} row {row_id_str} to cloud.");
                    cycle.ok(&table, &row_id_str, &operation, Some(row_ms), attempt);
                }
                Err(e) => {
                    let err_str = e.to_string();
                    tracing::warn!("Cloud sync failed for {table} row {row_id_str}: {err_str}");
                    // The real error text reaches the UI from here. Previously it
                    // was written to sync_queue.error and then replaced with the
                    // fixed string "Some changes failed to push".
                    cycle.fail(&table, &row_id_str, &operation, &err_str, Some(row_ms), attempt);

                    // Gate: don't attempt higher tiers this cycle
                    if failed_at_tier.map_or(true, |ft| tier < ft) {
                        failed_at_tier = Some(tier);
                    }

                    // If this is a FK violation, collect the parent table for a
                    // forced resync after the batch. We deduplicate here so that
                    // force_resync_table is called at most once per parent table
                    // per cycle, even when multiple child rows fail in the same batch.
                    if err_str.contains("violates foreign key constraint") {
                        if let Some(parent) = fk_parent_table(&err_str) {
                            tables_to_resync.insert(parent);
                        }
                    }

                    // Update retry counter / mark failed if exhausted
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

        // After processing the full batch, perform any deferred parent-table
        // resyncs. Doing this outside the per-row loop guarantees each parent
        // table is touched at most once per cycle regardless of how many child
        // rows failed with the same FK constraint.
        for parent in tables_to_resync {
            force_resync_table(&local_pool, parent).await;
        }

        // End of cycle: persist every row outcome and emit the real totals.
        // These numbers come from what actually happened, not from the batch
        // size guessed before the work started.
        cycle.finish(&local_pool, &state).await;
    }
}

/// Returns the FK-dependency tier for a table so the push worker can sort a
/// mixed batch and guarantee parent rows are always replayed before children.
/// Lower number = synced first.
fn table_tier(table: &str) -> u8 {
    match table {
        "businesses"                                    => 0,
        "stores" | "users"                              => 1,
        "departments" | "categories" | "suppliers"
            | "tax_categories"                          => 2,
        "items" | "customers"                          => 3,
        "item_stock"                                    => 4, // depends on items — must be a higher tier
        "stock_movements"                               => 5, // must replay AFTER item_stock seeds
        "shifts"                                        => 5,
        "transactions" | "purchase_orders"
            | "credit_sales" | "expenses"               => 6,
        "transaction_items" | "payments"
            | "returns" | "purchase_order_items"
            | "cash_movements"                          => 7,
        "return_items"                                  => 8,
        // Ledgers depend on customers(3)/suppliers(2)/transactions(6)/POs(6)
        "supplier_payments" | "customer_wallet_transactions"
            | "loyalty_transactions"                    => 9,
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

// ============================================================================
// STRATEGY-AWARE ROW APPLY  (shared by push replay and pull apply)
// ============================================================================

type SyncError = Box<dyn std::error::Error + Send + Sync>;

#[derive(Debug, PartialEq, Eq)]
enum ApplyOutcome {
    /// Row was inserted or the target row was overwritten.
    Applied,
    /// Idempotent no-op: duplicate delivery, self-echo, or the target row won
    /// the conflict (already logged). Terminal success for the queue either way.
    Skipped,
}

/// Record a fact in the audit log for external mutation sites (POS sale,
/// PO receive, stock count, …): every item_stock mutation must also append a
/// stock_movements row IN THE SAME DB TRANSACTION, then queue it for push
/// after commit with the returned (row_id, row_json).
///
/// Exactly one of `qty_delta` / `qty_set` must be Some: a signed delta for
/// incremental changes, an absolute quantity for physical counts/imports.
pub async fn log_stock_movement<'e, E>(
    exec:      E,
    item_id:   Uuid,
    store_id:  i32,
    qty_delta: Option<rust_decimal::Decimal>,
    qty_set:   Option<rust_decimal::Decimal>,
    reason:    &str,
) -> Result<(String, Value), sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    use sqlx::Row as _;
    let movement = if qty_set.is_some() { "set" } else { "delta" };
    let row = sqlx::query(
        r#"INSERT INTO stock_movements
               (item_id, store_id, business_id, movement, qty_delta, qty_set, reason, device_id)
           VALUES ($1, $2,
                   (SELECT value::uuid FROM app_config WHERE key = 'business_id'),
                   $3, $4, $5, $6,
                   (SELECT value::uuid FROM app_config WHERE key = 'device_id'))
           RETURNING id::text AS id, row_to_json(stock_movements)::jsonb AS row_json"#,
    )
    .bind(item_id)
    .bind(store_id)
    .bind(movement)
    .bind(qty_delta)
    .bind(qty_set)
    .bind(reason)
    .fetch_one(exec)
    .await?;

    Ok((row.get::<String, _>("id"), row.get::<Value, _>("row_json")))
}

/// Fetch the target's current version of a row as JSON (used for conflict
/// logging after a guarded UPSERT was rejected). Single-`id`-pk tables only.
async fn fetch_current_row(pool: &PgPool, table: &str, row_id: &str) -> Option<Value> {
    let stmt = format!("SELECT row_to_json(t.*)::jsonb FROM {table} t WHERE t.id::text = $1");
    sqlx::query_scalar::<_, Value>(&stmt)
        .bind(row_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

fn json_str(v: &Value, key: &str) -> Option<String> {
    match v.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn json_ts(v: &Value, key: &str) -> Option<chrono::DateTime<Utc>> {
    v.get(key)
        .and_then(|x| x.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.with_timezone(&Utc))
}

/// Write one row to the local `sync_conflicts` audit table. Non-fatal.
async fn log_sync_conflict(
    log_pool:  &PgPool,
    table:     &str,
    row_id:    &str,
    direction: &str, // 'push' | 'pull'
    incoming:  &Value,
    current:   &Value,
) {
    let result = sqlx::query(
        r#"INSERT INTO sync_conflicts
               (table_name, row_id, direction,
                incoming_version, current_version,
                incoming_updated_at, current_updated_at,
                incoming_device, current_device, incoming_row)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9::uuid, $10)"#,
    )
    .bind(table)
    .bind(row_id)
    .bind(direction)
    .bind(incoming.get("sync_version").and_then(|v| v.as_i64()))
    .bind(current.get("sync_version").and_then(|v| v.as_i64()))
    .bind(json_ts(incoming, "updated_at"))
    .bind(json_ts(current, "updated_at"))
    .bind(json_str(incoming, "origin_device_id"))
    .bind(json_str(current, "origin_device_id"))
    .bind(incoming)
    .execute(log_pool)
    .await;

    match result {
        Ok(_) => tracing::info!(
            "Sync conflict on {table} row {row_id} ({direction}): incoming write lost, kept current row."
        ),
        Err(e) => tracing::warn!("sync_conflicts insert failed (non-fatal): {e}"),
    }
}

/// Apply a replicated row to `target` using the table's conflict strategy.
/// `conflict_log` is always the LOCAL pool — rejected writes are audited on
/// the device that observed the conflict.
async fn apply_synced_row(
    target:       &PgPool,
    conflict_log: &PgPool,
    table:        &str,
    row:          &Value,
    direction:    &str, // 'push' (target = cloud) | 'pull' (target = local)
) -> Result<ApplyOutcome, SyncError> {
    let obj = match row.as_object() {
        Some(o) if !o.is_empty() => o,
        _ => return Ok(ApplyOutcome::Skipped),
    };

    let strategy = sync_strategy(table);

    // stock_movements: append + apply the delta to item_stock on first sight.
    if strategy == SyncStrategy::StockMovement {
        return apply_stock_movement(target, row, direction == "push").await;
    }

    let pk = pk_col(table);

    // item_stock: seed-only. Insert when absent, never overwrite — quantities
    // are owned by the stock_movements delta stream. cloud_seeded_at records
    // the snapshot's own updated_at so later movement applies can tell which
    // movements the seed already includes.
    if strategy == SyncStrategy::StockSeed {
        let mut seeded = row.clone();
        if let Some(m) = seeded.as_object_mut() {
            let ts = m.get("updated_at").cloned().unwrap_or(Value::Null);
            m.insert("cloud_seeded_at".into(), ts);
        }
        let stmt = format!(
            "INSERT INTO {table} \
             SELECT * FROM jsonb_populate_record(null::{table}, $1::jsonb) \
             ON CONFLICT ({pk}) DO NOTHING"
        );
        let n = sqlx::query(&stmt).bind(&seeded).execute(target).await?.rows_affected();
        return Ok(if n == 1 { ApplyOutcome::Applied } else { ApplyOutcome::Skipped });
    }

    let cols: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
    let updates: Vec<String> = cols
        .iter()
        .filter(|&&c| c != pk)
        .map(|c| format!("{c} = EXCLUDED.{c}"))
        .collect();

    match strategy {
        SyncStrategy::AppendOnly => {
            let stmt = format!(
                "INSERT INTO {table} \
                 SELECT * FROM jsonb_populate_record(null::{table}, $1::jsonb) \
                 ON CONFLICT ({pk}) DO NOTHING"
            );
            let n = sqlx::query(&stmt).bind(row).execute(target).await?.rows_affected();
            Ok(if n == 1 { ApplyOutcome::Applied } else { ApplyOutcome::Skipped })
        }
        SyncStrategy::Lww | SyncStrategy::StateMachine => {
            // Guard: LWW alone for reference data; status-rank first (a more
            // final status always wins, regardless of timestamps), LWW as the
            // same-rank fallback, for state-machine tables.
            let lww = lww_guard_sql(table);
            let guard = match status_rank_case(table, table) {
                Some(cur_rank) => {
                    let inc_rank = status_rank_case(table, "EXCLUDED").unwrap();
                    format!("{inc_rank} > {cur_rank} OR ({inc_rank} = {cur_rank} AND {lww})")
                }
                None => lww,
            };
            let stmt = format!(
                "INSERT INTO {table} \
                 SELECT * FROM jsonb_populate_record(null::{table}, $1::jsonb) \
                 ON CONFLICT ({pk}) DO UPDATE SET {upd} \
                 WHERE {guard}",
                upd = updates.join(", "),
            );

            // Transaction so the zera.sync_apply GUC (set_config … is_local =
            // true) suppresses the version-bump trigger for exactly this write.
            let mut tx = target.begin().await?;
            sqlx::query("SELECT set_config('zera.sync_apply', 'on', true)")
                .execute(&mut *tx)
                .await?;
            let n = sqlx::query(&stmt).bind(row).execute(&mut *tx).await?.rows_affected();
            tx.commit().await?;

            if n == 1 {
                return Ok(ApplyOutcome::Applied);
            }

            // Guard rejected the write: either a self-echo (identical row —
            // e.g. re-pulling a row this device just pushed) or a genuine
            // conflict the current row won. Only the latter is logged.
            let row_id = json_str(row, "id").unwrap_or_default();
            if let Some(current) = fetch_current_row(target, table, &row_id).await {
                let same_version = current.get("sync_version") == row.get("sync_version");
                let same_device  = current.get("origin_device_id") == row.get("origin_device_id");
                if !(same_version && same_device) {
                    log_sync_conflict(conflict_log, table, &row_id, direction, row, &current).await;
                }
            }
            Ok(ApplyOutcome::Skipped)
        }
        // Handled above; unreachable here.
        SyncStrategy::StockSeed | SyncStrategy::StockMovement => Ok(ApplyOutcome::Skipped),
    }
}

/// Apply one stock_movements row to `target`: insert it (UUID dedupe), and —
/// only when the insert was new — fold its delta/set into item_stock.
///
/// Idempotency: applying twice is safe because the second insert hits
/// ON CONFLICT DO NOTHING and the fold is skipped. Movements this device
/// originated are skipped the same way (already inserted locally at write
/// time), so a device never double-counts its own history when pulling.
///
/// Seed skew guard: a seeded item_stock snapshot already includes every
/// movement applied before the snapshot was taken. `cloud_seeded_at` (set at
/// seed time to the snapshot's updated_at) is compared against the movement's
/// COALESCE(applied_at, created_at); movements at or before it are recorded
/// for dedupe but NOT re-folded.
async fn apply_stock_movement(
    target:   &PgPool,
    row:      &Value,
    is_push:  bool, // pushing to cloud → stamp applied_at with the cloud clock
) -> Result<ApplyOutcome, SyncError> {
    let mut tx = target.begin().await?;

    let inserted = sqlx::query(
        "INSERT INTO stock_movements \
         SELECT * FROM jsonb_populate_record(null::stock_movements, $1::jsonb) \
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(row)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if inserted == 0 {
        tx.commit().await?;
        return Ok(ApplyOutcome::Skipped);
    }

    let movement_id = json_str(row, "id").ok_or("stock_movement missing id")?;
    let item_id: Uuid = json_str(row, "item_id")
        .and_then(|s| s.parse().ok())
        .ok_or("stock_movement missing item_id")?;
    let store_id: i64 = json_str(row, "store_id")
        .and_then(|s| s.parse().ok())
        .ok_or("stock_movement missing store_id")?;
    let store_id = store_id as i32;
    let movement = json_str(row, "movement").unwrap_or_default();
    let created_at = json_ts(row, "created_at").ok_or("stock_movement missing created_at")?;
    let comparator = json_ts(row, "applied_at").unwrap_or(created_at);

    // Numeric quantities travel as JSON numbers; POS quantities are far below
    // f64's 15-digit precision so this round-trip is exact in practice.
    let qty = |key: &str| -> Option<rust_decimal::Decimal> {
        row.get(key)
            .and_then(|v| v.as_f64())
            .and_then(|f| rust_decimal::Decimal::try_from(f).ok())
    };

    use sqlx::Row as _;
    let existing = sqlx::query(
        "SELECT cloud_seeded_at, last_count_date FROM item_stock \
         WHERE item_id = $1 AND store_id = $2 FOR UPDATE",
    )
    .bind(item_id)
    .bind(store_id)
    .fetch_optional(&mut *tx)
    .await?;

    let mut folded = false;
    match existing {
        None => {
            // No baseline yet (item is new everywhere): the movement itself
            // becomes the row. Delta counts up from 0; set is absolute.
            let q = if movement == "set" { qty("qty_set") } else { qty("qty_delta") }
                .ok_or("stock_movement missing quantity")?;
            sqlx::query(
                "INSERT INTO item_stock (item_id, store_id, quantity, available_quantity, updated_at) \
                 VALUES ($1, $2, $3, $3, NOW()) \
                 ON CONFLICT (item_id, store_id) DO NOTHING",
            )
            .bind(item_id)
            .bind(store_id)
            .bind(q)
            .execute(&mut *tx)
            .await?;
            folded = true;
        }
        Some(r) => {
            let seeded_at: Option<chrono::DateTime<Utc>> = r.try_get("cloud_seeded_at").ok().flatten();
            let last_count: Option<chrono::DateTime<Utc>> = r.try_get("last_count_date").ok().flatten();
            let past_seed = seeded_at.map_or(true, |s| comparator > s);

            if past_seed && movement == "delta" {
                let d = qty("qty_delta").ok_or("stock_movement missing qty_delta")?;
                sqlx::query(
                    "UPDATE item_stock \
                     SET quantity           = quantity + $1, \
                         available_quantity = available_quantity + $1, \
                         updated_at         = NOW() \
                     WHERE item_id = $2 AND store_id = $3",
                )
                .bind(d)
                .bind(item_id)
                .bind(store_id)
                .execute(&mut *tx)
                .await?;
                folded = true;
            } else if past_seed && movement == "set" {
                // A physical count is ground truth at count time — apply only
                // if no newer count already landed.
                if last_count.map_or(true, |l| created_at > l) {
                    let q = qty("qty_set").ok_or("stock_movement missing qty_set")?;
                    sqlx::query(
                        "UPDATE item_stock \
                         SET quantity           = $1, \
                             available_quantity = GREATEST(0, $1 - COALESCE(reserved_quantity, 0)), \
                             last_count_date    = $2, \
                             updated_at         = NOW() \
                         WHERE item_id = $3 AND store_id = $4",
                    )
                    .bind(q)
                    .bind(created_at)
                    .bind(item_id)
                    .bind(store_id)
                    .execute(&mut *tx)
                    .await?;
                    folded = true;
                }
            }
        }
    }

    if is_push {
        // Cloud-clock apply stamp: lets pulling devices tell whether a seeded
        // snapshot already contains this movement (see module comment).
        sqlx::query("UPDATE stock_movements SET applied_at = NOW() WHERE id = $1::uuid")
            .bind(&movement_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(if folded { ApplyOutcome::Applied } else { ApplyOutcome::Skipped })
}

/// Spawn the background pull loop. Should be called once at app startup,
/// alongside `run_sync_loop`. Polls Supabase every POLL_SECS for rows that
/// are newer than the stored cursor and UPSERTs them into local PostgreSQL.
///
/// # Cursor accuracy
/// The cursor is advanced to the MAX timestamp of the pulled rows — NOT to
/// `Utc::now()`. Advancing to now() races ahead of rows that arrive at Supabase
/// with a timestamp slightly behind the wall clock (network lag, batch writes),
/// silently skipping them forever. Using the actual max pulled timestamp ensures
/// every row is seen at least once.
pub async fn run_pull_loop(state: AppState) {
    tracing::info!("Cloud pull worker started — polling every {POLL_SECS}s");
    // LISTEN/NOTIFY wake-up: migration 0098 installs pg_notify('zera_sync')
    // triggers on every synced cloud table, so a write from any device wakes
    // this loop immediately instead of waiting out the poll interval. The
    // timed poll below stays as the reliability fallback — a missed
    // notification only ever costs latency, never data.
    let mut listener: Option<sqlx::postgres::PgListener> = None;

    loop {
        match listener.as_mut() {
            Some(l) => {
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(POLL_SECS)) => {}
                    msg = l.recv() => {
                        if let Err(e) = msg {
                            tracing::debug!("Sync listener dropped ({e}) — falling back to polling.");
                            listener = None;
                        }
                    }
                }
            }
            None => tokio::time::sleep(std::time::Duration::from_secs(POLL_SECS)).await,
        }

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

        // (Re)attach the realtime listener once a healthy cloud pool exists.
        if listener.is_none() {
            match sqlx::postgres::PgListener::connect_with(&cloud_pool).await {
                Ok(mut l) => match l.listen("zera_sync").await {
                    Ok(()) => {
                        tracing::info!("Sync: realtime LISTEN attached — pulls now wake on cloud writes.");
                        listener = Some(l);
                    }
                    Err(e) => tracing::debug!("LISTEN zera_sync failed ({e}) — polling only."),
                },
                Err(e) => tracing::debug!("PgListener connect failed ({e}) — polling only."),
            }
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
        // Pull gets the same cycle recorder as push. Before this, an apply
        // failure here went to tracing::warn! and nowhere else — inbound
        // failures were structurally invisible to the UI.
        let mut cycle = SyncCycle::new(SyncDirection::Pull);
        let mut any_pulled = false;
        // Tables that had at least one row applied this cycle — drives the
        // sync:applied event so the frontend refreshes the right screens.
        let mut pulled_tables: Vec<&str> = Vec::new();
        // Track the maximum row timestamp seen across all pulled tables.
        // We advance the cursor to this value — NOT to Utc::now() — so rows
        // that arrive at Supabase with a timestamp behind the wall clock are
        // never silently skipped.
        let mut max_pulled_ts: Option<chrono::DateTime<Utc>> = None;

        for table in SYNC_TABLES {
            // Cursor filters on cloud_synced_at — stamped by the CLOUD's
            // clock when the row arrived there (migration 0098). Device-local
            // created_at/updated_at must not be used here: a row created
            // offline and pushed later carries a timestamp older devices'
            // cursors have already passed, and would be skipped forever.
            //
            // businesses.id serves as the business filter for that table;
            // every other table uses the business_id column directly.
            let biz_col = biz_id_filter_col(table);
            let stmt = format!(
                "SELECT row_to_json(t.*) \
                 FROM {table} t \
                 WHERE t.{PULL_TS_COL} > $1::timestamptz \
                   AND t.{biz_col} = $2::uuid \
                 ORDER BY t.{PULL_TS_COL} ASC \
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
            pulled_tables.push(table);
            emit_cycle(&state, &cycle, "progress").await;

            for row_val in cloud_rows {
                let obj = match row_val.as_object() {
                    Some(o) => o,
                    None    => continue,
                };
                if obj.is_empty() { continue; }

                // ── Cursor tracking: record max timestamp of pulled rows ───────
                // Postgres row_to_json emits timestamptz as ISO 8601 with offset
                // (e.g. "2024-01-15T10:30:00.123456+00:00"), which is valid RFC3339.
                if let Some(ts_str) = obj.get(PULL_TS_COL).and_then(|v| v.as_str()) {
                    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                        let ts = parsed.with_timezone(&Utc);
                        max_pulled_ts = Some(match max_pulled_ts {
                            None                          => ts,
                            Some(existing) if ts > existing => ts,
                            Some(existing)                => existing,
                        });
                    }
                }

                // Identify the row for the log. Most synced tables use `id`;
                // items use a UUID under the same column, so this covers both.
                let row_key = obj
                    .get("id")
                    .map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()))
                    .unwrap_or_else(|| "?".to_string());

                // Strategy-aware apply — same engine as the push side:
                // append-only dedupe, LWW/state-machine guards with conflict
                // logging, item_stock seeding, stock movement folding.
                let row_started = std::time::Instant::now();
                match apply_synced_row(&local_pool, &local_pool, table, &row_val, "pull").await {
                    Ok(ApplyOutcome::Applied) => cycle.ok(
                        table, &row_key, "PULL",
                        Some(row_started.elapsed().as_millis() as i32), 1,
                    ),
                    // Duplicate delivery / self-echo / lost conflict — counted,
                    // not logged.
                    Ok(ApplyOutcome::Skipped) => cycle.noop(table),
                    Err(e) => {
                        let err_str = e.to_string();
                        tracing::warn!("Pull apply failed for {table}: {err_str}");
                        cycle.fail(
                            table, &row_key, "PULL", &err_str,
                            Some(row_started.elapsed().as_millis() as i32), 1,
                        );
                    }
                }
            }
        }

        if any_pulled {
            // Advance the cursor to the actual max row timestamp we pulled.
            // Fall back to Utc::now() only if every row had an unparseable
            // timestamp (should not happen in practice).
            let new_cursor = max_pulled_ts
                .map(|ts| ts.to_rfc3339())
                .unwrap_or_else(|| Utc::now().to_rfc3339());

            tracing::debug!("Pull: advancing cursor to {new_cursor}");

            let _ = sqlx::query!(
                "INSERT INTO app_config (key, value) VALUES ('cloud_pull_cursor', $1)
                 ON CONFLICT (key) DO UPDATE SET value = $1",
                new_cursor,
            )
            .execute(&local_pool)
            .await;

            // Tell the frontend which caches to refresh. `sync:applied` is
            // consumed by lib/syncEvents.js for global cache invalidation and
            // is deliberately left unchanged.
            emit_sync_applied(&state, &pulled_tables).await;
        }

        // Emit even when nothing was pulled but rows failed to apply — that is
        // exactly the case the old code hid completely.
        if any_pulled || !cycle.is_empty() {
            cycle.finish(&local_pool, &state).await;
        }
    }
}

/// Replay a single queued row to the cloud database using the table's
/// conflict strategy (see `sync_strategy`).
///
/// For LWW / state-machine tables the queued row_data snapshot is DISCARDED
/// and the row is re-read fresh from the local DB at push time. Intermediate
/// states don't matter for last-write-wins, and the fresh read guarantees the
/// pushed JSON carries the current sync_version / origin_device_id without
/// every queueing call site having to include them.
async fn replay_row(
    cloud_pool: &PgPool,
    local_pool: &PgPool,
    table_name: &str,
    operation:  &str,
    row_id:     &str,
    row_data:   &Value,
) -> Result<(), SyncError> {
    // Allowlist of tables we replicate — protects against injection if row_data
    // is somehow tampered with. Only add tables that are safe to replicate.
    let allowed_tables = [
        "businesses",
        "stores", "users", "departments", "categories", "suppliers",
        "tax_categories",
        "items", "item_stock", "stock_movements",
        "customers", "shifts",
        "transactions", "transaction_items", "payments",
        "expenses", "credit_sales",
        "returns", "return_items",
        "purchase_orders", "purchase_order_items",
        "cash_movements", "reorder_alerts", "notifications",
        "supplier_payments", "customer_wallet_transactions", "loyalty_transactions",
    ];
    if !allowed_tables.contains(&table_name) {
        return Err(format!("Table '{table_name}' is not in the sync allowlist").into());
    }

    match operation {
        // Hard deletes are never replicated: all deletes in this app are
        // soft (is_active = false) synced as UPDATEs, which acts as the
        // tombstone — an offline device can't resurrect the row because its
        // stale is_active = true write loses the LWW version check. Any
        // legacy 'DELETE' queue row is dropped here rather than letting it
        // hard-delete a cloud row other devices may still reference.
        "DELETE" => {
            tracing::warn!(
                "Sync: ignoring queued hard-DELETE for {table_name} row {row_id} — \
                 deletes must be soft (is_active = false) UPDATEs."
            );
            Ok(())
        }
        "INSERT" | "UPDATE" => {
            let _ = row_data; // queued payload is only a trigger — never applied
            for row in fresh_rows_for_push(local_pool, table_name, row_id).await? {
                apply_synced_row(cloud_pool, local_pool, table_name, &row, "push").await?;
            }
            Ok(())
        }
        _ => Err(format!("Unknown operation: {operation}").into()),
    }
}

/// Resolve the authoritative full row(s) for a queued push by re-reading the
/// LOCAL table at replay time.
///
/// The queued row_data is NEVER applied: historical call sites stored ad-hoc
/// partial JSON (some without even the `id` column), which violates NOT NULL
/// constraints when inserted on the cloud, and a snapshot is stale by
/// definition for mutable rows. The queue entry is purely a "this row
/// changed" trigger; this function turns its row_id back into fresh
/// row_to_json output.
///
/// Legacy row_id formats are honoured per table:
///   • transaction_items       → "{tx_id}:{item_id}"
///   • purchase_order_items    → "{po_id}:{item_id}"
///   • payments / credit_sales → "tx:{transaction_id}" (or a plain id)
///   • item_stock               → "{item_id}:{store_id}"
///   • everything else          → the primary-key id as text
///
/// An empty result (row deleted locally, unparseable legacy id) is not an
/// error — there is simply nothing left to push and the queue row completes.
async fn fresh_rows_for_push(
    local_pool: &PgPool,
    table:      &str,
    row_id:     &str,
) -> Result<Vec<Value>, SyncError> {
    // (sql, binds) — all comparisons are ::text so legacy ids never need
    // type-sniffing; these are single-row lookups on tiny result sets.
    let (stmt, binds): (String, Vec<&str>) = match table {
        "item_stock" => {
            let Some((item_id, store_id)) = row_id.split_once(':') else {
                tracing::warn!("Sync: malformed item_stock row_id '{row_id}' — skipping.");
                return Ok(vec![]);
            };
            (
                "SELECT row_to_json(t.*)::jsonb FROM item_stock t \
                 WHERE t.item_id::text = $1 AND t.store_id::text = $2".into(),
                vec![item_id, store_id],
            )
        }
        "transaction_items" if row_id.contains(':') => {
            let (tx_id, item_id) = row_id.split_once(':').unwrap();
            (
                "SELECT row_to_json(t.*)::jsonb FROM transaction_items t \
                 WHERE t.tx_id::text = $1 AND t.item_id::text = $2".into(),
                vec![tx_id, item_id],
            )
        }
        "purchase_order_items" if row_id.contains(':') => {
            let (po_id, item_id) = row_id.split_once(':').unwrap();
            (
                "SELECT row_to_json(t.*)::jsonb FROM purchase_order_items t \
                 WHERE t.po_id::text = $1 AND t.item_id::text = $2".into(),
                vec![po_id, item_id],
            )
        }
        "payments" if row_id.starts_with("tx:") => (
            "SELECT row_to_json(t.*)::jsonb FROM payments t \
             WHERE t.transaction_id::text = $1".into(),
            vec![&row_id[3..]],
        ),
        "credit_sales" if row_id.starts_with("tx:") => (
            "SELECT row_to_json(t.*)::jsonb FROM credit_sales t \
             WHERE t.transaction_id::text = $1".into(),
            vec![&row_id[3..]],
        ),
        _ => (
            format!("SELECT row_to_json(t.*)::jsonb FROM {table} t WHERE t.id::text = $1"),
            vec![row_id],
        ),
    };

    let mut query = sqlx::query_scalar::<_, Value>(&stmt);
    for b in binds {
        query = query.bind(b);
    }
    Ok(query.fetch_all(local_pool).await?)
}
