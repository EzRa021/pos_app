-- Run this in any Postgres client (psql, DBeaver, TablePlus, pgAdmin, etc.)
-- Then run: cargo sqlx migrate run   (from the src-tauri directory)

-- Remove the stale checksum rows so SQLx will re-apply them cleanly.
-- Migration 0051 and 0053 are both idempotent (IF NOT EXISTS / no-op on re-run).
DELETE FROM _sqlx_migrations WHERE version IN (51, 53);
