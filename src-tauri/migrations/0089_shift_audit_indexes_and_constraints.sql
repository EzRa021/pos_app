-- ============================================================================
-- 0089: Shift module hardening — indexes + movement_type CHECK constraint
-- ============================================================================

-- Date-range queries on shifts.opened_at (get_shifts_inner WHERE opened_at >= / <=)
CREATE INDEX IF NOT EXISTS idx_shifts_opened_at  ON shifts(opened_at DESC);

-- Sync cursor queries and updated_at range filters
CREATE INDEX IF NOT EXISTS idx_shifts_updated_at ON shifts(updated_at DESC);

-- cash_movements.performed_by JOIN / WHERE usage
CREATE INDEX IF NOT EXISTS idx_cash_mv_performed_by ON cash_movements(performed_by);

-- Enforce valid movement_type values at the DB level so no bad data can slip
-- through even via direct DB access or future code paths.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_movement_type'
      AND table_name       = 'cash_movements'
  ) THEN
    ALTER TABLE cash_movements
      ADD CONSTRAINT chk_movement_type
      CHECK (movement_type IN ('deposit', 'withdrawal', 'payout', 'adjustment'));
  END IF;
END $$;
