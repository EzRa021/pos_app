-- ============================================================================
-- MIGRATION 0087: Stock Transfer Item Mapping
-- ============================================================================
-- Adds destination_item_id to stock_transfer_items so each source item can
-- be mapped to a DIFFERENT item in the destination store (or a brand-new one
-- that was auto-created during the execute_transfer flow).
--
-- NULL  → legacy/draft transfers where the same item UUID serves both sides.
-- UUID  → execute_transfer path: source item  ≠  destination item.
-- ============================================================================

ALTER TABLE stock_transfer_items
    ADD COLUMN IF NOT EXISTS destination_item_id UUID REFERENCES items(id);

-- Index for fast look-ups by destination item
CREATE INDEX IF NOT EXISTS idx_sti_destination_item
    ON stock_transfer_items(destination_item_id)
    WHERE destination_item_id IS NOT NULL;
