-- ============================================================================
-- MIGRATION 0017: Cash Movements & Drawer Events
-- ============================================================================

CREATE TABLE IF NOT EXISTS cash_movements (
    id            SERIAL PRIMARY KEY,
    shift_id      INT           NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    movement_type VARCHAR(30)   NOT NULL,  -- deposit | withdrawal | payout | adjustment
    amount        NUMERIC(15,4) NOT NULL,
    reason        TEXT          NOT NULL,
    reference     VARCHAR(100),
    created_by    INT           NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_mv_shift ON cash_movements(shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_mv_date  ON cash_movements(created_at DESC);

CREATE TABLE IF NOT EXISTS cash_drawer_events (
    id          SERIAL PRIMARY KEY,
    shift_id    INT         NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    event_type  VARCHAR(30) NOT NULL,  -- opened | closed | cash_added | cash_removed | reconciled | suspended | resumed
    notes       TEXT,
    created_by  INT         NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drawer_shift ON cash_drawer_events(shift_id);
