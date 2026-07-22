-- ============================================================================
-- MIGRATION 0099: Shift ↔ transaction linkage + honest cash-drawer accounting
-- ============================================================================
-- 1. transactions.shift_id — sales were previously linked to shifts only by
--    the (cashier, store, time-window) heuristic, which breaks for voids done
--    on a later shift and makes per-shift stats fragile. Now stamped at sale
--    time; legacy rows are backfilled from the time window once.
--
-- 2. shifts.total_cash_refunds — CASH that physically left the drawer for
--    refunds/returns. Previously `total_returns` (which includes card,
--    transfer, store-credit and wallet refunds) was subtracted from expected
--    cash, so any non-cash refund corrupted the drawer expectation, and voids
--    were double-counted (subtracted from total_cash_sales AND added to
--    total_returns). The unified drawer formula everywhere is now:
--
--        expected = opening_float + total_cash_sales
--                 + total_cash_in − total_cash_out − total_cash_refunds
--
--    total_returns remains as a pure REPORTING figure (value of refunds).
-- ============================================================================

ALTER TABLE shifts
    ADD COLUMN IF NOT EXISTS total_cash_refunds NUMERIC(15,4) NOT NULL DEFAULT 0;

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS shift_id INT REFERENCES shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_shift ON transactions(shift_id);

-- Backfill shift_id for existing rows via the historical time-window match.
-- ux_shifts_one_open_per_user_store guarantees at most one live shift per
-- (cashier, store), so the window match is unambiguous. Idempotent: only
-- touches rows still NULL.
UPDATE transactions t
SET    shift_id = s.id
FROM   shifts s
WHERE  t.shift_id IS NULL
  AND  s.opened_by = t.cashier_id
  AND  s.store_id  = t.store_id
  AND  t.created_at >= s.opened_at
  AND  (s.closed_at IS NULL OR t.created_at <= s.closed_at);
