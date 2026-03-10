-- ============================================================================
-- MIGRATION 0009: Purchase Orders
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS po_ref_seq START 1;

CREATE TABLE IF NOT EXISTS purchase_orders (
    id           SERIAL PRIMARY KEY,
    po_number    VARCHAR(50)   NOT NULL UNIQUE,
    store_id     INT           NOT NULL REFERENCES stores(id),
    supplier_id  INT           NOT NULL REFERENCES suppliers(id),
    status       VARCHAR(30)   NOT NULL DEFAULT 'pending',  -- pending | received | cancelled
    total_amount NUMERIC(15,4) NOT NULL DEFAULT 0,
    notes        TEXT,
    ordered_by   INT           NOT NULL REFERENCES users(id),
    ordered_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    received_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_store    ON purchase_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status   ON purchase_orders(status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                SERIAL PRIMARY KEY,
    po_id             INT           NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id           UUID          NOT NULL REFERENCES items(id),
    quantity_ordered  NUMERIC(20,6) NOT NULL,
    quantity_received NUMERIC(20,6),
    unit_cost         NUMERIC(15,4) NOT NULL,
    line_total        NUMERIC(15,4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_po_items_po   ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_item ON purchase_order_items(item_id);
