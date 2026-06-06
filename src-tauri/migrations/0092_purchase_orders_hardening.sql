-- ============================================================================
-- 0092: Purchase Orders hardening — approval audit + soft delete
-- ============================================================================

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_po_store_active_created
  ON purchase_orders(store_id, created_at DESC)
  WHERE is_active = TRUE;

