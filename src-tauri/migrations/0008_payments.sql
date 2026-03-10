-- ============================================================================
-- MIGRATION 0008: Payments
-- ============================================================================
-- Tracks every payment event against a transaction, including refunds.
-- Refund rows use a negative `amount` and a `refund_*` payment_method prefix.
-- ============================================================================

CREATE TABLE IF NOT EXISTS payments (
    id               SERIAL        PRIMARY KEY,
    transaction_id   INT           NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    payment_method   VARCHAR(50)   NOT NULL,
    amount           NUMERIC(15,4) NOT NULL,           -- negative for refunds
    currency         VARCHAR(10)   NOT NULL DEFAULT 'NGN',
    status           VARCHAR(30)   NOT NULL DEFAULT 'completed',
    -- completed | refunded | partial
    processed_by     INT           NOT NULL REFERENCES users(id),
    -- Human-readable reference (e.g. "REFUND-TXN-000042-1718000000")
    reference_no TEXT,
    notes            TEXT,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Idempotent additions for existing databases
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_no TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency     VARCHAR(10) NOT NULL DEFAULT 'NGN';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_tx   ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(created_at DESC);
