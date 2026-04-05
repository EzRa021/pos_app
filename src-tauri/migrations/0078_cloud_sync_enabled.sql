-- cloud_sync_enabled (app_config)
-- ─────────────────────────────────────────────────────────────────────────────
-- Controls whether the background sync worker pushes queued writes to Supabase
-- and pulls remote changes back into the local database.
--
-- Default: 'false'  (opt-in — the user must explicitly enable it in Settings)
--
-- Scope: background replication only.
--   • Push worker  (sync_queue → Supabase)  — skipped when disabled.
--   • Pull worker  (Supabase → local)       — skipped when disabled.
--   • Onboarding reads (check_business_exists, restore_business_from_cloud)
--     bypass this flag entirely — they always use the cloud pool directly.
--
-- If the key is absent the application treats it as 'false'. This row is
-- seeded here so the intent is explicit and visible in the config table.
INSERT INTO app_config (key, value)
VALUES ('cloud_sync_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
