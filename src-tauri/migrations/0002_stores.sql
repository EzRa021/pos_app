-- ============================================================================
-- MIGRATION 0002: Stores
-- ============================================================================

CREATE TABLE IF NOT EXISTS stores (
    id           SERIAL PRIMARY KEY,
    store_name   VARCHAR(200) NOT NULL,
    address      TEXT,
    city         VARCHAR(100),
    state        VARCHAR(100),
    country      VARCHAR(100) NOT NULL DEFAULT 'Nigeria',
    phone        VARCHAR(50),
    email        VARCHAR(255),
    currency     VARCHAR(10)  NOT NULL DEFAULT 'NGN',
    timezone     VARCHAR(60)  NOT NULL DEFAULT 'Africa/Lagos',
    tax_rate     NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    receipt_footer TEXT,
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Seed: default store ───────────────────────────────────────────────────────
INSERT INTO stores (store_name, country, currency, timezone) VALUES
    ('Main Store', 'Nigeria', 'NGN', 'Africa/Lagos')
ON CONFLICT DO NOTHING;
