-- ============================================================================
-- MIGRATION 0012: Expenses
-- ============================================================================

CREATE TABLE IF NOT EXISTS expenses (
    id             SERIAL PRIMARY KEY,
    store_id       INT           NOT NULL REFERENCES stores(id),
    category       VARCHAR(100)  NOT NULL,
    description    TEXT          NOT NULL,
    amount         NUMERIC(15,4) NOT NULL,
    paid_to        VARCHAR(200),
    payment_method VARCHAR(50)   NOT NULL DEFAULT 'cash',
    reference      VARCHAR(100),
    expense_date   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    recorded_by    INT           NOT NULL REFERENCES users(id),
    approved_by    INT           REFERENCES users(id),
    status         VARCHAR(20)   NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
    notes          TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_store  ON expenses(store_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date   ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
