-- ============================================================================
-- MIGRATION 0054: Business entity, app-level config, and sync log
-- ============================================================================
-- Creates the three new tables required for the multi-tenant architecture
-- and first-launch onboarding flow.
--
-- businesses   – one row per business (the tenant root)
-- app_config   – key/value store for local machine config (onboarding state)
-- sync_log     – audit trail for future cloud sync events
-- ============================================================================

CREATE TABLE IF NOT EXISTS businesses (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    type        TEXT        NOT NULL DEFAULT 'retail',
    email       TEXT,
    phone       TEXT,
    address     TEXT,
    currency    TEXT        NOT NULL DEFAULT 'NGN',
    timezone    TEXT        NOT NULL DEFAULT 'Africa/Lagos',
    logo_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID        REFERENCES businesses(id) ON DELETE SET NULL,
    event_type  TEXT        NOT NULL,
    message     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
