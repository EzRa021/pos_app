-- ============================================================================
-- MIGRATION 0018: Receipt Settings & Print Log
-- ============================================================================

CREATE TABLE IF NOT EXISTS receipt_settings (
    id                   SERIAL PRIMARY KEY,
    store_id             INT         NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    show_logo            BOOLEAN     NOT NULL DEFAULT FALSE,
    logo_url             TEXT,
    header_text          TEXT,
    footer_text          TEXT        DEFAULT 'Thank you for your purchase!',
    show_cashier_name    BOOLEAN     NOT NULL DEFAULT TRUE,
    show_customer_name   BOOLEAN     NOT NULL DEFAULT TRUE,
    show_item_sku        BOOLEAN     NOT NULL DEFAULT FALSE,
    show_tax_breakdown   BOOLEAN     NOT NULL DEFAULT TRUE,
    show_qr_code         BOOLEAN     NOT NULL DEFAULT FALSE,
    auto_print           BOOLEAN     NOT NULL DEFAULT FALSE,
    paper_width_mm       INT         NOT NULL DEFAULT 80,
    font_size            INT         NOT NULL DEFAULT 12,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: default settings for each existing store
INSERT INTO receipt_settings (store_id)
SELECT id FROM stores
ON CONFLICT (store_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS receipt_print_log (
    id             SERIAL PRIMARY KEY,
    receipt_id     INT          NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    printer_name   VARCHAR(200),
    printed_by     INT          NOT NULL REFERENCES users(id),
    print_reason   VARCHAR(50)  NOT NULL DEFAULT 'original',  -- original | reprint
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_print_log_receipt ON receipt_print_log(receipt_id);
