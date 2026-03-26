-- ============================================================================
-- MIGRATION 0058: Returns — Stats View, Void Audit Columns, Performance Indexes
-- ============================================================================
-- 1. Adds voided_at / voided_by / void_reason columns for void audit trail.
-- 2. Adds composite performance indexes for the stats and list queries.
-- 3. Adds v_return_stats view for a single-query stats endpoint.
-- ============================================================================

-- ── Void audit columns ────────────────────────────────────────────────────────
ALTER TABLE returns
    ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voided_by   INT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- ── Performance indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_returns_status_store
    ON returns(store_id, status);

CREATE INDEX IF NOT EXISTS idx_returns_type_store
    ON returns(store_id, return_type);

CREATE INDEX IF NOT EXISTS idx_returns_created_store
    ON returns(store_id, created_at DESC);

-- ── Fast stats view ───────────────────────────────────────────────────────────
-- Replaces three separate COUNT queries with a single aggregation per store.
CREATE OR REPLACE VIEW v_return_stats AS
SELECT
    store_id,
    COUNT(*)                                        AS total_count,
    COUNT(*) FILTER (WHERE return_type = 'full')    AS full_count,
    COUNT(*) FILTER (WHERE return_type = 'partial') AS partial_count,
    COUNT(*) FILTER (WHERE status = 'completed')    AS completed_count,
    COUNT(*) FILTER (WHERE status = 'voided')       AS voided_count,
    COALESCE(
        SUM(total_amount) FILTER (WHERE status != 'voided'),
        0
    )                                               AS total_refunded
FROM returns
GROUP BY store_id;
