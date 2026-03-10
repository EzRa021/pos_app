-- ============================================================================
-- MIGRATION 0038: Store Settings / Business Rules
-- ============================================================================
-- One row per store. Enforced by commands in create_transaction, open_shift, etc.
-- ============================================================================

CREATE TABLE IF NOT EXISTS store_settings (
    store_id                            INT           PRIMARY KEY REFERENCES stores(id),
    -- Pricing rules
    allow_price_override                BOOLEAN       NOT NULL DEFAULT TRUE,
    max_discount_percent                DECIMAL(5,2)  NOT NULL DEFAULT 100,
    require_discount_reason             BOOLEAN       NOT NULL DEFAULT FALSE,
    warn_sell_below_cost                BOOLEAN       NOT NULL DEFAULT TRUE,
    allow_sell_below_cost               BOOLEAN       NOT NULL DEFAULT FALSE,
    -- Transaction rules
    require_customer_above_amount       DECIMAL(15,4),
    void_same_day_only                  BOOLEAN       NOT NULL DEFAULT FALSE,
    max_void_amount                     DECIMAL(15,4),
    require_manager_approval_void_above DECIMAL(15,4),
    -- Receipt
    receipt_header_text                 TEXT,
    receipt_footer_text                 TEXT,
    show_vat_on_receipt                 BOOLEAN       NOT NULL DEFAULT TRUE,
    show_cashier_on_receipt             BOOLEAN       NOT NULL DEFAULT TRUE,
    receipt_copies                      INT           NOT NULL DEFAULT 1,
    -- Stock
    auto_create_po_on_reorder           BOOLEAN       NOT NULL DEFAULT FALSE,
    -- Shift / cash
    opening_float_required              BOOLEAN       NOT NULL DEFAULT FALSE,
    min_opening_float                   DECIMAL(15,4),
    -- Credit
    max_credit_days                     INT           NOT NULL DEFAULT 30,
    auto_flag_overdue_after_days        INT           NOT NULL DEFAULT 7,
    -- Timestamps
    created_at                          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Seed a default row for every existing store so commands can always find a row
INSERT INTO store_settings (store_id)
SELECT id FROM stores
WHERE NOT EXISTS (SELECT 1 FROM store_settings ss WHERE ss.store_id = stores.id)
ON CONFLICT DO NOTHING;
