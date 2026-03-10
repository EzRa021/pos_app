-- ============================================================================
-- MIGRATION 0045: Customer Wallet / Advance Payment
-- ============================================================================

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS wallet_balance DECIMAL(15,4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
    id             SERIAL PRIMARY KEY,
    customer_id    INT           NOT NULL REFERENCES customers(id),
    store_id       INT           NOT NULL REFERENCES stores(id),
    type           VARCHAR(20)   NOT NULL CHECK (type IN ('deposit','debit','refund','adjustment')),
    amount         DECIMAL(15,4) NOT NULL,
    balance_after  DECIMAL(15,4) NOT NULL,
    reference      VARCHAR(100),
    transaction_id INT           REFERENCES transactions(id) ON DELETE SET NULL,
    recorded_by    INT           NOT NULL REFERENCES users(id),
    notes          TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cwt_customer ON customer_wallet_transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cwt_store    ON customer_wallet_transactions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cwt_tx       ON customer_wallet_transactions(transaction_id)
    WHERE transaction_id IS NOT NULL;
