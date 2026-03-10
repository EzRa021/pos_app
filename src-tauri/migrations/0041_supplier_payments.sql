-- ============================================================================
-- MIGRATION 0041: Supplier Payments
-- ============================================================================
-- Records payments made to suppliers, linked optionally to a Purchase Order.
-- Adjusts supplier.current_balance on insert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS supplier_payments (
    id              SERIAL PRIMARY KEY,
    supplier_id     INT           NOT NULL REFERENCES suppliers(id),
    store_id        INT           NOT NULL REFERENCES stores(id),
    po_id           INT           REFERENCES purchase_orders(id),
    amount          DECIMAL(15,4) NOT NULL,
    payment_method  VARCHAR(30)   NOT NULL DEFAULT 'cash',
    reference       VARCHAR(100),
    notes           TEXT,
    paid_by         INT           NOT NULL REFERENCES users(id),
    paid_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sp_supplier  ON supplier_payments(supplier_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_sp_store     ON supplier_payments(store_id,    paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_sp_po        ON supplier_payments(po_id) WHERE po_id IS NOT NULL;
