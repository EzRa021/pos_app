-- ============================================================================
-- MIGRATION 0030: Align shifts / cash_movements / cash_drawer_events
--                 with quantum-pos-app shift.service.js
-- ============================================================================
-- All ADD COLUMN statements use IF NOT EXISTS.
-- Backfills are UPDATE … WHERE … IS NULL so re-running is safe.
-- Old columns (cashier_id, opening_balance, etc.) are KEPT so nothing breaks.
-- ============================================================================

-- ── 1. shifts — add every column the Rust commands reference ─────────────────

-- opened_by  (quantum-pos-app name for cashier_id)
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS opened_by INT REFERENCES users(id);
UPDATE shifts SET opened_by = cashier_id WHERE opened_by IS NULL;
ALTER TABLE shifts ALTER COLUMN opened_by SET NOT NULL;

-- shift_number  SH-YYYYMMDD-NNN
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_number VARCHAR(50);
UPDATE shifts
SET shift_number = 'SH-' || TO_CHAR(opened_at, 'YYYYMMDD') || '-' || LPAD(id::TEXT, 3, '0')
WHERE shift_number IS NULL;
-- Make NOT NULL after backfill so sqlx infers String not Option<String>
ALTER TABLE shifts ALTER COLUMN shift_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_shifts_shift_number
    ON shifts(shift_number);

-- terminal_id
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS terminal_id VARCHAR(100);

-- opening_float  (quantum-pos-app name for opening_balance)
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS opening_float NUMERIC(15,4) NOT NULL DEFAULT 0;
UPDATE shifts SET opening_float = opening_balance WHERE opening_float = 0 AND opening_balance > 0;

-- actual_cash  (quantum-pos-app name for closing_balance)
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS actual_cash NUMERIC(15,4);
UPDATE shifts SET actual_cash = closing_balance WHERE actual_cash IS NULL AND closing_balance IS NOT NULL;

-- expected_cash / cash_difference  (computed and stored on close)
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS expected_cash   NUMERIC(15,4);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cash_difference NUMERIC(15,4);

-- per-payment-method totals
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_cash_sales   NUMERIC(15,4) DEFAULT 0;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_card_sales   NUMERIC(15,4) DEFAULT 0;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_transfers    NUMERIC(15,4) DEFAULT 0;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_mobile_sales NUMERIC(15,4) DEFAULT 0;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS transaction_count  BIGINT        DEFAULT 0;

-- cash movement totals
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_cash_in  NUMERIC(15,4) DEFAULT 0;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_cash_out NUMERIC(15,4) DEFAULT 0;

-- total_returns  (quantum-pos-app name for total_refunds) + return_count
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_returns NUMERIC(15,4) DEFAULT 0;
UPDATE shifts SET total_returns = COALESCE(total_refunds, 0) WHERE total_returns = 0 AND total_refunds IS NOT NULL;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS return_count BIGINT DEFAULT 0;

-- reconciliation
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS reconciled        BOOLEAN     DEFAULT FALSE;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS reconciled_by     INT         REFERENCES users(id);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS reconciled_at     TIMESTAMPTZ;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS discrepancy_notes TEXT;

-- notes split into opening_notes / closing_notes
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS opening_notes TEXT;
UPDATE shifts SET opening_notes = notes WHERE opening_notes IS NULL AND notes IS NOT NULL;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closing_notes TEXT;

-- closed_by audit + updated_at timestamp
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by  INT         REFERENCES users(id);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- indices
CREATE INDEX IF NOT EXISTS idx_shifts_opened_by ON shifts(opened_by);
CREATE INDEX IF NOT EXISTS idx_shifts_status2   ON shifts(status);   -- idempotent duplicate is fine


-- ── 2. cash_movements — add new columns ──────────────────────────────────────

-- movement_number  CM-YYYYMMDD-NNNN
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS movement_number VARCHAR(50);
UPDATE cash_movements
SET movement_number = 'CM-' || TO_CHAR(created_at, 'YYYYMMDD') || '-' || LPAD(id::TEXT, 4, '0')
WHERE movement_number IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cm_movement_number
    ON cash_movements(movement_number) WHERE movement_number IS NOT NULL;

-- reference_number  (quantum-pos-app name for reference)
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100);
UPDATE cash_movements SET reference_number = reference WHERE reference_number IS NULL AND reference IS NOT NULL;

-- performed_by  (quantum-pos-app name for created_by)
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS performed_by INT REFERENCES users(id);
UPDATE cash_movements SET performed_by = created_by WHERE performed_by IS NULL;
ALTER TABLE cash_movements ALTER COLUMN performed_by SET NOT NULL;

-- reason was NOT NULL in 0017 but the DTO has it as Option<String> — make nullable
ALTER TABLE cash_movements ALTER COLUMN reason DROP NOT NULL;


-- ── 3. cash_drawer_events — add new columns ───────────────────────────────────

-- user_id  (quantum-pos-app name for created_by)
ALTER TABLE cash_drawer_events ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id);
UPDATE cash_drawer_events SET user_id = created_by WHERE user_id IS NULL;

-- amount  (recorded for shift_opened / cash movement events)
ALTER TABLE cash_drawer_events ADD COLUMN IF NOT EXISTS amount NUMERIC(15,4);

CREATE INDEX IF NOT EXISTS idx_drawer_events_user ON cash_drawer_events(user_id);
