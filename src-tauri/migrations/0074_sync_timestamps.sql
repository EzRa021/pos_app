-- ============================================================================
-- MIGRATION 0074: Add unified sync timestamps to all sync-allowlisted tables
-- ============================================================================
-- Every table in the bidirectional sync allowlist needs both created_at and
-- updated_at so the pull worker can use COALESCE(updated_at, created_at) > cursor.
-- ============================================================================

-- ── transaction_items ────────────────────────────────────────────────────────
ALTER TABLE transaction_items
    ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── item_stock ───────────────────────────────────────────────────────────────
-- already has updated_at; add created_at
ALTER TABLE item_stock
    ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── shifts ───────────────────────────────────────────────────────────────────
ALTER TABLE shifts
    ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── transactions ─────────────────────────────────────────────────────────────
-- already has created_at; add updated_at
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── payments ─────────────────────────────────────────────────────────────────
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── returns ──────────────────────────────────────────────────────────────────
ALTER TABLE returns
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── return_items ─────────────────────────────────────────────────────────────
ALTER TABLE return_items
    ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── purchase_orders ───────────────────────────────────────────────────────────
ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── purchase_order_items ──────────────────────────────────────────────────────
ALTER TABLE purchase_order_items
    ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── cash_movements ────────────────────────────────────────────────────────────
ALTER TABLE cash_movements
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── reorder_alerts ────────────────────────────────────────────────────────────
ALTER TABLE reorder_alerts
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── notifications ─────────────────────────────────────────────────────────────
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── expenses ──────────────────────────────────────────────────────────────────
ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();
