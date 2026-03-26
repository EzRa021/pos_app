-- ============================================================================
-- MIGRATION 0057: Logo images for stores and businesses
-- ============================================================================
-- Adds logo_data TEXT to both stores and businesses.
-- Images are stored as base64-encoded data URLs (same approach as item images).
-- Max recommended size: ~200 KB after client-side compression.
-- ============================================================================

ALTER TABLE stores     ADD COLUMN IF NOT EXISTS logo_data TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS logo_data TEXT;
