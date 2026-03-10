-- ============================================================================
-- MIGRATION 0039: Loyalty Points Engine
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_settings (
    store_id                    INT           PRIMARY KEY REFERENCES stores(id),
    points_per_naira            DECIMAL(10,4) NOT NULL DEFAULT 0.01,   -- 1 point per ₦100
    naira_per_point_redemption  DECIMAL(10,4) NOT NULL DEFAULT 0.50,   -- ₦0.50 per point
    min_redemption_points       INT           NOT NULL DEFAULT 100,
    expiry_days                 INT           NOT NULL DEFAULT 0,       -- 0 = never expire
    is_active                   BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id             SERIAL PRIMARY KEY,
    customer_id    INT          NOT NULL REFERENCES customers(id),
    store_id       INT          NOT NULL REFERENCES stores(id),
    transaction_id INT          REFERENCES transactions(id),
    type           VARCHAR(10)  NOT NULL CHECK (type IN ('earn', 'redeem', 'expire', 'adjust')),
    points         INT          NOT NULL,
    balance_after  INT          NOT NULL DEFAULT 0,
    notes          TEXT,
    created_by     INT          REFERENCES users(id),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_customer  ON loyalty_transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_store     ON loyalty_transactions(store_id,    created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tx        ON loyalty_transactions(transaction_id) WHERE transaction_id IS NOT NULL;

-- Seed default loyalty_settings for every existing store
INSERT INTO loyalty_settings (store_id)
SELECT id FROM stores
WHERE NOT EXISTS (SELECT 1 FROM loyalty_settings ls WHERE ls.store_id = stores.id)
ON CONFLICT DO NOTHING;
