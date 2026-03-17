-- ============================================================================
-- MIGRATION 0051: Propagate measurement_type / unit_type to movement tables
-- ============================================================================
-- This migration ensures that once an item moves (sale, return, PO receipt,
-- stock transfer, stock count), we no longer lose its unit-of-measure context.
--
-- Adds lightweight, idempotent columns:
--   • transaction_items.measurement_type, transaction_items.unit_type
--   • return_items.measurement_type,      return_items.unit_type
--   • purchase_order_items.unit_type
--   • stock_transfer_items.unit_type
--   • stock_count_items.unit_type
--
-- All columns are nullable to remain backward compatible with existing data.
-- New writes from the Rust commands will start populating them.
-- ============================================================================

-- ── Sales ─────────────────────────────────────────────────────────────────────

ALTER TABLE transaction_items
    ADD COLUMN IF NOT EXISTS measurement_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS unit_type        VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_tx_items_measurement_type
    ON transaction_items(measurement_type);

-- ── Returns ───────────────────────────────────────────────────────────────────

ALTER TABLE return_items
    ADD COLUMN IF NOT EXISTS measurement_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS unit_type        VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_return_items_unit_type
    ON return_items(unit_type);

-- ── Purchase Orders ───────────────────────────────────────────────────────────

ALTER TABLE purchase_order_items
    ADD COLUMN IF NOT EXISTS unit_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_po_items_unit_type
    ON purchase_order_items(unit_type);

-- ── Stock Transfers ───────────────────────────────────────────────────────────

ALTER TABLE stock_transfer_items
    ADD COLUMN IF NOT EXISTS unit_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_sti_unit_type
    ON stock_transfer_items(unit_type);

-- ── Stock Counts ──────────────────────────────────────────────────────────────

ALTER TABLE stock_count_items
    ADD COLUMN IF NOT EXISTS unit_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_sci_unit_type
    ON stock_count_items(unit_type);

