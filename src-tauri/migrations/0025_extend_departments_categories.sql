-- ============================================================================
-- MIGRATION 0025: Extend departments & categories (idempotent)
-- ============================================================================
-- Extends with per-store unique codes and hierarchy support.
-- Idempotent: safe to re-run on any existing database.
-- ============================================================================

-- ── Departments ───────────────────────────────────────────────────────────────
ALTER TABLE departments ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS department_code      VARCHAR(50);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS parent_department_id INT REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS display_order        INT NOT NULL DEFAULT 0;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS color                VARCHAR(50);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS icon                 VARCHAR(100);

-- Drop any stale global unique index before creating per-store one
DROP INDEX IF EXISTS idx_departments_code;

-- Per-store unique code (NULL codes always allowed to repeat across stores)
CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_store_code
    ON departments(store_id, department_code)
    WHERE department_code IS NOT NULL;

-- ── Categories ────────────────────────────────────────────────────────────────
ALTER TABLE categories ADD COLUMN IF NOT EXISTS category_code      VARCHAR(50);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_category_id INT REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS display_order      INT     NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS color              VARCHAR(50);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon               VARCHAR(100);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url          TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_visible_in_pos  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS requires_weighing  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS default_tax_rate   NUMERIC(5,2);

DROP INDEX IF EXISTS idx_categories_code_store;

CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_store_code
    ON categories(store_id, category_code)
    WHERE category_code IS NOT NULL;
