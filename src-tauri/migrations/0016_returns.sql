-- ============================================================================
-- MIGRATION 0016: Returns & Refunds
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS return_ref_seq START 1;

CREATE TABLE IF NOT EXISTS returns (
    id               SERIAL PRIMARY KEY,
    reference_no     VARCHAR(50)   NOT NULL UNIQUE,
    original_tx_id   INT           NOT NULL REFERENCES transactions(id),
    store_id         INT           NOT NULL REFERENCES stores(id),
    cashier_id       INT           NOT NULL REFERENCES users(id),
    customer_id      INT           REFERENCES customers(id) ON DELETE SET NULL,
    return_type      VARCHAR(20)   NOT NULL DEFAULT 'partial',  -- full | partial
    subtotal         NUMERIC(15,4) NOT NULL DEFAULT 0,
    tax_amount       NUMERIC(15,4) NOT NULL DEFAULT 0,
    total_amount     NUMERIC(15,4) NOT NULL DEFAULT 0,
    refund_method    VARCHAR(50)   NOT NULL DEFAULT 'cash',
    refund_reference VARCHAR(100),
    status           VARCHAR(20)   NOT NULL DEFAULT 'completed',
    reason           TEXT,
    notes            TEXT,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_returns_store  ON returns(store_id);
CREATE INDEX IF NOT EXISTS idx_returns_tx     ON returns(original_tx_id);
CREATE INDEX IF NOT EXISTS idx_returns_cashier ON returns(cashier_id);
CREATE INDEX IF NOT EXISTS idx_returns_date   ON returns(created_at DESC);

CREATE TABLE IF NOT EXISTS return_items (
    id               SERIAL PRIMARY KEY,
    return_id        INT           NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    item_id          UUID          NOT NULL REFERENCES items(id),
    item_name        VARCHAR(255)  NOT NULL,
    sku              VARCHAR(100)  NOT NULL,
    quantity_returned NUMERIC(20,6) NOT NULL,
    unit_price       NUMERIC(15,4) NOT NULL,
    line_total       NUMERIC(15,4) NOT NULL,
    condition        VARCHAR(20)   NOT NULL DEFAULT 'good',  -- good | damaged | defective
    restocked        BOOLEAN       NOT NULL DEFAULT TRUE,
    notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_item   ON return_items(item_id);
