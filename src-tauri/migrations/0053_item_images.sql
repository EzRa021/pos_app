-- ============================================================================
-- MIGRATION 0053: Item images
-- ============================================================================
-- Adds image_data TEXT column to items table.
-- Images are stored as base64-encoded data URLs.
-- Max recommended size: ~200KB after client-side compression.
-- ============================================================================

ALTER TABLE items ADD COLUMN IF NOT EXISTS image_data TEXT;
