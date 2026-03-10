-- ============================================================================
-- MIGRATION 0020: Price Management
-- ============================================================================

CREATE TABLE IF NOT EXISTS price_lists (
    id          SERIAL PRIMARY KEY,
    store_id    INT          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    list_name   VARCHAR(150) NOT NULL,
    list_type   VARCHAR(30)  NOT NULL DEFAULT 'standard',  -- standard | wholesale | retail | promotional | custom
    description TEXT,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, list_name)
);

CREATE TABLE IF NOT EXISTS price_list_items (
    id             SERIAL PRIMARY KEY,
    price_list_id  INT           NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    item_id        UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    price          NUMERIC(15,4) NOT NULL,
    effective_from TIMESTAMPTZ,
    effective_to   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (price_list_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_pli_list ON price_list_items(price_list_id);
CREATE INDEX IF NOT EXISTS idx_pli_item ON price_list_items(item_id);

CREATE TABLE IF NOT EXISTS price_changes (
    id           SERIAL PRIMARY KEY,
    store_id     INT           NOT NULL REFERENCES stores(id),
    item_id      UUID          NOT NULL REFERENCES items(id),
    change_type  VARCHAR(30)   NOT NULL DEFAULT 'manual',  -- manual | bulk | scheduled
    old_price    NUMERIC(15,4) NOT NULL,
    new_price    NUMERIC(15,4) NOT NULL,
    effective_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    reason       TEXT,
    status       VARCHAR(20)   NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | applied
    requested_by INT           NOT NULL REFERENCES users(id),
    approved_by  INT           REFERENCES users(id),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pc_store  ON price_changes(store_id);
CREATE INDEX IF NOT EXISTS idx_pc_item   ON price_changes(item_id);
CREATE INDEX IF NOT EXISTS idx_pc_status ON price_changes(status);

CREATE TABLE IF NOT EXISTS price_history (
    id         SERIAL PRIMARY KEY,
    item_id    UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    store_id   INT           NOT NULL,
    old_price  NUMERIC(15,4),
    new_price  NUMERIC(15,4) NOT NULL,
    changed_by INT           REFERENCES users(id),
    reason     TEXT,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ph_item ON price_history(item_id);
