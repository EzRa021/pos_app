-- ============================================================================
-- MIGRATION 0024: Enrich departments, categories, item_settings
-- ============================================================================
-- All statements are idempotent: safe to re-run on an existing database.
-- ============================================================================

-- ── Departments ───────────────────────────────────────────────────────────────
ALTER TABLE departments ADD COLUMN IF NOT EXISTS department_code      VARCHAR(50);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS parent_department_id INT REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS display_order        INT NOT NULL DEFAULT 0;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS color                VARCHAR(20);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS icon                 VARCHAR(100);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS created_by           INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS updated_by           INT REFERENCES users(id) ON DELETE SET NULL;

-- Make store_id optional (global departments have NULL store_id)
ALTER TABLE departments ALTER COLUMN store_id DROP NOT NULL;

-- Drop the old GLOBAL unique index on department_code — it wrongly blocks
-- two stores from sharing the same code (e.g. "GEN" in both Store A and Store B).
DROP INDEX IF EXISTS idx_departments_code;

-- Replace with a PER-STORE unique index (NULL codes are always allowed to repeat)
CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_store_code
    ON departments(store_id, department_code)
    WHERE department_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_department_id);

-- ── Categories ────────────────────────────────────────────────────────────────
ALTER TABLE categories ADD COLUMN IF NOT EXISTS category_code      VARCHAR(50);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_category_id INT REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS display_order      INT           NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS color              VARCHAR(20);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon               VARCHAR(100);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url          TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_visible_in_pos  BOOLEAN       NOT NULL DEFAULT TRUE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS requires_weighing  BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS default_tax_rate   NUMERIC(5,2);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS created_by         INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_by         INT REFERENCES users(id) ON DELETE SET NULL;

-- Drop old global index if it exists, replace with per-store index
DROP INDEX IF EXISTS idx_categories_code_store;

CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_store_code
    ON categories(store_id, category_code)
    WHERE category_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_category_id);

-- ── Item Settings ─────────────────────────────────────────────────────────────
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS max_discount_percent NUMERIC(5,2)          DEFAULT 100;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS unit_type            VARCHAR(50);
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS unit_value           NUMERIC(10,4);
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS requires_weight      BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS archived_at          TIMESTAMPTZ;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS last_modified_by     INT          REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW();

-- ── Item History ─────────────────────────────────────────────────────────────
ALTER TABLE item_history ALTER COLUMN change_type SET DEFAULT 'UNKNOWN';
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS event_type        VARCHAR(50);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS event_description TEXT;
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS quantity_change   NUMERIC(20,6);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS performed_by      INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS performed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS reference_type    VARCHAR(50);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS reference_id      TEXT;
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS ip_address        VARCHAR(45);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS price_before      NUMERIC(15,4);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS price_after       NUMERIC(15,4);

-- Back-fill canonical columns from legacy values
UPDATE item_history
SET event_type      = COALESCE(event_type,      change_type),
    performed_by    = COALESCE(performed_by,    created_by),
    performed_at    = COALESCE(performed_at,    created_at),
    quantity_change = COALESCE(quantity_change, adjustment)
WHERE event_type IS NULL OR performed_by IS NULL;

UPDATE item_history
SET change_type = COALESCE(NULLIF(change_type, ''), event_type, 'UNKNOWN')
WHERE change_type IS NULL OR change_type = '';

CREATE INDEX IF NOT EXISTS idx_item_history_event_type ON item_history(event_type);
CREATE INDEX IF NOT EXISTS idx_item_history_performed  ON item_history(performed_at DESC);
