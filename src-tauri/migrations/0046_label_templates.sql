-- ============================================================================
-- MIGRATION 0046: Label Templates (Barcode/Price Tag Printing)
-- ============================================================================

CREATE TABLE IF NOT EXISTS label_templates (
    id          SERIAL PRIMARY KEY,
    store_id    INT          NOT NULL REFERENCES stores(id),
    name        VARCHAR(100) NOT NULL,
    format      VARCHAR(20)  NOT NULL DEFAULT '58mm',  -- 58mm | 80mm | a4
    show_price  BOOLEAN      NOT NULL DEFAULT TRUE,
    show_sku    BOOLEAN      NOT NULL DEFAULT TRUE,
    show_name   BOOLEAN      NOT NULL DEFAULT TRUE,
    show_store  BOOLEAN      NOT NULL DEFAULT FALSE,
    show_expiry BOOLEAN      NOT NULL DEFAULT FALSE,
    is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, name)
);

CREATE INDEX IF NOT EXISTS idx_lt_store ON label_templates(store_id);
