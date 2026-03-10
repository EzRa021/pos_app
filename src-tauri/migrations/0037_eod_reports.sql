-- ============================================================================
-- MIGRATION 0037: End-of-Day Reports
-- ============================================================================
-- Immutable daily snapshot per store. Once locked, the row is read-only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS eod_reports (
    id                  SERIAL PRIMARY KEY,
    store_id            INT           NOT NULL REFERENCES stores(id),
    report_date         DATE          NOT NULL,
    -- Sales
    gross_sales         DECIMAL(15,4) NOT NULL DEFAULT 0,
    total_discounts     DECIMAL(15,4) NOT NULL DEFAULT 0,
    net_sales           DECIMAL(15,4) NOT NULL DEFAULT 0,
    total_tax           DECIMAL(15,4) NOT NULL DEFAULT 0,
    -- Cost & Profit
    cost_of_goods_sold  DECIMAL(15,4) NOT NULL DEFAULT 0,
    gross_profit        DECIMAL(15,4) NOT NULL DEFAULT 0,
    total_expenses      DECIMAL(15,4) NOT NULL DEFAULT 0,
    net_profit          DECIMAL(15,4) NOT NULL DEFAULT 0,
    -- Payment breakdown
    cash_collected      DECIMAL(15,4) NOT NULL DEFAULT 0,
    card_collected      DECIMAL(15,4) NOT NULL DEFAULT 0,
    transfer_collected  DECIMAL(15,4) NOT NULL DEFAULT 0,
    credit_issued       DECIMAL(15,4) NOT NULL DEFAULT 0,
    credit_collected    DECIMAL(15,4) NOT NULL DEFAULT 0,
    -- Volume
    items_sold          DECIMAL(15,4) NOT NULL DEFAULT 0,
    transactions_count  INT           NOT NULL DEFAULT 0,
    voids_count         INT           NOT NULL DEFAULT 0,
    voids_amount        DECIMAL(15,4) NOT NULL DEFAULT 0,
    refunds_count       INT           NOT NULL DEFAULT 0,
    refunds_amount      DECIMAL(15,4) NOT NULL DEFAULT 0,
    -- Shift cash
    opening_float       DECIMAL(15,4),
    closing_cash        DECIMAL(15,4),
    cash_difference     DECIMAL(15,4),
    -- Meta
    generated_by        INT           REFERENCES users(id),
    generated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    is_locked           BOOLEAN       NOT NULL DEFAULT FALSE,
    UNIQUE(store_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_eod_store_date ON eod_reports(store_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_eod_locked     ON eod_reports(is_locked) WHERE is_locked = FALSE;
