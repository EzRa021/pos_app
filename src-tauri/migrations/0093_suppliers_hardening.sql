-- ============================================================================
-- 0093: Suppliers hardening and constraints
-- ============================================================================

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(50);

-- Ensure supplier codes are unique per store.
CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_code_store
  ON suppliers(store_id, supplier_code)
  WHERE supplier_code IS NOT NULL;

-- Query performance for active supplier filtering and sync cursor usage.
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active
  ON suppliers(store_id, is_active);

CREATE INDEX IF NOT EXISTS idx_suppliers_updated_at
  ON suppliers(updated_at DESC);

