-- ============================================================================
-- MIGRATION 0036: Stock Transfers
-- ============================================================================
-- Inter-branch stock movement with full status lifecycle and item-level detail.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_transfers (
    id              SERIAL PRIMARY KEY,
    transfer_number VARCHAR(50)  UNIQUE NOT NULL,
    from_store_id   INT          NOT NULL REFERENCES stores(id),
    to_store_id     INT          NOT NULL REFERENCES stores(id),
    status          VARCHAR(20)  NOT NULL DEFAULT 'draft',  -- draft | in_transit | received | cancelled
    requested_by    INT          REFERENCES users(id),
    approved_by     INT          REFERENCES users(id),
    sent_by         INT          REFERENCES users(id),
    received_by     INT          REFERENCES users(id),
    notes           TEXT,
    requested_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    received_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id            SERIAL PRIMARY KEY,
    transfer_id   INT           NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    item_id       UUID          NOT NULL REFERENCES items(id),
    qty_requested DECIMAL(12,4) NOT NULL DEFAULT 0,
    qty_sent      DECIMAL(12,4),
    qty_received  DECIMAL(12,4),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE(transfer_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_st_from_store  ON stock_transfers(from_store_id, status);
CREATE INDEX IF NOT EXISTS idx_st_to_store    ON stock_transfers(to_store_id,   status);
CREATE INDEX IF NOT EXISTS idx_sti_transfer   ON stock_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_sti_item       ON stock_transfer_items(item_id);
