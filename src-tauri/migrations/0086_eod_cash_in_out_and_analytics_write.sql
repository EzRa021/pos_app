-- ============================================================================
-- MIGRATION 0086: EOD cash_in/cash_out columns + analytics.write permission
-- ============================================================================

-- 1. Add cash_in / cash_out columns to eod_reports
--    cash_in  = total cash deposits added to the drawer during the day
--    cash_out = total cash withdrawn / paid out from the drawer during the day
ALTER TABLE eod_reports
    ADD COLUMN IF NOT EXISTS cash_in  NUMERIC(15,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cash_out NUMERIC(15,4) NOT NULL DEFAULT 0;

-- 2. Add analytics.write permission (used by generate_eod_report / lock_eod_report)
INSERT INTO permissions (permission_name, permission_slug, category)
VALUES ('Generate / Lock EOD Reports', 'analytics.write', 'analytics')
ON CONFLICT (permission_slug) DO NOTHING;

-- 3. Assign analytics.write to manager, gm, admin, super_admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r, permissions p
WHERE  p.permission_slug = 'analytics.write'
  AND  r.role_slug IN ('manager', 'gm', 'admin', 'super_admin')
ON CONFLICT DO NOTHING;
