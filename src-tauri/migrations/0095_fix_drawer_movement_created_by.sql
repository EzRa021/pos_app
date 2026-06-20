-- ============================================================================
-- 0095: Fix NOT NULL legacy created_by columns on cash_drawer_events /
--       cash_movements that are never populated by current Rust code.
-- ============================================================================
-- 0017 created both tables with `created_by INT NOT NULL`.
-- 0030 introduced the quantum-pos-app-aligned replacement columns
--   cash_drawer_events.user_id  and  cash_movements.performed_by
-- and backfilled them from created_by, but never relaxed the old NOT NULL
-- constraint on created_by itself.
--
-- Every INSERT in src-tauri/src/commands/shifts.rs only sets user_id /
-- performed_by — never created_by — so every insert into these tables has
-- been violating the NOT NULL constraint on created_by:
--   - open_shift / suspend_shift / resume_shift / cancel_shift / reconcile_shift
--     swallow the error via `.ok()`, so the drawer-event row is silently lost.
--   - close_shift_inner and add_cash_movement_inner run the INSERT inside a
--     transaction with `?` (no `.ok()`), so the constraint violation aborts
--     the whole transaction — close_shift never commits its UPDATE either.
--
-- user_id / performed_by are now the columns the app actually reads and
-- writes, so the fix is to drop NOT NULL from the legacy created_by columns
-- rather than touch six call sites.
-- ============================================================================

ALTER TABLE cash_drawer_events ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE cash_movements     ALTER COLUMN created_by DROP NOT NULL;
