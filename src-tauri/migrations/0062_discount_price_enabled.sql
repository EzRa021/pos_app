-- ============================================================================
-- MIGRATION 0062: Add discount_price_enabled to items
-- ============================================================================
-- Adds an explicit toggle so a discount_price can be pre-set without going
-- live at the POS. Setting discount_price alone no longer activates it;
-- discount_price_enabled must also be TRUE.
-- ============================================================================

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS discount_price_enabled BOOLEAN NOT NULL DEFAULT FALSE;
