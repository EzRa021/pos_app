-- ============================================================================
-- MIGRATION 0015: Tax Categories
-- ============================================================================

CREATE TABLE IF NOT EXISTS tax_categories (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL UNIQUE,
    code         VARCHAR(20)  NOT NULL UNIQUE,
    rate         NUMERIC(5,4) NOT NULL DEFAULT 0,   -- e.g. 0.0750 = 7.5%
    is_inclusive BOOLEAN      NOT NULL DEFAULT TRUE, -- inclusive = tax in price
    description  TEXT,
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed: Nigeria VAT defaults
INSERT INTO tax_categories (name, code, rate, is_inclusive, description) VALUES
    ('Standard VAT',  'VAT',    0.0750, TRUE,  'Nigeria Value Added Tax 7.5%'),
    ('Tax Exempt',    'EXEMPT', 0.0000, TRUE,  'Exempt from VAT'),
    ('Zero Rated',    'ZERO',   0.0000, TRUE,  'Zero-rated VAT')
ON CONFLICT (code) DO NOTHING;

-- Add tax_category_id to items table
ALTER TABLE items
    ADD COLUMN IF NOT EXISTS tax_category_id INT REFERENCES tax_categories(id) ON DELETE SET NULL;
