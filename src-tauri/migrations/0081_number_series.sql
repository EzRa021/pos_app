-- ============================================================================
-- MIGRATION 0081: Number Series (Invoice / Receipt Numbering)
-- One row per store per document type. Defines prefix, padding, and next counter.
-- ============================================================================

CREATE TABLE IF NOT EXISTS number_series (
    id           SERIAL PRIMARY KEY,
    store_id     INT         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    doc_type     VARCHAR(30) NOT NULL,   -- 'invoice' | 'receipt' | 'purchase_order' | 'return'
    prefix       VARCHAR(20) NOT NULL DEFAULT '',
    pad_length   INT         NOT NULL DEFAULT 5,     -- total digits, e.g. 5 → 00001
    next_number  BIGINT      NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_number_series_store ON number_series(store_id);

-- Seed defaults for every existing store
INSERT INTO number_series (store_id, doc_type, prefix, pad_length, next_number)
SELECT s.id, d.doc_type, d.prefix, d.pad_length, 1
FROM   stores s
CROSS JOIN (VALUES
    ('invoice',        'INV-', 5),
    ('receipt',        'RCP-', 5),
    ('purchase_order', 'PO-',  4),
    ('return',         'RTN-', 5)
) AS d(doc_type, prefix, pad_length)
ON CONFLICT (store_id, doc_type) DO NOTHING;
