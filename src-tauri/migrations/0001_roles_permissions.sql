-- ============================================================================
-- MIGRATION 0001: Roles & Permissions
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
    id              SERIAL PRIMARY KEY,
    role_name       VARCHAR(100) NOT NULL UNIQUE,
    role_slug       VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    is_global       BOOLEAN NOT NULL DEFAULT FALSE,
    hierarchy_level INT     NOT NULL DEFAULT 99,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
    id              SERIAL PRIMARY KEY,
    permission_name VARCHAR(100) NOT NULL UNIQUE,
    permission_slug VARCHAR(100) NOT NULL UNIQUE,
    category        VARCHAR(60),
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       INT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
    permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ── Seed: core roles ──────────────────────────────────────────────────────────
INSERT INTO roles (role_name, role_slug, description, is_global, hierarchy_level) VALUES
    ('Super Admin',  'super_admin',  'Full access to all stores and settings', TRUE,  1),
    ('Admin',        'admin',        'Store administrator',                     FALSE, 2),
    ('Manager',      'manager',      'Store manager',                           FALSE, 3),
    ('Cashier',      'cashier',      'POS terminal operator',                   FALSE, 4),
    ('Stock Keeper', 'stock_keeper', 'Inventory management',                    FALSE, 5)
ON CONFLICT (role_slug) DO NOTHING;

-- ── Seed: permissions ─────────────────────────────────────────────────────────
INSERT INTO permissions (permission_name, permission_slug, category) VALUES
    -- Users
    ('View Users',         'users.read',           'users'),
    ('Create Users',       'users.create',         'users'),
    ('Update Users',       'users.update',         'users'),
    ('Delete Users',       'users.delete',         'users'),
    -- Stores
    ('View Stores',        'stores.read',          'stores'),
    ('Manage Stores',      'stores.manage',        'stores'),
    -- Departments
    ('View Departments',   'departments.read',     'departments'),
    ('Manage Departments', 'departments.manage',   'departments'),
    -- Categories
    ('View Categories',    'categories.read',      'categories'),
    ('Manage Categories',  'categories.manage',    'categories'),
    -- Items
    ('View Items',         'items.read',           'items'),
    ('Create Items',       'items.create',         'items'),
    ('Update Items',       'items.update',         'items'),
    ('Delete Items',       'items.delete',         'items'),
    -- Inventory
    ('View Inventory',     'inventory.read',       'inventory'),
    ('Adjust Stock',       'inventory.adjust',     'inventory'),
    ('Stock Count',        'inventory.stock_count','inventory'),
    -- POS
    ('Process Sales',      'pos.sale',             'pos'),
    ('Void Transactions',  'transactions.void',    'pos'),
    ('View Transactions',  'transactions.read',    'pos'),
    -- Customers
    ('View Customers',     'customers.read',       'customers'),
    ('Create Customers',   'customers.create',     'customers'),
    ('Update Customers',   'customers.update',     'customers'),
    ('Delete Customers',   'customers.delete',     'customers'),
    -- Suppliers
    ('View Suppliers',     'suppliers.read',       'suppliers'),
    ('Create Suppliers',   'suppliers.create',     'suppliers'),
    ('Update Suppliers',   'suppliers.update',     'suppliers'),
    ('Delete Suppliers',   'suppliers.delete',     'suppliers'),
    -- Purchase Orders
    ('View Purchase Orders',    'purchase_orders.read',    'purchasing'),
    ('Create Purchase Orders',  'purchase_orders.create',  'purchasing'),
    ('Update Purchase Orders',  'purchase_orders.update',  'purchasing'),
    ('Receive Purchase Orders', 'purchase_orders.receive', 'purchasing'),
    -- Payments
    ('View Payments',      'payments.read',        'payments'),
    -- Shifts
    ('View Shifts',        'shifts.read',          'shifts'),
    -- Credit Sales
    ('View Credit Sales',  'credit_sales.read',    'credit'),
    ('Update Credit Sales','credit_sales.update',  'credit'),
    -- Expenses
    ('View Expenses',      'expenses.read',        'expenses'),
    ('Create Expenses',    'expenses.create',      'expenses'),
    ('Approve Expenses',   'expenses.approve',     'expenses'),
    -- Audit
    ('View Audit Log',     'audit.read',           'audit'),
    -- Analytics
    ('View Analytics',     'analytics.read',       'analytics')
ON CONFLICT (permission_slug) DO NOTHING;

-- ── Seed: assign all permissions to super_admin ───────────────────────────────
-- (super_admin uses is_global=TRUE so guard() bypasses permission checks, but
--  explicit entries make the data consistent for UI display)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r, permissions p
WHERE  r.role_slug = 'super_admin'
ON CONFLICT DO NOTHING;

-- ── Seed: cashier permissions ─────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    'pos.sale', 'transactions.read', 'items.read',
    'customers.read', 'customers.create', 'customers.update',
    'inventory.read', 'shifts.read', 'credit_sales.read'
)
WHERE  r.role_slug = 'cashier'
ON CONFLICT DO NOTHING;

-- ── Seed: stock keeper permissions ───────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    'items.read', 'items.create', 'items.update',
    'inventory.read', 'inventory.adjust', 'inventory.stock_count',
    'suppliers.read', 'purchase_orders.read', 'purchase_orders.create',
    'purchase_orders.receive', 'categories.read', 'departments.read'
)
WHERE  r.role_slug = 'stock_keeper'
ON CONFLICT DO NOTHING;

-- ── Seed: manager permissions ─────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.permission_slug IN (
    'pos.sale', 'transactions.read', 'transactions.void',
    'items.read', 'items.create', 'items.update',
    'inventory.read', 'inventory.adjust', 'inventory.stock_count',
    'customers.read', 'customers.create', 'customers.update',
    'suppliers.read', 'suppliers.create', 'suppliers.update',
    'purchase_orders.read', 'purchase_orders.create', 'purchase_orders.receive',
    'payments.read', 'shifts.read', 'credit_sales.read', 'credit_sales.update',
    'expenses.read', 'expenses.create', 'analytics.read',
    'categories.read', 'departments.read'
)
WHERE  r.role_slug = 'manager'
ON CONFLICT DO NOTHING;
