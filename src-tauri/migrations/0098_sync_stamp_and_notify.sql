-- ============================================================================
-- MIGRATION 0098: Cloud-clock sync stamp + realtime wake-up notify
-- ============================================================================
-- PROBLEM: the pull cursor filtered on created_at/updated_at, which are
-- DEVICE-LOCAL timestamps. A row created offline and pushed hours later lands
-- on Supabase with a timestamp other devices' cursors have already passed —
-- it is silently never pulled.
--
-- FIX: cloud_synced_at, stamped to NOW() by a trigger on EVERY insert/update
-- — so on the CLOUD database it always reflects the cloud's own clock at the
-- moment the row arrived. The pull cursor filters on this column instead.
-- (The trigger also fires locally; the local value is unused and harmless.)
-- The stamp trigger deliberately IGNORES the zera.sync_apply GUC — replicated
-- writes must be stamped too, that is the whole point.
--
-- Also: statement-level pg_notify('zera_sync') triggers so a PgListener on
-- the cloud connection can wake the 5s pull poll early. Polling remains the
-- reliability fallback; the notification is purely a latency optimization.
-- ============================================================================

CREATE OR REPLACE FUNCTION zera_stamp_cloud_synced() RETURNS trigger AS $$
BEGIN
    NEW.cloud_synced_at := NOW();
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION zera_notify_sync() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('zera_sync', TG_TABLE_NAME);
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'businesses','stores','users','departments','categories','suppliers',
        'items','item_stock','stock_movements',
        'customers','shifts',
        'transactions','transaction_items','payments',
        'expenses','credit_sales',
        'returns','return_items',
        'purchase_orders','purchase_order_items',
        'cash_movements','reorder_alerts','notifications'
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
