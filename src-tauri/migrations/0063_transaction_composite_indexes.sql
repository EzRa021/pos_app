-- Composite indexes for efficient server-side transaction filtering.
-- These replace the need to consult multiple single-column indexes and allow
-- PostgreSQL to satisfy WHERE + ORDER BY from a single index scan at scale.

-- Primary filter path: store + status + newest-first ordering
CREATE INDEX IF NOT EXISTS idx_tx_store_status_created
    ON transactions(store_id, status, created_at DESC);

-- Date-range filter path: store + date window
CREATE INDEX IF NOT EXISTS idx_tx_store_created
    ON transactions(store_id, created_at DESC);

-- Cashier filter path
CREATE INDEX IF NOT EXISTS idx_tx_store_cashier_created
    ON transactions(store_id, cashier_id, created_at DESC);
