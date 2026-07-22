-- ============================================================================
-- MIGRATION 0102: Sync the money/points ledgers
-- ============================================================================
-- loyalty_transactions, customer_wallet_transactions and supplier_payments
-- were being queued for push (queue_row) but were NOT in the sync allowlist,
-- so every queued row hard-failed with "not in the sync allowlist" and showed
-- up as a permanently-failed row in the sync panel. This migration gives the
-- three ledger tables the same cloud_synced_at stamp + pg_notify plumbing as
-- every other synced table (mirrors 0098 exactly); the matching sync.rs lists
-- are updated in the same commit.
--
-- All three are append-only ledgers with SERIAL id PKs and business_id
-- columns (0055), so the default AppendOnly strategy and id-keyed fresh-read
-- both apply unchanged.
--
-- loyalty_settings is deliberately NOT live-synced (PK is store_id, mutable
-- config) — a fresh device gets defaults via get_loyalty_settings' auto-insert.
-- ============================================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'loyalty_transactions',
        'customer_wallet_transactions',
        'supplier_payments'
    ] LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD COLUMN IF NOT EXISTS cloud_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()', t);
        EXECUTE format('DROP TRIGGER IF EXISTS zzz_stamp_cloud_synced ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER zzz_stamp_cloud_synced
             BEFORE INSERT OR UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION zera_stamp_cloud_synced()', t);
        EXECUTE format('DROP TRIGGER IF EXISTS zzz_notify_sync ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER zzz_notify_sync
             AFTER INSERT OR UPDATE ON %I
             FOR EACH STATEMENT EXECUTE FUNCTION zera_notify_sync()', t);
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_%s_cloud_synced ON %I(cloud_synced_at)', t, t);
    END LOOP;
END $$;
