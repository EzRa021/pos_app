-- ============================================================================
-- MIGRATION 0061: Fix Cashier & Stock Keeper Missing Permissions
-- ============================================================================
-- Cashier role was missing stores.read (required for notifications) and
-- categories.read (required for POS item category display).
-- Stock keeper role was already granted categories.read in 0001 so this is
-- idempotent for that role.
-- ============================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    'stores.read',      -- required: get_notifications, get_unread_count
    'categories.read',  -- required: get_categories (POS item grid)
    'departments.read'  -- required: item detail panels showing dept name
)
WHERE  r.role_slug = 'cashier'
ON CONFLICT DO NOTHING;
