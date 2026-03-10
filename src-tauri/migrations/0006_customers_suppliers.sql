-- ============================================================================
-- MIGRATION 0006: Customers & Suppliers
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
    id                  SERIAL PRIMARY KEY,
    store_id            INT          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    first_name          VARCHAR(100) NOT NULL,
    last_name           VARCHAR(100) NOT NULL,
    email               VARCHAR(255),
    phone               VARCHAR(50),
    address             TEXT,
    city                VARCHAR(100),
    loyalty_points      INT          NOT NULL DEFAULT 0,
    credit_limit        NUMERIC(15,4) NOT NULL DEFAULT 0,
    outstanding_balance NUMERIC(15,4) NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

CREATE TABLE IF NOT EXISTS suppliers (
    id            SERIAL PRIMARY KEY,
    store_id      INT          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    supplier_name VARCHAR(200) NOT NULL,
    contact_name  VARCHAR(200),
    email         VARCHAR(255),
    phone         VARCHAR(50),
    address       TEXT,
    city          VARCHAR(100),
    tax_id        VARCHAR(100),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_store ON suppliers(store_id);
