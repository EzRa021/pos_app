-- Add per-store currency and locale to store_settings.
-- currency: ISO 4217 code (e.g. 'NGN', 'USD', 'GBP')
-- locale:   BCP 47 locale tag for Intl.NumberFormat (e.g. 'en-NG', 'en-US')
ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3)  NOT NULL DEFAULT 'NGN',
    ADD COLUMN IF NOT EXISTS locale   VARCHAR(10) NOT NULL DEFAULT 'en-NG';
