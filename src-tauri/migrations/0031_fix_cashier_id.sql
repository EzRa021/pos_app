-- ============================================================================
-- MIGRATION 0031: Drop NOT NULL on legacy cashier_id
-- ============================================================================
-- opened_by is now the canonical user column (added in 0030).
-- cashier_id is kept for backwards compatibility but must be nullable so the
-- Rust INSERT (which only sets opened_by) no longer violates the constraint.
-- We also add a trigger to keep cashier_id in sync automatically.
-- ============================================================================

-- 1. Drop the NOT NULL constraint so new INSERTs don't fail
ALTER TABLE shifts ALTER COLUMN cashier_id DROP NOT NULL;

-- 2. Backfill any rows where cashier_id was somehow missed
UPDATE shifts SET cashier_id = opened_by WHERE cashier_id IS NULL AND opened_by IS NOT NULL;

-- 3. Keep cashier_id in sync on every INSERT / UPDATE going forward
CREATE OR REPLACE FUNCTION sync_cashier_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.cashier_id IS NULL AND NEW.opened_by IS NOT NULL THEN
        NEW.cashier_id := NEW.opened_by;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_cashier_id ON shifts;
CREATE TRIGGER trg_sync_cashier_id
    BEFORE INSERT OR UPDATE ON shifts
    FOR EACH ROW EXECUTE FUNCTION sync_cashier_id();
