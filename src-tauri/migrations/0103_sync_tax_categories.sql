-- ============================================================================
-- MIGRATION 0103: Sync tax_categories
-- ============================================================================
-- items.tax_category_id (FK, 0015) made tax_categories a PARENT of a synced
-- table while itself being unsynced. On a fresh cloud DB every item with a tax
-- category assigned failed push with items_tax_category_id_fkey — and because
-- the parent table wasn't syncable, force_resync could never repair it.
--
-- tax_categories is business-global mutable reference data → LWW strategy.
-- It predates all the sync machinery, so it needs the full kit here:
--   • updated_at                      (LWW guard input — table never had one)
--   • business_id                     (pull scope filter; 0055 skipped this table)
--   • sync_version + origin_device_id (0096 pattern) + bump trigger
--   • cloud_synced_at + stamp/notify  (0098 pattern) + index
-- The matching sync.rs list entries and tax.rs queue_row calls ship in the
-- same commit.
-- ============================================================================

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE tax_categories
    ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS business_id      UUID REFERENCES businesses(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS sync_version     BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS origin_device_id UUID;

-- Claim existing rows for this install's business — but ONLY if that business
-- row actually exists here. On a fresh cloud DB, seed_cloud_business_scope
-- seeds app_config.business_id BEFORE the businesses row has been pushed
-- (tier 0), so claiming unconditionally violates tax_categories_business_id_fkey
-- and rolls back the whole migration transaction. When skipped here, the
-- cloud-side claim happens automatically via seed_cloud_business_scope once
-- the businesses row lands (tax_categories is in its SYNC_TABLES loop).
UPDATE tax_categories tc
   SET business_id = ac.biz
  FROM (SELECT value::uuid AS biz FROM app_config WHERE key = 'business_id') ac
 WHERE tc.business_id IS NULL
   AND EXISTS (SELECT 1 FROM businesses b WHERE b.id = ac.biz);

CREATE INDEX IF NOT EXISTS idx_tax_categories_business_id ON tax_categories(business_id);

-- ── LWW version bump (0096 pattern) ──────────────────────────────────────────
DROP TRIGGER IF EXISTS zzz_bump_sync_version ON tax_categories;
CREATE TRIGGER zzz_bump_sync_version
    BEFORE INSERT OR UPDATE ON tax_categories
    FOR EACH ROW EXECUTE FUNCTION zera_bump_sync_version();

-- ── Cloud stamp + wake-up notify (0098 pattern) ──────────────────────────────
ALTER TABLE tax_categories
    ADD COLUMN IF NOT EXISTS cloud_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS zzz_stamp_cloud_synced ON tax_categories;
CREATE TRIGGER zzz_stamp_cloud_synced
    BEFORE INSERT OR UPDATE ON tax_categories
    FOR EACH ROW EXECUTE FUNCTION zera_stamp_cloud_synced();

DROP TRIGGER IF EXISTS zzz_notify_sync ON tax_categories;
CREATE TRIGGER zzz_notify_sync
    AFTER INSERT OR UPDATE ON tax_categories
    FOR EACH STATEMENT EXECUTE FUNCTION zera_notify_sync();

CREATE INDEX IF NOT EXISTS idx_tax_categories_cloud_synced ON tax_categories(cloud_synced_at);
