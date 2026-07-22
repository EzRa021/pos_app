# Cloud Sync Reference

## Files

| File | Role |
|------|------|
| `src-tauri/src/database/sync.rs` | Push/pull workers, `queue_row`, backfill, FK recovery |
| `src-tauri/src/commands/cloud_sync.rs` | Config, status, enable/disable, retry |
| `src-tauri/src/database/pool.rs` | `create_cloud_pool_with_migrations` |
| `src-tauri/src/lib.rs` | Spawns workers at startup |
| `src/lib/supabase.js` | Realtime client (invalidation only) |
| `src/features/settings/CloudSyncPanel.jsx` | Admin UI |
| `src/commands/cloud_sync.js` | Frontend RPC wrappers |

## app_config keys

| Key | Default | Purpose |
|-----|---------|---------|
| `cloud_sync_enabled` | false | Master toggle |
| `cloud_pull_cursor` | epoch | Pull watermark (RFC3339) |
| `business_id` | — | Tenant scope |

## Lists that must match

When adding a synced table, update **all** of these in `sync.rs`:

1. `SYNC_TABLES` (pull order — FK parents first)
2. `allowed_tables` in `replay_row()`
3. `table_backfill_meta()` + `table_tier()` + push ORDER BY CASE
4. `sync_strategy()` — pick the conflict strategy (defaults to AppendOnly)
5. Migration 0098's trigger table array (cloud_synced_at stamp + pg_notify)
6. If LWW/state-machine: migration 0096 pattern (sync_version + origin_device_id + zzz_bump_sync_version trigger) and `status_rank_case()` for state tables

Also: `queue_row` in mutating commands, frontend `REALTIME_TABLES` if UI-visible.

## Push tier order

| Tier | Tables |
|------|--------|
| 0 | businesses |
| 1 | stores, users |
| 2 | departments, categories, suppliers, tax_categories |
| 3 | items, customers |
| 4 | item_stock (seed-only) |
| 5 | shifts, stock_movements (after item_stock seeds) |
| 6 | transactions, purchase_orders, credit_sales, expenses |
| 7 | transaction_items, payments, returns, purchase_order_items, cash_movements |
| 8 | return_items |
| 9 | supplier_payments, customer_wallet_transactions, loyalty_transactions, reorder_alerts, notifications |

## Currently synced (27 tables)

businesses, stores, users, departments, categories, suppliers, tax_categories, items, item_stock (seed-only), stock_movements, customers, shifts, transactions, transaction_items, payments, expenses, credit_sales, returns, return_items, purchase_orders, purchase_order_items, cash_movements, supplier_payments, customer_wallet_transactions, loyalty_transactions, reorder_alerts, notifications

## Conflict strategy (IMPLEMENTED — migrations 0096–0098, `sync_strategy()` in sync.rs)

| Strategy | Tables | Rule |
|----------|--------|------|
| AppendOnly | transaction_items, payments, return_items, purchase_order_items, cash_movements, notifications | `ON CONFLICT DO NOTHING` — UUID/PK dedupe + retry/tier delivery |
| Lww | businesses, stores, users, departments, categories, suppliers, tax_categories, items, customers | Guarded upsert on (sync_version, updated_at, origin_device_id); losers logged to `sync_conflicts` |
| StateMachine | shifts, transactions, credit_sales, purchase_orders, returns, reorder_alerts, expenses | `status_rank_case()` — higher-ranked status always wins (closed > open, voided > completed, paid > partial…); same rank falls back to LWW |
| StockSeed | item_stock | Insert-when-absent ONLY, never overwritten; `cloud_seeded_at` records what the seed already includes |
| StockMovement | stock_movements | Append + fold delta/'set' into item_stock on first sight; cloud stamps `applied_at` |

Key mechanics:
- `sync_version` bumped by `zzz_bump_sync_version` trigger on LOCAL writes only — the applier suppresses it with transaction GUC `zera.sync_apply = 'on'`.
- Push for Lww/StateMachine tables **re-reads the row fresh** at replay time (queued snapshot discarded) so pushed JSON always carries current version columns.
- Pull cursor uses `cloud_synced_at` (cloud-clock trigger stamp, migration 0098) — never device-local created_at/updated_at, which would skip offline-created rows pushed late.
- Pull loop wakes early on `pg_notify('zera_sync')` via PgListener; push loop wakes instantly via the `PUSH_WAKE` Notify signalled by `queue_row`; the 5s poll is the fallback for both. **Session pooler (port 5432) required** — direct connection is IPv6-only, transaction pooler (6543) breaks LISTEN/NOTIFY.
- On first healthy cloud connection each session, `seed_cloud_business_scope` seeds cloud `app_config.business_id` (so the 0075 trigger stamps rows inserted directly in Supabase) and claims existing NULL-business_id cloud rows — without this, direct cloud inserts are invisible to every device's pull filter.
- Workers emit Tauri events `sync:status` (idle/pushing/pulling/offline/error + counts) and `sync:applied` (tables pulled); `src/lib/syncEvents.js` bridges applied-events to React Query invalidation app-wide, and CloudSyncPanel renders live activity. Client-mode devices use the `get_sync_status` / `get_sync_conflicts` RPCs instead.
- Hard DELETEs are never replicated (replay drops them with a warning) — `is_active = false` UPDATEs are the tombstone; LWW versioning stops stale devices resurrecting them.
- `stock_movements` is deliberately EXCLUDED from backfill/force_resync (snapshots already include movement effects; re-pushing history would double-count). Backfill seeds item_stock; live queue delivers movements.

## Stock movement pattern (any command that mutates item_stock)

```rust
// inside the same DB transaction as the item_stock UPDATE:
let movement = crate::database::sync::log_stock_movement(
    &mut *tx, item_id, store_id,
    Some(delta), None,        // OR None, Some(absolute_qty) for counts/imports
    "sale",                   // reason
).await?;
// after commit:
crate::database::sync::queue_row(
    &pool, "stock_movements", "INSERT", &movement.0, movement.1, Some(store_id),
).await;
```

Never queue absolute item_stock quantities — deltas only ('set' only for physical counts, guarded by last_count_date).

## queue_row pattern (non-stock tables)

```rust
crate::database::sync::queue_row(
    &pool, "items", "INSERT",
    &row.id.to_string(),
    serde_json::to_value(&row)?,
    Some(store_id),
).await;
```

Soft deletes → `"UPDATE"` with `is_active: false`, not `"DELETE"` (hard deletes are dropped by replay).
For Lww/StateMachine tables the row_data snapshot is only a trigger — the push worker re-reads the fresh row by id.

## Known gaps

| Issue | Detail |
|-------|--------|
| Realtime scope (frontend) | Only in CloudSyncPanel, not app-wide |
| Not synced yet | stock_transfers (header), price_lists, loyalty_settings, number_series — stock EFFECT of transfers syncs via stock_movements; loyalty_settings auto-inserts defaults per store; none of these are FK parents of synced tables |
| Cloud reset recovery | After wiping the cloud DB, run backfill; stock quantities re-seed from snapshots but movement history queued-but-unsynced at reset time is not re-applied |

Resolved 2026-07-19 (migration 0102): supplier_payments, customer_wallet_transactions and loyalty_transactions are now fully synced (AppendOnly, tier 9). Onboarding restore's `upsert_json_rows` now uses per-table ON CONFLICT targets — previously the hardcoded `(id)` silently skipped every item_stock row (composite PK), so cloud restores came back with zero stock.

## RPC commands

save_supabase_config, clear_supabase_config, get_supabase_config, get_sync_status, set_cloud_sync_enabled, trigger_backfill_sync, retry_failed_sync, get_failed_sync_rows
