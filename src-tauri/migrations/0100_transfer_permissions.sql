-- ============================================================================
-- 0100: Stock-transfer authorization permissions
-- ============================================================================
-- Previously `receive_transfer` authorized against a hardcoded 5-role allowlist
-- (TRANSFER_RECEIVE_ROLES) and `approve_transfer` against `claims.is_global`.
-- Both bypassed the permission system entirely, so the rights could not be
-- granted or revoked without recompiling.
--
-- These two permissions replace that compiled-in logic. The grants below are
-- chosen to preserve the previous behaviour EXACTLY:
--   • receive → super_admin, admin, gm, manager, inventory_manager
--   • approve → global roles only (guard_permission also short-circuits
--     is_global, so this grant is belt-and-braces / explicit documentation)
-- Cashiers and stock keepers remain excluded, as before.
-- ============================================================================

INSERT INTO permissions (permission_name, permission_slug, category) VALUES
    ('Receive Stock Transfers', 'inventory.transfer_receive', 'inventory'),
    ('Approve Stock Transfers', 'inventory.transfer_approve', 'inventory')
ON CONFLICT (permission_slug) DO NOTHING;

-- ── Receive: mirrors the old TRANSFER_RECEIVE_ROLES allowlist ────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug = 'inventory.transfer_receive'
WHERE  r.role_slug IN ('super_admin', 'admin', 'gm', 'manager', 'inventory_manager')
ON CONFLICT DO NOTHING;

-- ── Approve: mirrors the old `claims.is_global` check ────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug = 'inventory.transfer_approve'
WHERE  r.is_global = TRUE
ON CONFLICT DO NOTHING;
