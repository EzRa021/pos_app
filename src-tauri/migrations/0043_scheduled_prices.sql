-- ============================================================================
-- MIGRATION 0043: Scheduled Price Changes
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheduled_price_changes (
    id                SERIAL PRIMARY KEY,
    item_id           UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    store_id          INT           NOT NULL REFERENCES stores(id),
    new_selling_price DECIMAL(15,4) NOT NULL,
    new_cost_price    DECIMAL(15,4),
    change_reason     TEXT,
    effective_at      TIMESTAMPTZ   NOT NULL,
    created_by        INT           NOT NULL REFERENCES users(id),
    applied           BOOLEAN       NOT NULL DEFAULT FALSE,
    applied_at        TIMESTAMPTZ,
    cancelled         BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spc_item      ON scheduled_price_changes(item_id);
CREATE INDEX IF NOT EXISTS idx_spc_store     ON scheduled_price_changes(store_id);
-- Index for the "apply due changes" query run at startup
CREATE INDEX IF NOT EXISTS idx_spc_pending
    ON scheduled_price_changes(effective_at)
    WHERE applied = FALSE AND cancelled = FALSE;
