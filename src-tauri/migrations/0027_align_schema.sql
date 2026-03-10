-- ============================================================================
-- MIGRATION 0027: Full schema alignment with quantum-pos-app services
-- ============================================================================
-- Adds every column required by the updated Rust commands/models so that
-- item.service.js and inventory.service.js behaviours are exactly mirrored.
-- All changes use IF NOT EXISTS / IF EXISTS guards so re-running is safe.
-- ============================================================================

-- ── 1. items — add audit columns ─────────────────────────────────────────────
ALTER TABLE items
    ADD COLUMN IF NOT EXISTS created_by  INT  REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_by  INT  REFERENCES users(id) ON DELETE SET NULL;

-- ── 2. item_stock — add last_count_date ──────────────────────────────────────
ALTER TABLE item_stock
    ADD COLUMN IF NOT EXISTS last_count_date TIMESTAMPTZ;

-- ── 3. stock_count_sessions — add full quantum-pos-app columns ────────────────
ALTER TABLE stock_count_sessions
    ADD COLUMN IF NOT EXISTS session_number       VARCHAR(50),
    ADD COLUMN IF NOT EXISTS count_type           VARCHAR(20)    NOT NULL DEFAULT 'full',
    ADD COLUMN IF NOT EXISTS started_by           INT            REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS completed_by         INT            REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS total_items          INT            NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS items_counted        INT            NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS items_with_variance  INT            NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_variance_value NUMERIC(15,4)  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW();

-- Back-fill started_by from counted_by on existing rows
UPDATE stock_count_sessions
SET started_by = COALESCE(started_by, counted_by)
WHERE started_by IS NULL;

-- Generate placeholder session numbers for any existing rows that lack one
UPDATE stock_count_sessions
SET session_number = 'COUNT-' || EXTRACT(YEAR FROM created_at)::TEXT
                  || '-' || LPAD(id::TEXT, 4, '0')
WHERE session_number IS NULL;

-- Make session_number unique (NULL allowed for extreme edge cases)
CREATE UNIQUE INDEX IF NOT EXISTS ux_scs_session_number
    ON stock_count_sessions(session_number)
    WHERE session_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scs_count_type  ON stock_count_sessions(count_type);
CREATE INDEX IF NOT EXISTS idx_scs_started_by  ON stock_count_sessions(started_by);

-- ── 4. stock_count_items — add full quantum-pos-app columns ──────────────────

-- 4a. Allow old NOT NULL columns to accept a DEFAULT so new inserts
--     that only use the new column names don't violate the constraint.
ALTER TABLE stock_count_items
    ALTER COLUMN counted_qty SET DEFAULT 0;

-- 4b. Add new columns
ALTER TABLE stock_count_items
    ADD COLUMN IF NOT EXISTS store_id          INT           REFERENCES stores(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS system_quantity   NUMERIC(20,6) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS counted_quantity  NUMERIC(20,6) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cost_price        NUMERIC(15,4),
    ADD COLUMN IF NOT EXISTS counted_by        INT           REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_adjusted       BOOLEAN       NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS adjustment_id     INT           REFERENCES item_history(id) ON DELETE SET NULL;

-- 4c. Generated columns — variance_quantity, variance_value, variance_percentage
--     (Only add if they don't already exist; generated columns cannot use IF NOT EXISTS
--      directly, so we guard with a DO block.)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_count_items' AND column_name = 'variance_quantity'
    ) THEN
        ALTER TABLE stock_count_items
            ADD COLUMN variance_quantity NUMERIC(20,6)
                GENERATED ALWAYS AS (counted_quantity - system_quantity) STORED;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_count_items' AND column_name = 'variance_value'
    ) THEN
        ALTER TABLE stock_count_items
            ADD COLUMN variance_value NUMERIC(15,4)
                GENERATED ALWAYS AS (
                    (counted_quantity - system_quantity) * COALESCE(cost_price, 0)
                ) STORED;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_count_items' AND column_name = 'variance_percentage'
    ) THEN
        ALTER TABLE stock_count_items
            ADD COLUMN variance_percentage NUMERIC(10,4)
                GENERATED ALWAYS AS (
                    CASE WHEN system_quantity <> 0
                         THEN ((counted_quantity - system_quantity) / system_quantity) * 100
                    END
                ) STORED;
    END IF;
END
$$;

-- 4d. Back-fill new columns from old column values on existing rows
UPDATE stock_count_items
SET system_quantity  = COALESCE(system_quantity,  COALESCE(expected_qty, 0)),
    counted_quantity = COALESCE(counted_quantity,  counted_qty)
WHERE system_quantity = 0 AND counted_quantity = 0
  AND (expected_qty IS NOT NULL OR counted_qty IS NOT NULL);

-- 4e. UNIQUE constraint so ON CONFLICT (session_id, item_id) works in record_count
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_sci_session_item'
    ) THEN
        ALTER TABLE stock_count_items
            ADD CONSTRAINT uq_sci_session_item UNIQUE (session_id, item_id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sci_counted_by   ON stock_count_items(counted_by);
CREATE INDEX IF NOT EXISTS idx_sci_is_adjusted  ON stock_count_items(is_adjusted);
CREATE INDEX IF NOT EXISTS idx_sci_store        ON stock_count_items(store_id);

-- ── 5. item_history — ensure performed_at index exists ───────────────────────
--      (0024 already adds the column; this is a safety net for the index)
CREATE INDEX IF NOT EXISTS idx_ih_item_store_at
    ON item_history(item_id, store_id, performed_at DESC);
