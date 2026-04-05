-- ============================================================================
-- MIGRATION 0064: Grant POS sale + shift access to all operational roles
-- ============================================================================
-- stock_keeper, gm, and inventory_manager were missing pos.sale and/or
-- shifts.read permissions, preventing them from opening shifts or completing
-- sales on the POS screen. All authenticated roles should be able to operate
-- the POS terminal.
-- ============================================================================

-- stock_keeper: add pos.sale + shifts.read + transactions.read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    'pos.sale',
    'shifts.read',
    'transactions.read',
    'customers.read',
    'customers.create'
)
WHERE  r.role_slug = 'stock_keeper'
ON CONFLICT DO NOTHING;

-- gm: add pos.sale + shifts.manage (gm should be able to reconcile shifts)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    'pos.sale',
    'shifts.manage'
)
WHERE  r.role_slug = 'gm'
ON CONFLICT DO NOTHING;

-- inventory_manager: add pos.sale + shifts.read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    'pos.sale',
    'shifts.read'
)
WHERE  r.role_slug = 'inventory_manager'
ON CONFLICT DO NOTHING;
