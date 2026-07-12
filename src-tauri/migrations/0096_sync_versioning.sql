-- ============================================================================
-- MIGRATION 0096: Sync conflict resolution — versioning, device identity,
--                 conflict audit log
-- ============================================================================
-- Adds explicit last-write-wins (LWW) machinery for mutable reference tables
-- and state-machine tables:
--   • sync_version      — bumped on every LOCAL write by trigger; the sync
--                         applier suppresses the bump via the transaction-
--                         scoped GUC  zera.sync_apply = 'on'  so replicated
--                         writes carry their origin version verbatim.
--   • origin_device_id  — which install last wrote the row (tie-breaker when
--                         version AND updated_at are identical).
--   • sync_conflicts    — audit log of every write the applier rejected.
--   • device_id         — stable per-install UUID in app_config.
-- Runs on BOTH local PostgreSQL and Supabase (same migration stream).
-- ============================================================================

-- ── Per-install device identity ──────────────────────────────────────────────
INSERT INTO app_config (key, value)
VALUES ('device_id', gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;

-- ── Version + origin columns ─────────────────────────────────────────────────
-- LWW reference tables
ALTER TABLE businesses  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                        ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE stores      ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                        ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                        ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                        ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE categories  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                        ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE suppliers   ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                        ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE items       ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                        ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE customers   ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                        ADD COLUMN IF NOT EXISTS origin_device_id UUID;

-- State-machine tables (status transition rule first, LWW as fallback for
-- same-rank column edits)
ALTER TABLE shifts          ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                            ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE transactions    ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                            ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE credit_sales    ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                            ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                            ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE returns         ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                            ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE reorder_alerts  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                            ADD COLUMN IF NOT EXISTS origin_device_id UUID;
ALTER TABLE expenses        ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1,
                            ADD COLUMN IF NOT EXISTS origin_device_id UUID;

-- ── Version-bump trigger ─────────────────────────────────────────────────────
-- Every direct local write bumps sync_version and stamps this device's id.
-- The sync applier (push replay on the cloud, pull apply locally) sets
-- zera.sync_apply = 'on' for its transaction so replicated rows keep the
-- version/device of the device that actually made the edit.
CREATE OR REPLACE FUNCTION zera_bump_sync_version() RETURNS trigger AS $$
BEGIN
    IF current_setting('zera.sync_apply', true) IS DISTINCT FROM 'on' THEN
        IF TG_OP = 'UPDATE' THEN
            NEW.sync_version := COALESCE(OLD.sync_version, 0) + 1;
        ELSE
            NEW.sync_version := COALESCE(NEW.sync_version, 1);
        END IF;
        NEW.origin_device_id := (SELECT value::uuid FROM app_config WHERE key = 'device_id');
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'businesses','stores','users','departments','categories','suppliers',
        'items','customers',
        'shifts','transactions','credit_sales','purchase_orders','returns',
        'reorder_alerts','expenses'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS zzz_bump_sync_version ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER zzz_bump_sync_version
             BEFORE INSERT OR UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION zera_bump_sync_version()', t);
    END LOOP;
END $$;

-- ── Conflict audit log ───────────────────────────────────────────────────────
-- One row per write the sync applier REJECTED because the target row had
-- moved ahead (higher version / newer timestamp / winning status). Local-only
-- audit — intentionally not in the sync allowlist.
CREATE TABLE IF NOT EXISTS sync_conflicts (
    id                  BIGSERIAL    PRIMARY KEY,
    table_name          TEXT         NOT NULL,
    row_id              TEXT         NOT NULL,
    direction           TEXT         NOT NULL CHECK (direction IN ('push','pull')),
    incoming_version    BIGINT,
    current_version     BIGINT,
    incoming_updated_at TIMESTAMPTZ,
    current_updated_at  TIMESTAMPTZ,
    incoming_device     UUID,
    current_device      UUID,
    resolution          TEXT         NOT NULL DEFAULT 'kept_current',
    incoming_row        JSONB,
    resolved_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_table ON sync_conflicts(table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_time  ON sync_conflicts(resolved_at);
