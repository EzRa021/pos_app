-- ============================================================================
-- MIGRATION 0076: Add business_id to sync_queue
-- ============================================================================
-- Enables the push worker to filter sync_queue rows to only the current
-- business, preventing cross-business data leaks in multi-tenant setups.
-- Backfills existing rows from app_config so pending rows are not orphaned.
-- ============================================================================

ALTER TABLE sync_queue
    ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sync_queue_business_id
    ON sync_queue(business_id, status);

-- ── Backfill existing rows ────────────────────────────────────────────────────
-- Assigns all existing un-scoped queue rows to the currently configured business.
DO $$
DECLARE
    biz_id UUID;
BEGIN
    SELECT value::UUID INTO biz_id
      FROM app_config
     WHERE key = 'business_id'
     LIMIT 1;

    IF biz_id IS NOT NULL THEN
        UPDATE sync_queue SET business_id = biz_id WHERE business_id IS NULL;
        RAISE NOTICE 'sync_queue: backfilled % rows with business_id = %',
            (SELECT COUNT(*) FROM sync_queue WHERE business_id = biz_id), biz_id;
    ELSE
        RAISE NOTICE 'sync_queue backfill skipped — no business_id in app_config yet';
    END IF;
END $$;
