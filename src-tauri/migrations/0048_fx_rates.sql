-- ============================================================================
-- MIGRATION 0048: Multi-Currency / FX Rate Support
-- ============================================================================

CREATE TABLE IF NOT EXISTS exchange_rates (
    id            SERIAL PRIMARY KEY,
    from_currency VARCHAR(10)   NOT NULL,
    to_currency   VARCHAR(10)   NOT NULL,
    rate          DECIMAL(20,8) NOT NULL,
    effective_date DATE          NOT NULL DEFAULT CURRENT_DATE,
    set_by        INT           REFERENCES users(id),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (from_currency, to_currency, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_er_pair ON exchange_rates(from_currency, to_currency, effective_date DESC);

-- Add FX fields to items (nullable — most items stay NGN)
ALTER TABLE items
    ADD COLUMN IF NOT EXISTS cost_currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
    ADD COLUMN IF NOT EXISTS cost_in_usd   DECIMAL(15,4);

CREATE INDEX IF NOT EXISTS idx_items_cost_currency
    ON items(cost_currency) WHERE cost_currency != 'NGN';

-- Seed a USD→NGN rate so the feature works immediately (approximate)
INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date)
VALUES ('USD', 'NGN', 1600.00, CURRENT_DATE)
ON CONFLICT DO NOTHING;
