-- ============================================================================
-- MIGRATION 0055: Add business_id to ALL operational tables
-- ============================================================================
-- Every table that holds business data gets a nullable business_id FK.
-- Nullable so existing rows survive before the backfill in 0056.
-- An index is created for every FK column.
--
-- Tables intentionally excluded (system / auth — not business-scoped):
--   roles, permissions, role_permissions
--   user_sessions, active_sessions
--   login_history, security_events, password_reset_tokens
--   tax_categories, exchange_rates
-- ============================================================================

-- ── STORES & USERS ───────────────────────────────────────────────────────────
ALTER TABLE stores              ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE users               ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── ITEMS (table + child tables) ─────────────────────────────────────────────
ALTER TABLE items               ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE item_settings       ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE item_stock          ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE item_history        ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── DEPARTMENTS & CATEGORIES ─────────────────────────────────────────────────
ALTER TABLE departments         ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE categories          ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── CUSTOMERS & SUPPLIERS ────────────────────────────────────────────────────
ALTER TABLE customers           ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE suppliers           ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── TRANSACTIONS (table + child tables) ─────────────────────────────────────
ALTER TABLE transactions        ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE transaction_items   ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE held_transactions   ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE payments            ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── SHIFTS ───────────────────────────────────────────────────────────────────
ALTER TABLE shifts              ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE cash_movements      ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE cash_drawer_events  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── PURCHASE ORDERS (table + items) ─────────────────────────────────────────
ALTER TABLE purchase_orders      ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── CREDIT SALES & PAYMENTS ──────────────────────────────────────────────────
ALTER TABLE credit_sales         ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE credit_payments      ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── EXPENSES ─────────────────────────────────────────────────────────────────
ALTER TABLE expenses             ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── RETURNS (table + items) ──────────────────────────────────────────────────
ALTER TABLE returns              ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE return_items         ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── RECEIPTS ─────────────────────────────────────────────────────────────────
ALTER TABLE receipt_settings     ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE receipts             ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── STOCK COUNTS (sessions + items) ─────────────────────────────────────────
ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE stock_count_items    ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── REORDER ALERTS ───────────────────────────────────────────────────────────
ALTER TABLE reorder_alerts       ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── STOCK TRANSFERS (table + items) ─────────────────────────────────────────
ALTER TABLE stock_transfers      ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE stock_transfer_items ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── END-OF-DAY REPORTS ───────────────────────────────────────────────────────
ALTER TABLE eod_reports          ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── STORE SETTINGS ───────────────────────────────────────────────────────────
ALTER TABLE store_settings       ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── LOYALTY ──────────────────────────────────────────────────────────────────
ALTER TABLE loyalty_settings     ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE loyalty_transactions  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── NOTIFICATIONS ────────────────────────────────────────────────────────────
ALTER TABLE notifications        ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── SUPPLIER PAYMENTS ────────────────────────────────────────────────────────
ALTER TABLE supplier_payments    ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── PRICE MANAGEMENT ─────────────────────────────────────────────────────────
ALTER TABLE price_lists          ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE price_list_items     ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE price_changes        ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE price_history        ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE scheduled_price_changes ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── CUSTOMER WALLET ──────────────────────────────────────────────────────────
ALTER TABLE customer_wallet_transactions ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── LABEL TEMPLATES ──────────────────────────────────────────────────────────
ALTER TABLE label_templates      ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- ── AUDIT LOG ────────────────────────────────────────────────────────────────
-- audit_logs already has store_id (added in 0042); adding business_id for direct tenant filtering
ALTER TABLE audit_logs           ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;


-- ============================================================================
-- INDEXES
-- ============================================================================
-- One index per business_id column. Critical for filtered queries and
-- future replication row-filter performance.

CREATE INDEX IF NOT EXISTS idx_stores_business_id               ON stores(business_id);
CREATE INDEX IF NOT EXISTS idx_users_business_id                ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_items_business_id                ON items(business_id);
CREATE INDEX IF NOT EXISTS idx_item_settings_business_id        ON item_settings(business_id);
CREATE INDEX IF NOT EXISTS idx_item_stock_business_id           ON item_stock(business_id);
CREATE INDEX IF NOT EXISTS idx_item_history_business_id         ON item_history(business_id);
CREATE INDEX IF NOT EXISTS idx_departments_business_id          ON departments(business_id);
CREATE INDEX IF NOT EXISTS idx_categories_business_id           ON categories(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_business_id            ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_business_id            ON suppliers(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_business_id         ON transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_business_id    ON transaction_items(business_id);
CREATE INDEX IF NOT EXISTS idx_held_transactions_business_id    ON held_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_payments_business_id             ON payments(business_id);
CREATE INDEX IF NOT EXISTS idx_shifts_business_id               ON shifts(business_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_business_id       ON cash_movements(business_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_events_business_id   ON cash_drawer_events(business_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_business_id      ON purchase_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_business_id ON purchase_order_items(business_id);
CREATE INDEX IF NOT EXISTS idx_credit_sales_business_id         ON credit_sales(business_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_business_id      ON credit_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_business_id             ON expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_returns_business_id              ON returns(business_id);
CREATE INDEX IF NOT EXISTS idx_return_items_business_id         ON return_items(business_id);
CREATE INDEX IF NOT EXISTS idx_receipt_settings_business_id     ON receipt_settings(business_id);
CREATE INDEX IF NOT EXISTS idx_receipts_business_id             ON receipts(business_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_sessions_business_id ON stock_count_sessions(business_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_business_id    ON stock_count_items(business_id);
CREATE INDEX IF NOT EXISTS idx_reorder_alerts_business_id       ON reorder_alerts(business_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_business_id      ON stock_transfers(business_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_business_id ON stock_transfer_items(business_id);
CREATE INDEX IF NOT EXISTS idx_eod_reports_business_id          ON eod_reports(business_id);
CREATE INDEX IF NOT EXISTS idx_store_settings_business_id       ON store_settings(business_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_settings_business_id     ON loyalty_settings(business_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_business_id ON loyalty_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_notifications_business_id        ON notifications(business_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_business_id    ON supplier_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_price_lists_business_id          ON price_lists(business_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_business_id     ON price_list_items(business_id);
CREATE INDEX IF NOT EXISTS idx_price_changes_business_id        ON price_changes(business_id);
CREATE INDEX IF NOT EXISTS idx_price_history_business_id        ON price_history(business_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_price_changes_biz_id   ON scheduled_price_changes(business_id);
CREATE INDEX IF NOT EXISTS idx_customer_wallet_txns_business_id ON customer_wallet_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_label_templates_business_id      ON label_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_id           ON audit_logs(business_id);
