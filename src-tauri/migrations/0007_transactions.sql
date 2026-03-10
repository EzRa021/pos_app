-- ============================================================================
-- MIGRATION 0007: Transactions, Transaction Items & Held Transactions
-- ============================================================================
-- Updated to align with quantum-pos-app transaction service:
--   • offline_sale / client_uuid  — offline/PWA deduplication
--   • cancelled_at / cancelled_by — void audit trail
--   • payment_status              — tracks paid / pending / refunded / partial_refund
--   • net_amount on items         — VAT breakdown (inclusive pricing, Nigeria standard)
-- All ALTER TABLE statements are idempotent: safe to run on an existing database.
-- ============================================================================

-- Sequence for generating unique reference numbers
CREATE SEQUENCE IF NOT EXISTS transaction_ref_seq START 1;

-- ── transactions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id              SERIAL        PRIMARY KEY,
    reference_no    VARCHAR(50)   NOT NULL UNIQUE,
    store_id        INT           NOT NULL REFERENCES stores(id),
    cashier_id      INT           NOT NULL REFERENCES users(id),
    customer_id     INT           REFERENCES customers(id) ON DELETE SET NULL,

    -- Totals (backend-calculated; never trust frontend values)
    subtotal        NUMERIC(15,4) NOT NULL DEFAULT 0,  -- sum of net line amounts (ex-VAT)
    discount_amount NUMERIC(15,4) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,  -- inclusive VAT total
    total_amount    NUMERIC(15,4) NOT NULL DEFAULT 0,  -- subtotal + tax - discount

    -- Payment
    amount_tendered NUMERIC(15,4),
    change_amount   NUMERIC(15,4),
    payment_method  VARCHAR(50)   NOT NULL DEFAULT 'cash',
    -- paid | pending (credit) | refunded | partial_refund
    payment_status  VARCHAR(30)   NOT NULL DEFAULT 'paid',
    -- completed | voided | refunded
    status          VARCHAR(30)   NOT NULL DEFAULT 'completed',

    notes           TEXT,

    -- Offline / PWA support
    offline_sale    BOOLEAN       NOT NULL DEFAULT FALSE,
    client_uuid     TEXT          UNIQUE,               -- client-generated UUID for dedup

    -- Void / cancel audit trail
    cancelled_at    TIMESTAMPTZ,
    cancelled_by    INT           REFERENCES users(id) ON DELETE SET NULL,

    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Idempotent additions for existing databases
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'paid';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS offline_sale   BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_uuid    TEXT        UNIQUE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cancelled_by   INT         REFERENCES users(id) ON DELETE SET NULL;

-- Backfill: populate payment_status from existing status values
UPDATE transactions
SET payment_status = CASE
    WHEN status = 'voided'   THEN 'refunded'
    WHEN status = 'refunded' THEN 'refunded'
    ELSE 'paid'
END
WHERE payment_status = 'paid' AND status != 'completed';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tx_store        ON transactions(store_id);
CREATE INDEX IF NOT EXISTS idx_tx_cashier      ON transactions(cashier_id);
CREATE INDEX IF NOT EXISTS idx_tx_customer     ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_tx_created      ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_reference    ON transactions(reference_no);
CREATE INDEX IF NOT EXISTS idx_tx_status       ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_client_uuid  ON transactions(client_uuid) WHERE client_uuid IS NOT NULL;

-- ── transaction_items ─────────────────────────────────────────────────────────
-- line_total = unit_price × quantity (gross, inclusive of VAT)
-- tax_amount = inclusive VAT portion of line_total
-- net_amount = line_total - tax_amount (amount ex-VAT)
CREATE TABLE IF NOT EXISTS transaction_items (
    id         SERIAL        PRIMARY KEY,
    tx_id      INT           NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    item_id    UUID          NOT NULL REFERENCES items(id),
    item_name  VARCHAR(255)  NOT NULL,
    sku        VARCHAR(100)  NOT NULL,
    quantity   NUMERIC(20,6) NOT NULL,
    unit_price NUMERIC(15,4) NOT NULL,  -- DB-authoritative price (inclusive of VAT)
    discount   NUMERIC(15,4) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(15,4) NOT NULL DEFAULT 0,  -- VAT portion (inclusive)
    net_amount NUMERIC(15,4) NOT NULL DEFAULT 0,  -- line_total - tax_amount
    line_total NUMERIC(15,4) NOT NULL              -- gross = unit_price × quantity
);

-- Idempotent addition for existing databases
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,4) NOT NULL DEFAULT 0;

-- Backfill net_amount for any existing rows that have it as 0
UPDATE transaction_items
SET net_amount = line_total - tax_amount
WHERE net_amount = 0 AND line_total > 0;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tx_items_tx   ON transaction_items(tx_id);
CREATE INDEX IF NOT EXISTS idx_tx_items_item ON transaction_items(item_id);

-- ── held_transactions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS held_transactions (
    id         SERIAL       PRIMARY KEY,
    store_id   INT          NOT NULL REFERENCES stores(id),
    cashier_id INT          NOT NULL REFERENCES users(id),
    label      VARCHAR(200),
    cart_data  JSONB        NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_held_tx_cashier ON held_transactions(cashier_id);
CREATE INDEX IF NOT EXISTS idx_held_tx_store   ON held_transactions(store_id);
