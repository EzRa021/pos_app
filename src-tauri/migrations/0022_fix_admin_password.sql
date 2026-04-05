-- ============================================================================
-- MIGRATION 0022: Fix admin seed password (superseded — no-op)
-- The admin user is no longer seeded by migrations. It is created during
-- onboarding via the setup_super_admin RPC command, which is gated to run
-- only once and only while onboarding is in progress.
-- This migration is kept as a placeholder so the migration hash runner does
-- not detect a gap in the sequence.
-- ============================================================================

-- No-op: safe to run any number of times.
SELECT 1;
