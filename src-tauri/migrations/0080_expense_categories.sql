-- ============================================================================
-- MIGRATION 0080: Expense Categories
-- Replaces the free-text `category` field on expenses with a proper table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS expense_categories (
    id          SERIAL PRIMARY KEY,
    store_id    INT          REFERENCES stores(id) ON DELETE CASCADE,  -- NULL = global
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_store ON expense_categories(store_id);

-- Seed built-in global categories (store_id = NULL)
INSERT INTO expense_categories (store_id, name, description) VALUES
    (NULL, 'Operational',  'Day-to-day running costs'),
    (NULL, 'Capital',      'Long-term asset purchases'),
    (NULL, 'Salary',       'Staff wages and salaries'),
    (NULL, 'Utilities',    'Electricity, water, internet'),
    (NULL, 'Rent',         'Store or office rent'),
    (NULL, 'Maintenance',  'Repairs and upkeep'),
    (NULL, 'Marketing',    'Advertising and promotions'),
    (NULL, 'Transport',    'Delivery and logistics'),
    (NULL, 'Supplies',     'Office and operational supplies'),
    (NULL, 'Miscellaneous','Other uncategorised expenses')
ON CONFLICT DO NOTHING;
