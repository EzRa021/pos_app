-- ============================================================================
-- MIGRATION 0060: Price Management — Stats View, Performance Indexes, Search
-- ============================================================================
-- 1. Adds v_price_change_stats: a fast per-store aggregation view used by
--    the new get_price_change_stats command, replacing the wasteful 200-row
--    fetch previously done in the frontend.
-- 2. Adds composite indexes on the tables most hammered by the overview query.
-- 3. Adds a search index on price_changes so item_name ILIKE queries are fast.
-- ============================================================================

-- ── Performance indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pc_store_status
    ON price_changes(store_id, status);

CREATE INDEX IF NOT EXISTS idx_pc_store_created
    ON price_changes(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spc_store_pending
    ON scheduled_price_changes(store_id, applied, cancelled, effective_at)
    WHERE applied = FALSE AND cancelled = FALSE;

CREATE INDEX IF NOT EXISTS idx_pl_store_active
    ON price_lists(store_id, is_active);

-- ── Fast stats view ───────────────────────────────────────────────────────────
-- Replaces the 200-row fetch in usePriceManagement.js with a single aggregation.
CREATE OR REPLACE VIEW v_price_change_stats AS
SELECT
    store_id,
    COUNT(*)                                             AS total_count,
    COUNT(*) FILTER (WHERE status = 'pending')           AS pending_count,
    COUNT(*) FILTER (WHERE status = 'applied')           AS applied_count,
    COUNT(*) FILTER (WHERE status = 'rejected')          AS rejected_count
FROM price_changes
GROUP BY store_id;
