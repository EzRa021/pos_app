-- ============================================================================
-- MIGRATION 0084: POS Shortcuts
-- Up to 12 pinned items per store shown as large quick-access buttons on POS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pos_shortcuts (
    id         SERIAL    PRIMARY KEY,
    store_id   INT       NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    item_id    UUID      NOT NULL REFERENCES items(id)  ON DELETE CASCADE,
    position   SMALLINT  NOT NULL DEFAULT 0,   -- 0-based slot (0–11)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, item_id),
    UNIQUE (store_id, position)
);

CREATE INDEX IF NOT EXISTS idx_pos_shortcuts_store ON pos_shortcuts(store_id);
