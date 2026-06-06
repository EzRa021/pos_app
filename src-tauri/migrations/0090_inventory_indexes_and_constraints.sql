-- ============================================================================
-- 0090: Inventory module hardening — indexes + status CHECK constraint
-- ============================================================================

-- UPGRADE #4: Filter by event_type is a seq-scan without this index
CREATE INDEX IF NOT EXISTS idx_item_history_event_type
    ON item_history(event_type);

-- Composite index for store+type filtering (most common pattern)
CREATE INDEX IF NOT EXISTS idx_item_history_store_type
    ON item_history(store_id, event_type);

-- UPGRADE #5: Filter by performed_by (user audit trail) needs an index
CREATE INDEX IF NOT EXISTS idx_item_history_performed_by
    ON item_history(performed_by);

-- UPGRADE #6: Inventory list filters by category_id / department_id
CREATE INDEX IF NOT EXISTS idx_items_category_id
    ON items(category_id);

CREATE INDEX IF NOT EXISTS idx_items_department_id
    ON items(department_id);

-- FEATURE #5: Sync cursor queries filter by updated_at DESC
CREATE INDEX IF NOT EXISTS idx_item_stock_updated_at
    ON item_stock(updated_at DESC);

-- FEATURE #7: Enforce valid status values at the DB level
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_scs_status'
      AND table_name       = 'stock_count_sessions'
  ) THEN
    ALTER TABLE stock_count_sessions
      ADD CONSTRAINT chk_scs_status
      CHECK (status IN ('in_progress', 'completed', 'cancelled'));
  END IF;
END $$;
