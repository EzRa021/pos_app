-- ============================================================================
-- MIGRATION 0004: Departments & Categories
-- ============================================================================

CREATE TABLE IF NOT EXISTS departments (
    id              SERIAL PRIMARY KEY,
    store_id        INT          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    department_name VARCHAR(150) NOT NULL,
    description     TEXT,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, department_name)
);

CREATE INDEX IF NOT EXISTS idx_departments_store ON departments(store_id);

CREATE TABLE IF NOT EXISTS categories (
    id            SERIAL PRIMARY KEY,
    store_id      INT          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    department_id INT          REFERENCES departments(id) ON DELETE SET NULL,
    category_name VARCHAR(150) NOT NULL,
    description   TEXT,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, category_name)
);

CREATE INDEX IF NOT EXISTS idx_categories_store      ON categories(store_id);
CREATE INDEX IF NOT EXISTS idx_categories_department ON categories(department_id);
