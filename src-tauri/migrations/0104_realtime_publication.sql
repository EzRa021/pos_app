-- ============================================================================
-- MIGRATION 0104: Register tables with Supabase Realtime
-- ============================================================================
-- The frontend (CloudSyncPanel → src/lib/supabase.js) subscribes to
-- postgres_changes for the tables below, but nothing ever ADDED them to the
-- `supabase_realtime` publication — Supabase only broadcasts changes for
-- tables in that publication. On every fresh project the WebSocket connected,
-- received nothing, and the "Live" indicator stayed dead forever.
--
-- Guarded: the publication only exists on Supabase, so this is a no-op on the
-- local PostgreSQL. duplicate_object (42710) = already registered → skip.
-- Keep this list in step with REALTIME_TABLES in CloudSyncPanel.jsx.
-- ============================================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH t IN ARRAY ARRAY[
            'items','item_stock','categories','departments','suppliers',
            'tax_categories','customers','transactions','transaction_items',
            'payments','credit_sales','returns','purchase_orders','expenses',
            'shifts','stores','reorder_alerts','notifications'
        ] LOOP
            BEGIN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
            EXCEPTION
                WHEN duplicate_object THEN NULL;  -- already in the publication
                WHEN undefined_table  THEN NULL;  -- table missing (shouldn't happen post-migrations)
            END;
        END LOOP;
    END IF;
END $$;
