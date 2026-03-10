-- ============================================================================
-- MIGRATION 0042: Enhance Audit Logs (Centralized Audit Trail)
-- ============================================================================
-- Adds store_id, entity_type, entity_id, old_value, new_value to audit_logs.
-- All new columns are nullable so existing rows remain valid.
-- ============================================================================

ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS store_id    INT          REFERENCES stores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS entity_type VARCHAR(80),
    ADD COLUMN IF NOT EXISTS entity_id   VARCHAR(100),
    ADD COLUMN IF NOT EXISTS old_value   JSONB,
    ADD COLUMN IF NOT EXISTS new_value   JSONB;

-- Back-fill entity_type from the existing resource column for any old rows
UPDATE audit_logs SET entity_type = resource WHERE entity_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_store       ON audit_logs(store_id)    WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_logs(entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_store_date  ON audit_logs(store_id, created_at DESC) WHERE store_id IS NOT NULL;
