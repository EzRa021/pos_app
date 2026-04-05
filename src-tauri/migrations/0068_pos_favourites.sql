-- ============================================================================
-- MIGRATION 0068: POS Favourites (quick-access items per store)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pos_favourites (
    id         SERIAL      PRIMARY KEY,
    store_id   INT         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    item_id    UUID        NOT NULL REFERENCES items(id)  ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(store_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_favourites_store ON pos_favourites(store_id);
