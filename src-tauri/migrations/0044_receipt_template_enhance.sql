-- ============================================================================
-- MIGRATION 0044: Receipt Template Enhancements
-- ============================================================================
-- Adds CAC number, FIRS Tax ID, receipt number prefix/counter,
-- format (thermal vs A4), and duplicate watermark support.
-- ============================================================================

ALTER TABLE receipt_settings
    ADD COLUMN IF NOT EXISTS cac_number            VARCHAR(50),
    ADD COLUMN IF NOT EXISTS firs_tax_id           VARCHAR(50),
    ADD COLUMN IF NOT EXISTS receipt_number_prefix VARCHAR(20)  DEFAULT 'RCP',
    ADD COLUMN IF NOT EXISTS receipt_format        VARCHAR(20)  DEFAULT 'thermal',  -- thermal | a4
    ADD COLUMN IF NOT EXISTS show_item_barcode     BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS show_duplicate_stamp  BOOLEAN      NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS return_policy_text    TEXT;
