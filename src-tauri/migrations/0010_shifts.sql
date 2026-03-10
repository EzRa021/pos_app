-- ============================================================================
-- MIGRATION 0010: Shifts
-- ============================================================================

CREATE TABLE IF NOT EXISTS shifts (
    id               SERIAL PRIMARY KEY,
    store_id         INT           NOT NULL REFERENCES stores(id),
    cashier_id       INT           NOT NULL REFERENCES users(id),
    opening_balance  NUMERIC(15,4) NOT NULL DEFAULT 0,
    closing_balance  NUMERIC(15,4),
    total_sales      NUMERIC(15,4),
    total_refunds    NUMERIC(15,4),
    notes            TEXT,
    status           VARCHAR(20)   NOT NULL DEFAULT 'open',  -- open | closed
    opened_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    closed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shifts_cashier ON shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_shifts_store   ON shifts(store_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status  ON shifts(status);
