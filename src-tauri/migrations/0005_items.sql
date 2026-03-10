-- ============================================================================
-- MIGRATION 0005: Items, Settings, Stock & History  (canonical — all columns)
-- ============================================================================
-- This is the single source of truth for all item-related tables.
-- Every column from later migrations (0024, 0027, 0028) is included here.
-- All statements are idempotent: safe to re-run on an existing database.
-- ============================================================================

-- ── items ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS items (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id       INT           NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id    INT           NOT NULL REFERENCES categories(id),
    department_id  INT           REFERENCES departments(id) ON DELETE SET NULL,
    sku            VARCHAR(100)  NOT NULL,
    barcode        VARCHAR(100),
    item_name      VARCHAR(255)  NOT NULL,
    description    TEXT,
    cost_price     NUMERIC(15,4) NOT NULL DEFAULT 0,
    selling_price  NUMERIC(15,4) NOT NULL DEFAULT 0,
    discount_price NUMERIC(15,4),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_by     INT           REFERENCES users(id) ON DELETE SET NULL,
    updated_by     INT           REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (store_id, sku)
);

-- Add audit columns for existing databases
ALTER TABLE items ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_store    ON items(store_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_barcode  ON items(barcode);
CREATE INDEX IF NOT EXISTS idx_items_sku      ON items(sku);

-- ── item_settings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_settings (
    item_id               UUID         NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    store_id              INT          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    sellable              BOOLEAN      NOT NULL DEFAULT TRUE,
    available_for_pos     BOOLEAN      NOT NULL DEFAULT TRUE,
    track_stock           BOOLEAN      NOT NULL DEFAULT TRUE,
    taxable               BOOLEAN      NOT NULL DEFAULT FALSE,
    min_stock_level       INT          NOT NULL DEFAULT 0,
    max_stock_level       INT          NOT NULL DEFAULT 1000,
    allow_discount        BOOLEAN      NOT NULL DEFAULT TRUE,
    max_discount_percent  NUMERIC(5,2)          DEFAULT 100,
    unit_type             VARCHAR(50),
    unit_value            NUMERIC(10,4),
    requires_weight       BOOLEAN      NOT NULL DEFAULT FALSE,
    allow_negative_stock  BOOLEAN      NOT NULL DEFAULT FALSE,
    archived_at           TIMESTAMPTZ,
    last_modified_by      INT          REFERENCES users(id) ON DELETE SET NULL,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (item_id)
);

-- Add extended columns for existing databases
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS max_discount_percent  NUMERIC(5,2)          DEFAULT 100;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS unit_type             VARCHAR(50);
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS unit_value            NUMERIC(10,4);
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS requires_weight       BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS allow_negative_stock  BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS archived_at           TIMESTAMPTZ;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS last_modified_by      INT          REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE item_settings ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW();

-- ── item_stock ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_stock (
    item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    store_id           INT           NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    quantity           NUMERIC(20,6) NOT NULL DEFAULT 0,
    available_quantity NUMERIC(20,6) NOT NULL DEFAULT 0,
    reserved_quantity  NUMERIC(20,6) NOT NULL DEFAULT 0,
    last_count_date    TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (item_id, store_id)
);

ALTER TABLE item_stock ADD COLUMN IF NOT EXISTS last_count_date TIMESTAMPTZ;

-- ── item_history ──────────────────────────────────────────────────────────────
-- change_type kept for backward compat; event_type is the canonical column.
-- change_type has DEFAULT so inserts that only set event_type never fail.
CREATE TABLE IF NOT EXISTS item_history (
    id                SERIAL        PRIMARY KEY,
    item_id           UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    store_id          INT           NOT NULL,
    -- legacy column kept for backward compatibility
    change_type       VARCHAR(50)   NOT NULL DEFAULT 'UNKNOWN',
    quantity_before   NUMERIC(20,6),
    quantity_after    NUMERIC(20,6),
    adjustment        NUMERIC(20,6),
    reason            TEXT,
    -- canonical columns (added in 0024)
    event_type        VARCHAR(50),
    event_description TEXT,
    quantity_change   NUMERIC(20,6),
    price_before      NUMERIC(15,4),
    price_after       NUMERIC(15,4),
    reference_type    VARCHAR(50),
    reference_id      TEXT,
    ip_address        VARCHAR(45),
    notes             TEXT,
    -- audit
    created_by        INT           REFERENCES users(id) ON DELETE SET NULL,
    performed_by      INT           REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    performed_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Add columns for existing databases (all idempotent)
ALTER TABLE item_history ALTER COLUMN change_type SET DEFAULT 'UNKNOWN';
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS event_type        VARCHAR(50);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS event_description TEXT;
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS quantity_change   NUMERIC(20,6);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS price_before      NUMERIC(15,4);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS price_after       NUMERIC(15,4);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS reference_type    VARCHAR(50);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS reference_id      TEXT;
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS ip_address        VARCHAR(45);
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS performed_by      INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS performed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Back-fill: sync legacy columns → canonical columns on existing rows
UPDATE item_history
SET event_type      = COALESCE(event_type,      change_type),
    performed_by    = COALESCE(performed_by,    created_by),
    performed_at    = COALESCE(performed_at,    created_at),
    quantity_change = COALESCE(quantity_change, adjustment)
WHERE event_type IS NULL OR performed_by IS NULL;

UPDATE item_history
SET change_type = COALESCE(change_type, event_type, 'UNKNOWN')
WHERE change_type IS NULL OR change_type = '';

-- Trigger: keep change_type and event_type in sync on every INSERT/UPDATE
CREATE OR REPLACE FUNCTION sync_item_history_change_type()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.change_type IS NULL OR NEW.change_type = 'UNKNOWN' THEN
        NEW.change_type := COALESCE(NEW.event_type, 'UNKNOWN');
    END IF;
    IF NEW.event_type IS NULL THEN
        NEW.event_type := NEW.change_type;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_history_change_type ON item_history;
CREATE TRIGGER trg_sync_item_history_change_type
    BEFORE INSERT OR UPDATE ON item_history
    FOR EACH ROW EXECUTE FUNCTION sync_item_history_change_type();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_item_history_item        ON item_history(item_id);
CREATE INDEX IF NOT EXISTS idx_item_history_store       ON item_history(store_id);
CREATE INDEX IF NOT EXISTS idx_item_history_event_type  ON item_history(event_type);
CREATE INDEX IF NOT EXISTS idx_item_history_performed   ON item_history(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ih_item_store_at         ON item_history(item_id, store_id, performed_at DESC);
