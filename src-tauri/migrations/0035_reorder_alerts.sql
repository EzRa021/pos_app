-- ============================================================================
-- MIGRATION 0035: Reorder Alerts
-- ============================================================================
-- Tracks automatic low-stock triggers per item/store.
-- One active (non-ordered) alert per item per store at a time.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reorder_alerts (
    id               SERIAL PRIMARY KEY,
    item_id          UUID          NOT NULL REFERENCES items(id),
    store_id         INT           NOT NULL REFERENCES stores(id),
    triggered_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    current_qty      DECIMAL(12,4) NOT NULL,
    min_stock_level  DECIMAL(12,4) NOT NULL,
    status           VARCHAR(20)   NOT NULL DEFAULT 'pending',  -- pending | acknowledged | ordered
    linked_po_id     INT           REFERENCES purchase_orders(id),
    acknowledged_by  INT           REFERENCES users(id),
    acknowledged_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ra_store_status
    ON reorder_alerts(store_id, status);
CREATE INDEX IF NOT EXISTS idx_ra_item_store
    ON reorder_alerts(item_id, store_id);
-- Only one pending/acknowledged alert per item per store at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_ra_item_store_active
    ON reorder_alerts(item_id, store_id)
    WHERE status IN ('pending', 'acknowledged');
