-- ============================================================================
-- MIGRATION 0026: Add store_code to stores table
-- Required by Department and Category queries that JOIN stores and SELECT
-- s.store_code for display purposes.
-- ============================================================================

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS store_code VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS ux_stores_store_code
    ON stores(store_code)
    WHERE store_code IS NOT NULL;
