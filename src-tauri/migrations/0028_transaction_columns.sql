-- ============================================================================
-- MIGRATION 0028: Transaction columns alignment with quantum-pos-app
-- ============================================================================
-- Adds every column that the updated Rust transaction commands reference
-- but that does not yet exist in the live database.
-- All statements are idempotent (IF NOT EXISTS / DO guards). Safe to re-run.
-- ============================================================================

-- ── 1. transactions — new columns ────────────────────────────────────────────

-- payment_status: paid | pending (credit) | refunded | partial_refund
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'paid';

-- Back-fill payment_status for any rows that already exist
UPDATE transactions
SET payment_status = CASE
    WHEN status IN ('voided', 'cancelled') THEN 'refunded'
    WHEN status = 'refunded'              THEN 'refunded'
    ELSE 'paid'
END
WHERE payment_status = 'paid';

-- offline_sale: flags sales created while the POS was offline
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS offline_sale BOOLEAN NOT NULL DEFAULT FALSE;

-- client_uuid: client-generated UUID used to prevent duplicate offline submissions
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS client_uuid TEXT;

-- Add UNIQUE constraint on client_uuid if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'transactions_client_uuid_key'
          AND conrelid = 'transactions'::regclass
    ) THEN
        ALTER TABLE transactions ADD CONSTRAINT transactions_client_uuid_key UNIQUE (client_uuid);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tx_client_uuid
    ON transactions(client_uuid) WHERE client_uuid IS NOT NULL;

-- cancelled_at / cancelled_by: void audit trail
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS cancelled_by INT REFERENCES users(id) ON DELETE SET NULL;

-- ── 2. payments — ensure reference_no column exists ─────────────────────────
-- The Rust refund commands insert into `reference_no` (matching the original
-- column name from 0008). This is a no-op on any DB where 0008 has run.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_no TEXT;

-- ── 3. customers — credit_enabled flag ───────────────────────────────────────
-- Controls whether a customer is allowed to make credit purchases.
-- Defaults TRUE so all existing customers retain their previous behaviour.
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS credit_enabled BOOLEAN NOT NULL DEFAULT TRUE;
