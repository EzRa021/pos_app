-- ============================================================================
-- 0091: Transactions module hardening — cancelled_reason column + indexes
-- ============================================================================

-- FAULT #5 fix: dedicated column for void reason so original notes are preserved
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

-- UPGRADE #2: core transaction filter indexes (store_id compound first)
CREATE INDEX IF NOT EXISTS idx_transactions_store_created
    ON transactions(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_store_status
    ON transactions(store_id, status);

CREATE INDEX IF NOT EXISTS idx_transactions_cashier
    ON transactions(cashier_id, store_id);

CREATE INDEX IF NOT EXISTS idx_transactions_customer
    ON transactions(customer_id, store_id);
