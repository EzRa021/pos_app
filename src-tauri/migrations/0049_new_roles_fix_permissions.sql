-- ============================================================================
-- MIGRATION 0049: New Roles + Fix Admin Permissions
-- ============================================================================
-- 1. Add General Manager (gm) role  — global, operational oversight
-- 2. Add Inventory Manager (inventory_manager) role — store-scoped, full
--    inventory + purchasing + analytics
-- 3. Grant missing permissions to admin role (users.read/create/update,
--    analytics.read, audit.read, expenses.approve, etc.)
-- All statements are idempotent. Safe to re-run.
-- ============================================================================

-- ── 1. New roles ──────────────────────────────────────────────────────────────

INSERT INTO roles (role_name, role_slug, description, is_global, hierarchy_level)
VALUES
  ('General Manager',    'gm',                'Business-level global manager. Can see all stores, manage operations, but cannot change system/infra settings.', TRUE,  2),
  ('Inventory Manager',  'inventory_manager', 'Full inventory, purchasing, supplier, and stock-count management for their assigned store.',                      FALSE, 4)
ON CONFLICT (role_slug) DO NOTHING;

-- Shift existing non-global roles down one level to make room
UPDATE roles SET hierarchy_level = 3  WHERE role_slug = 'admin'        AND hierarchy_level = 2;
UPDATE roles SET hierarchy_level = 4  WHERE role_slug = 'manager'      AND hierarchy_level = 3;
UPDATE roles SET hierarchy_level = 5  WHERE role_slug = 'inventory_manager' AND hierarchy_level = 4;
UPDATE roles SET hierarchy_level = 6  WHERE role_slug = 'cashier'      AND hierarchy_level = 4;
UPDATE roles SET hierarchy_level = 7  WHERE role_slug = 'stock_keeper' AND hierarchy_level = 5;

-- ── 2. Ensure all needed permission slugs exist ───────────────────────────────

INSERT INTO permissions (permission_name, permission_slug, category) VALUES
  ('Manage Shifts',         'shifts.manage',          'shifts'),
  ('Manage Credit Sales',   'credit_sales.manage',    'credit'),
  ('View Reports',          'reports.read',            'reporting'),
  ('Manage Users',          'users.manage',            'users')
ON CONFLICT (permission_slug) DO NOTHING;

-- ── 3. Fix admin role — grant all store-operational permissions ───────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    -- Users
    'users.read', 'users.create', 'users.update',
    -- Stores (read-only for admin)
    'stores.read',
    -- Departments & Categories
    'departments.read', 'departments.manage',
    'categories.read',  'categories.manage',
    -- Items & Inventory (full control)
    'items.read', 'items.create', 'items.update', 'items.delete',
    'inventory.read', 'inventory.adjust', 'inventory.stock_count',
    -- POS
    'pos.sale', 'transactions.read', 'transactions.void',
    -- Customers
    'customers.read', 'customers.create', 'customers.update', 'customers.delete',
    -- Suppliers
    'suppliers.read', 'suppliers.create', 'suppliers.update', 'suppliers.delete',
    -- Purchase Orders
    'purchase_orders.read', 'purchase_orders.create',
    'purchase_orders.update', 'purchase_orders.receive',
    -- Finance
    'payments.read', 'credit_sales.read', 'credit_sales.update',
    'expenses.read', 'expenses.create', 'expenses.approve',
    -- Shifts
    'shifts.read',
    -- Reporting & Audit
    'analytics.read', 'audit.read'
)
WHERE  r.role_slug = 'admin'
ON CONFLICT DO NOTHING;

-- ── 4. General Manager — global user, all operational permissions ─────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    -- Users (can create/manage store-level users)
    'users.read', 'users.create', 'users.update',
    -- Stores (read)
    'stores.read',
    -- Departments & Categories
    'departments.read', 'departments.manage',
    'categories.read',  'categories.manage',
    -- Items & Inventory
    'items.read', 'items.create', 'items.update', 'items.delete',
    'inventory.read', 'inventory.adjust', 'inventory.stock_count',
    -- POS
    'pos.sale', 'transactions.read', 'transactions.void',
    -- Customers
    'customers.read', 'customers.create', 'customers.update', 'customers.delete',
    -- Suppliers
    'suppliers.read', 'suppliers.create', 'suppliers.update', 'suppliers.delete',
    -- Purchase Orders
    'purchase_orders.read', 'purchase_orders.create',
    'purchase_orders.update', 'purchase_orders.receive',
    -- Finance
    'payments.read', 'credit_sales.read', 'credit_sales.update',
    'expenses.read', 'expenses.create', 'expenses.approve',
    -- Shifts
    'shifts.read',
    -- Reporting & Audit
    'analytics.read', 'audit.read'
)
WHERE  r.role_slug = 'gm'
ON CONFLICT DO NOTHING;

-- ── 5. Inventory Manager — full inventory + purchasing + analytics ─────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    -- Items — full create/edit/delete
    'items.read', 'items.create', 'items.update', 'items.delete',
    -- Inventory
    'inventory.read', 'inventory.adjust', 'inventory.stock_count',
    -- Suppliers — full management
    'suppliers.read', 'suppliers.create', 'suppliers.update', 'suppliers.delete',
    -- Purchase Orders — full lifecycle
    'purchase_orders.read', 'purchase_orders.create',
    'purchase_orders.update', 'purchase_orders.receive',
    -- Departments & Categories (read + manage)
    'departments.read', 'departments.manage',
    'categories.read',  'categories.manage',
    -- Analytics for inventory reporting
    'analytics.read',
    -- Transactions read-only (needed to see sales history per item)
    'transactions.read',
    -- Expenses read-only
    'expenses.read',
    -- Shifts read-only
    'shifts.read'
)
WHERE  r.role_slug = 'inventory_manager'
ON CONFLICT DO NOTHING;

-- ── 6. Seed: example GM user (global, no store) ───────────────────────────────
-- Password: Manager@123
INSERT INTO users (username, email, password_hash, first_name, last_name, role_id, store_id)
SELECT
    'gm',
    'gm@quantumpos.app',
    '$2b$10$faxjNIj4d/Gf0agqXIEiguXY.jUgwSXlPtnUIaaYhWfGb2rFCxzim',
    'General',
    'Manager',
    r.id,
    NULL           -- global user, no store assignment
FROM   roles r WHERE r.role_slug = 'gm'
ON CONFLICT (username) DO NOTHING;
