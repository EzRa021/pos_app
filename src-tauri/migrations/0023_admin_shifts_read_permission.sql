-- ============================================================================
-- MIGRATION 0023: Ensure shifts.read is assigned
-- ============================================================================
-- Reason:
-- - get_shifts / get_shift require guard_permission("shifts.read")
-- - initial seed (0001_roles_permissions.sql) does not assign any permissions to
--   the 'admin' role, so admin users can open/close shifts but cannot view
--   shift history.

-- Ensure the permission exists (safe if already seeded)
INSERT INTO permissions (permission_name, permission_slug, category)
VALUES ('View Shifts', 'shifts.read', 'shifts')
ON CONFLICT (permission_slug) DO NOTHING;

-- Grant shifts.read to roles that should see shift history.
-- (Safe to run even if already assigned.)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug = 'shifts.read'
WHERE  r.role_slug IN ('admin', 'manager', 'cashier')
ON CONFLICT DO NOTHING;

