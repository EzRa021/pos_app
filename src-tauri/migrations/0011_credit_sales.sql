-- ============================================================================
-- MIGRATION 0011: Credit Sales & Credit Payments
-- ============================================================================

CREATE TABLE IF NOT EXISTS credit_sales (
    id             SERIAL PRIMARY KEY,
    transaction_id INT           NOT NULL REFERENCES transactions(id),
    store_id       INT           NOT NULL REFERENCES stores(id),
    customer_id    INT           NOT NULL REFERENCES customers(id),
    total_amount   NUMERIC(15,4) NOT NULL,
    amount_paid    NUMERIC(15,4) NOT NULL DEFAULT 0,
    outstanding    NUMERIC(15,4) NOT NULL,
    due_date       TIMESTAMPTZ,
    status         VARCHAR(20)   NOT NULL DEFAULT 'open',  -- open | partial | paid
    notes          TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_customer ON credit_sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_cs_store    ON credit_sales(store_id);
CREATE INDEX IF NOT EXISTS idx_cs_status   ON credit_sales(status);

CREATE TABLE IF NOT EXISTS credit_payments (
    id             SERIAL PRIMARY KEY,
    credit_sale_id INT           NOT NULL REFERENCES credit_sales(id) ON DELETE CASCADE,
    amount         NUMERIC(15,4) NOT NULL,
    payment_method VARCHAR(50)   NOT NULL DEFAULT 'cash',
    reference      VARCHAR(100),
    paid_by        INT           NOT NULL REFERENCES users(id),
    notes          TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_credit_sale ON credit_payments(credit_sale_id);
