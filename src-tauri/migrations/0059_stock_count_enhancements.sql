-- ============================================================================
-- MIGRATION 0059: Stock Count — Cancellation Columns, Stats View, Search Index
-- ============================================================================
-- 1. Adds cancelled_by / cancelled_at / cancel_reason to stock_count_sessions.
-- 2. Adds a unit_type column to stock_count_items for display formatting.
-- 3. Creates v_stock_count_stats — a fast per-store aggregation view used by
--    the get_stock_count_stats command (previously referenced but never created).
-- 4. Adds a GIN index on session_number + notes for free-text search support.
-- ============================================================================

-- ── Cancellation audit columns ─────────────────────────────────────────────────
ALTER TABLE stock_count_sessions
    ADD COLUMN IF NOT EXISTS cancelled_by  INT         REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- ── unit_type on items (for display formatting in the runner) ─────────────────
ALTER TABLE stock_count_items
    ADD COLUMN IF NOT EXISTS unit_type VARCHAR(50);

-- Back-fill unit_type from item_settings where missing
UPDATE stock_count_items sci
SET unit_type = ist.unit_type
FROM item_settings ist
WHERE sci.item_id = ist.item_id
  AND sci.unit_type IS NULL
  AND ist.unit_type IS NOT NULL;

-- ── Performance indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_scs_cancelled_by ON stock_count_sessions(cancelled_by);
CREATE INDEX IF NOT EXISTS idx_scs_store_status ON stock_count_sessions(store_id, status);

-- Full-text search on session_number (most common search target)
CREATE INDEX IF NOT EXISTS idx_scs_session_number_text
    ON stock_count_sessions USING gin(to_tsvector('english', COALESCE(session_number, '')));

-- ── v_stock_count_stats — fast per-store aggregation ─────────────────────────
-- Replaces three separate COUNT queries with one aggregation per store.
-- Used exclusively by the get_stock_count_stats command.
CREATE OR REPLACE VIEW v_stock_count_stats AS
SELECT
    s.store_id,
    COUNT(*)                                                     AS total_count,
    COUNT(*) FILTER (WHERE s.status = 'in_progress')            AS in_progress_count,
    COUNT(*) FILTER (WHERE s.status = 'completed')              AS completed_count,
    COUNT(*) FILTER (WHERE s.status = 'cancelled')              AS cancelled_count,
    COALESCE(
        SUM(s.total_variance_value) FILTER (WHERE s.status = 'completed'),
        0
    )                                                            AS total_variance_value,
    COALESCE(
        SUM(s.items_with_variance)  FILTER (WHERE s.status = 'completed'),
        0
    )                                                            AS total_items_with_variance
FROM stock_count_sessions s
GROUP BY s.store_id;
