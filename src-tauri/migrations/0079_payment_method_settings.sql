-- ============================================================================
-- MIGRATION 0079: Payment Method Settings
-- Per-store configuration for which payment methods are enabled at POS,
-- their display names, sort order, and reference requirements.
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_method_settings (
    id               SERIAL PRIMARY KEY,
    store_id         INT          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    method_key       VARCHAR(30)  NOT NULL,  -- 'cash' | 'card' | 'mobile_money' | 'bank_transfer' | 'split'
    display_name     VARCHAR(100) NOT NULL,
    is_enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
    require_reference BOOLEAN     NOT NULL DEFAULT FALSE,
    reference_label  VARCHAR(100),           -- e.g. "Transaction ID", "Reference Number"
    sort_order       INT          NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, method_key)
);

CREATE INDEX IF NOT EXISTS idx_pms_store ON payment_method_settings(store_id);

-- Seed default methods for every existing store
INSERT INTO payment_method_settings (store_id, method_key, display_name, is_enabled, require_reference, reference_label, sort_order)
SELECT
    s.id,
    m.method_key,
    m.display_name,
    m.is_enabled,
    m.require_reference,
    m.reference_label,
    m.sort_order
FROM stores s
CROSS JOIN (VALUES
    ('cash',          'Cash',          TRUE,  FALSE, NULL,                  0),
    ('card',          'POS Terminal',  TRUE,  TRUE,  'Terminal Reference',  1),
    ('mobile_money',  'Mobile Money',  TRUE,  TRUE,  'Transaction ID',      2),
    ('bank_transfer', 'Bank Transfer', TRUE,  TRUE,  'Transfer Reference',  3),
    ('split',         'Split Payment', FALSE, FALSE, NULL,                  4)
) AS m(method_key, display_name, is_enabled, require_reference, reference_label, sort_order)
ON CONFLICT (store_id, method_key) DO NOTHING;
