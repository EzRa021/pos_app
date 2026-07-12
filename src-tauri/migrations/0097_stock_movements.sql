-- ============================================================================
-- MIGRATION 0097: Stock movement log — delta-based sync for item_stock
-- ============================================================================
-- item_stock quantities are running counts. Row-snapshot sync loses updates:
-- two devices selling the same item offline against the same starting qty
-- would each push an absolute value and one deduction silently vanishes.
--
-- Fix: every stock mutation also appends a stock_movements row —
--   • movement = 'delta' → signed qty change (sale −3, receive +10, …)
--   • movement = 'set'   → absolute count (physical stock count / import)
-- Movements sync as append-only rows (UUID dedupe) and are APPLIED to the
-- target side's item_stock on first arrival:
--   • deltas add on top of whatever the current quantity is (commutative),
--   • sets replace, guarded by item_stock.last_count_date so an older count
--     never clobbers a newer one.
--
-- item_stock itself is no longer replicated as authoritative state — it is
-- only ever SEEDED (ON CONFLICT DO NOTHING) on a side that lacks the row.
--   • applied_at            — stamped with the CLOUD clock when the push
--     worker applies the movement to cloud item_stock. The pull worker skips
--     movements already reflected in a seeded snapshot by comparing
--     applied_at to item_stock.cloud_seeded_at (both cloud-clock, so the
--     comparison is safe regardless of device clock skew).
--   • item_stock.cloud_seeded_at — cloud updated_at captured when a local
--     row was created from a pulled cloud snapshot; NULL for locally-created
--     rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_movements (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id      UUID           NOT NULL REFERENCES items(id)  ON DELETE CASCADE,
    store_id     INT            NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    business_id  UUID,
    movement     TEXT           NOT NULL CHECK (movement IN ('delta', 'set')),
    qty_delta    NUMERIC(20,6),
    qty_set      NUMERIC(20,6),
    reason       TEXT,          -- 'sale','void','refund','return','po_receive',
                                -- 'adjustment','initial','count','import',
                                -- 'transfer_out','transfer_in'
    device_id    UUID,
    applied_at   TIMESTAMPTZ,   -- cloud-clock apply time (NULL until pushed)
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT stock_movements_qty_chk CHECK (
        (movement = 'delta' AND qty_delta IS NOT NULL) OR
        (movement = 'set'   AND qty_set   IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_item  ON stock_movements(item_id, store_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_time  ON stock_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_biz   ON stock_movements(business_id);

ALTER TABLE item_stock ADD COLUMN IF NOT EXISTS cloud_seeded_at TIMESTAMPTZ;
