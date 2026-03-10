-- ============================================================================
-- MIGRATION 0033: Align Remaining Domains with quantum-pos-app Schema
-- Customers, Suppliers, Purchase Orders, Expenses
-- ============================================================================

-- ============================================================================
-- CUSTOMERS: Add customer_type and credit_enabled
-- ============================================================================
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type VARCHAR(50) DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS credit_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- SUPPLIERS: Add supplier_code, payment_terms, credit_limit, current_balance
-- ============================================================================
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS supplier_code   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS payment_terms   VARCHAR(50) DEFAULT 'Net 30',
  ADD COLUMN IF NOT EXISTS credit_limit    NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_balance NUMERIC(15,4) NOT NULL DEFAULT 0;

-- Generate supplier codes for existing records
UPDATE suppliers
SET supplier_code = 'SUP-' || LPAD(id::text, 4, '0')
WHERE supplier_code IS NULL;

ALTER TABLE suppliers
  ALTER COLUMN supplier_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(supplier_code);

-- ============================================================================
-- PURCHASE ORDERS: Add workflow columns
-- ============================================================================
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS subtotal      NUMERIC(15,4),
  ADD COLUMN IF NOT EXISTS tax_amount    NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by   INT REFERENCES users(id);

-- Backfill subtotal from total_amount for existing records
UPDATE purchase_orders
SET subtotal = total_amount - tax_amount - shipping_cost
WHERE subtotal IS NULL;

-- ============================================================================
-- EXPENSES: Add missing columns to match quantum-pos-app schema
-- ============================================================================
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS expense_type     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reference_type   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reference_id     INT,
  ADD COLUMN IF NOT EXISTS payment_status   VARCHAR(20) NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS is_recurring     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_deductible    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS approval_status  VARCHAR(20) NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by       INT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ;

-- Migrate existing data: category → expense_type, status → approval_status
UPDATE expenses
SET expense_type = category
WHERE expense_type IS NULL;

UPDATE expenses
SET approval_status = CASE
  WHEN status = 'approved' THEN 'approved'
  WHEN status = 'rejected' THEN 'rejected'
  ELSE 'pending'
END
WHERE approval_status = 'approved' AND status != 'approved';

-- Set approved_at for already-approved expenses
UPDATE expenses
SET approved_at = created_at
WHERE approval_status = 'approved' AND approved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_approval_status ON expenses(approval_status);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_type    ON expenses(expense_type);
