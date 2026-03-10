-- ============================================================================
-- MIGRATION 0032: Extend receipt_settings with branding & layout columns
-- ============================================================================

ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS business_name     VARCHAR(200);
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS business_address  TEXT;
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS business_phone    VARCHAR(50);
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS business_email    VARCHAR(200);
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS tagline           VARCHAR(300);
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS logo_base64       TEXT;
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS receipt_copies    INT         NOT NULL DEFAULT 1;
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS currency_symbol   VARCHAR(10)          DEFAULT '₦';
