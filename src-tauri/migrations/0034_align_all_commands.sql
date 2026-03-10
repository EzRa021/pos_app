-- ============================================================================
-- MIGRATION 0034: Indexes & Fixes for All Aligned Commands
-- ============================================================================
-- Covers every query pattern introduced by the Rust command alignment:
--   expenses, credit_sales, returns, users, price_management, analytics.
-- All statements are idempotent (IF NOT EXISTS / DO guards). Safe to re-run.
-- ============================================================================

-- ============================================================================
-- 1. EXPENSES — fix updated_at default & add missing indexes
-- ============================================================================

-- 0033 added updated_at WITHOUT a default; backfill and set one so new inserts
-- (e.g. create_expense, update_expense) never leave it NULL.
UPDATE expenses SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE expenses ALTER COLUMN updated_at SET DEFAULT NOW();

-- payment_status filter (used by get_expenses, get_expense_summary)
CREATE INDEX IF NOT EXISTS idx_expenses_payment_status
    ON expenses(payment_status);

-- Partial index for active (non-deleted) expenses — speeds up all list queries
-- that filter by deleted_at IS NULL, which every expense query does.
CREATE INDEX IF NOT EXISTS idx_expenses_active_store_date
    ON expenses(store_id, expense_date DESC)
    WHERE deleted_at IS NULL;

-- ============================================================================
-- 2. CREDIT SALES — indexes for new command query patterns
-- ============================================================================

-- due_date index: used by get_overdue_sales (WHERE due_date < NOW())
CREATE INDEX IF NOT EXISTS idx_cs_due_date
    ON credit_sales(due_date)
    WHERE status NOT IN ('paid', 'cancelled');

-- customer + status composite: used by get_outstanding_balances & get_credit_summary
CREATE INDEX IF NOT EXISTS idx_cs_customer_status
    ON credit_sales(customer_id, status);

-- store + status: used by get_credit_summary filter
CREATE INDEX IF NOT EXISTS idx_cs_store_status
    ON credit_sales(store_id, status);

-- ============================================================================
-- 3. CUSTOMERS — indexes for outstanding balance & credit queries
-- ============================================================================

-- Partial index for customers with an outstanding balance (get_outstanding_balances)
CREATE INDEX IF NOT EXISTS idx_customers_outstanding
    ON customers(outstanding_balance)
    WHERE outstanding_balance > 0;

-- ============================================================================
-- 4. RETURNS — index for new return_type filter
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_returns_return_type
    ON returns(return_type);

-- Composite index: store + date (common list view ordering)
CREATE INDEX IF NOT EXISTS idx_returns_store_date
    ON returns(store_id, created_at DESC);

-- ============================================================================
-- 5. USERS — expression indexes for ILIKE search (search_users)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_username_lower
    ON users(lower(username));

CREATE INDEX IF NOT EXISTS idx_users_email_lower
    ON users(lower(email));

-- ============================================================================
-- 6. PRICE HISTORY — composite index for item + store queries (get_price_history)
-- ============================================================================

-- Replaces the single-column idx_ph_item with a covering composite index.
CREATE INDEX IF NOT EXISTS idx_ph_item_store_date
    ON price_history(item_id, store_id, created_at DESC);

-- ============================================================================
-- 7. PRICE CHANGES — composite index for store + status queries
-- ============================================================================

-- get_price_changes filters by store_id + status; the existing idx_pc_status is
-- single-column. A composite index avoids extra heap fetches on filtered lists.
CREATE INDEX IF NOT EXISTS idx_pc_store_status
    ON price_changes(store_id, status, created_at DESC);

-- ============================================================================
-- 8. ANALYTICS — helper indexes for period-based aggregation queries
-- ============================================================================

-- Daily/period analytics join transaction_items → items → item_settings
-- The existing idx_ti_tx (on transaction_items.tx_id) is present; add item_id.
CREATE INDEX IF NOT EXISTS idx_ti_item_id
    ON transaction_items(item_id);

-- Transactions filtered by store + date for summary/period queries
CREATE INDEX IF NOT EXISTS idx_tx_store_created
    ON transactions(store_id, created_at DESC)
    WHERE status NOT IN ('voided', 'cancelled');

-- ============================================================================
-- 9. SUPPLIERS — index on supplier_code for search commands
-- ============================================================================

-- 0033 already adds a UNIQUE index on supplier_code; this is a safety guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code_unique
    ON suppliers(supplier_code)
    WHERE supplier_code IS NOT NULL;

-- ============================================================================
-- 10. PURCHASE ORDERS — index on approved_by (added in 0033)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_po_approved_by
    ON purchase_orders(approved_by)
    WHERE approved_by IS NOT NULL;

-- ============================================================================
-- 11. PAYMENTS — store-level summary queries (get_payment_summary)
-- ============================================================================

-- Payments don't have a store_id column directly; they join through transactions.
-- Add a covering index on payment_method + created_at for the summary aggregation.
CREATE INDEX IF NOT EXISTS idx_payments_method_date
    ON payments(payment_method, created_at DESC);
