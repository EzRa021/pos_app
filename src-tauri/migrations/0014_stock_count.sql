-- ============================================================================
-- MIGRATION 0014: Stock Count Sessions & Items  (canonical — all columns)
-- ============================================================================
-- This is the single source of truth for stock_count_sessions and
-- stock_count_items. All columns from 0027 and 0029 are included here.
-- All statements are idempotent: safe to re-run on an existing database.
-- ============================================================================

-- ── stock_count_sessions ──────────────────────────────────────────────────────
-- counted_by kept for backward compat (has DEFAULT so new inserts don't fail).
-- started_by is the canonical column used by all Rust commands.
CREATE TABLE IF NOT EXISTS stock_count_sessions (
    id                    SERIAL        PRIMARY KEY,
    store_id              INT           NOT NULL REFERENCES stores(id),
    session_number        VARCHAR(50),
    count_type            VARCHAR(20)   NOT NULL DEFAULT 'full',
    -- legacy column kept for backward compat
    counted_by            INT           NOT NULL DEFAULT 0 REFERENCES users(id),
    -- canonical columns
    started_by            INT           REFERENCES users(id) ON DELETE SET NULL,
    completed_by          INT           REFERENCES users(id) ON DELETE SET NULL,
    status                VARCHAR(20)   NOT NULL DEFAULT 'in_progress',
    notes                 TEXT,
    total_items           INT           NOT NULL DEFAULT 0,
    items_counted         INT           NOT NULL DEFAULT 0,
    items_with_variance   INT           NOT NULL DEFAULT 0,
    total_variance_value  NUMERIC(15,4) NOT NULL DEFAULT 0,
    started_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Add columns for existing databases
ALTER TABLE stock_count_sessions ALTER COLUMN counted_by SET DEFAULT 0;
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS session_number       VARCHAR(50);
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS count_type           VARCHAR(20)   NOT NULL DEFAULT 'full';
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS started_by           INT           REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS completed_by         INT           REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS total_items          INT           NOT NULL DEFAULT 0;
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS items_counted        INT           NOT NULL DEFAULT 0;
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS items_with_variance  INT           NOT NULL DEFAULT 0;
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS total_variance_value NUMERIC(15,4) NOT NULL DEFAULT 0;
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW();

-- Back-fill: sync legacy → canonical on existing rows
UPDATE stock_count_sessions
SET started_by = COALESCE(started_by, NULLIF(counted_by, 0))
WHERE started_by IS NULL AND counted_by IS NOT NULL AND counted_by != 0;

-- Generate session numbers for any rows that lack one
UPDATE stock_count_sessions
SET session_number = 'COUNT-' || EXTRACT(YEAR FROM created_at)::TEXT
                  || '-' || LPAD(id::TEXT, 4, '0')
WHERE session_number IS NULL;

-- Trigger: keep counted_by in sync with started_by so the NOT NULL is never violated
CREATE OR REPLACE FUNCTION sync_stock_count_sessions_counted_by()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.counted_by IS NULL OR NEW.counted_by = 0 THEN
        NEW.counted_by := COALESCE(NEW.started_by, 0);
    END IF;
    IF NEW.started_by IS NULL THEN
        NEW.started_by := NULLIF(NEW.counted_by, 0);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_scs_counted_by ON stock_count_sessions;
CREATE TRIGGER trg_sync_scs_counted_by
    BEFORE INSERT OR UPDATE ON stock_count_sessions
    FOR EACH ROW EXECUTE FUNCTION sync_stock_count_sessions_counted_by();

-- Unique session number (NULL allowed)
CREATE UNIQUE INDEX IF NOT EXISTS ux_scs_session_number
    ON stock_count_sessions(session_number)
    WHERE session_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scs_store      ON stock_count_sessions(store_id);
CREATE INDEX IF NOT EXISTS idx_scs_status     ON stock_count_sessions(status);
CREATE INDEX IF NOT EXISTS idx_scs_count_type ON stock_count_sessions(count_type);
CREATE INDEX IF NOT EXISTS idx_scs_started_by ON stock_count_sessions(started_by);

-- ── stock_count_items ─────────────────────────────────────────────────────────
-- counted_qty kept for backward compat (DEFAULT 0 so new inserts don't fail).
-- counted_quantity / system_quantity are the canonical columns.
CREATE TABLE IF NOT EXISTS stock_count_items (
    id               SERIAL        PRIMARY KEY,
    session_id       INT           NOT NULL REFERENCES stock_count_sessions(id) ON DELETE CASCADE,
    item_id          UUID          NOT NULL REFERENCES items(id),
    store_id         INT           REFERENCES stores(id) ON DELETE CASCADE,
    -- legacy columns
    expected_qty     NUMERIC(20,6),
    counted_qty      NUMERIC(20,6) NOT NULL DEFAULT 0,
    -- canonical columns
    system_quantity  NUMERIC(20,6) NOT NULL DEFAULT 0,
    counted_quantity NUMERIC(20,6) NOT NULL DEFAULT 0,
    cost_price       NUMERIC(15,4),
    counted_by       INT           REFERENCES users(id) ON DELETE SET NULL,
    is_adjusted      BOOLEAN       NOT NULL DEFAULT FALSE,
    adjustment_id    INT           REFERENCES item_history(id) ON DELETE SET NULL,
    notes            TEXT,
    counted_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Add columns for existing databases
ALTER TABLE stock_count_items ALTER COLUMN counted_qty SET DEFAULT 0;
ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS store_id         INT           REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS system_quantity  NUMERIC(20,6) NOT NULL DEFAULT 0;
ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS counted_quantity NUMERIC(20,6) NOT NULL DEFAULT 0;
ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS cost_price       NUMERIC(15,4);
ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS counted_by       INT           REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS is_adjusted      BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS adjustment_id    INT           REFERENCES item_history(id) ON DELETE SET NULL;

-- Back-fill canonical columns from legacy values
UPDATE stock_count_items
SET system_quantity  = COALESCE(NULLIF(system_quantity, 0),  expected_qty, 0),
    counted_quantity = COALESCE(NULLIF(counted_quantity, 0), counted_qty,  0)
WHERE (system_quantity = 0 OR counted_quantity = 0)
  AND (expected_qty IS NOT NULL OR counted_qty IS NOT NULL);

-- Generated columns: add only if they don't exist (cannot use IF NOT EXISTS directly)
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

-- UNIQUE constraint so ON CONFLICT (session_id, item_id) works in record_count
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_sci_session_item'
    ) THEN
        ALTER TABLE stock_count_items
            ADD CONSTRAINT uq_sci_session_item UNIQUE (session_id, item_id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sci_session    ON stock_count_items(session_id);
CREATE INDEX IF NOT EXISTS idx_sci_item       ON stock_count_items(item_id);
CREATE INDEX IF NOT EXISTS idx_sci_counted_by ON stock_count_items(counted_by);
CREATE INDEX IF NOT EXISTS idx_sci_adjusted   ON stock_count_items(is_adjusted);
CREATE INDEX IF NOT EXISTS idx_sci_store      ON stock_count_items(store_id);
