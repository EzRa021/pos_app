-- ============================================================================
-- MIGRATION 0075: Auto-stamp business_id on every INSERT via trigger
-- ============================================================================
-- Creates a single reusable trigger function that reads the active business_id
-- from app_config and sets it on any row being inserted where business_id IS NULL.
-- Applied to all 44 operational tables so every future INSERT is covered
-- automatically — no per-handler changes required.
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_stamp_business_id()
RETURNS TRIGGER AS $$
DECLARE
    biz_id UUID;
BEGIN
    IF NEW.business_id IS NULL THEN
        SELECT value::UUID
          INTO biz_id
          FROM app_config
         WHERE key = 'business_id'
         LIMIT 1;

        NEW.business_id := biz_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Apply trigger to every operational table ─────────────────────────────────

DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY[
        'stores', 'users',
        'items', 'item_settings', 'item_stock', 'item_history',
        'departments', 'categories',
        'customers', 'suppliers',
        'transactions', 'transaction_items', 'held_transactions', 'payments',
        'shifts', 'cash_movements', 'cash_drawer_events',
        'purchase_orders', 'purchase_order_items',
        'credit_sales', 'credit_payments',
        'expenses',
        'returns', 'return_items',
        'receipt_settings', 'receipts',
        'stock_count_sessions', 'stock_count_items',
        'reorder_alerts',
        'stock_transfers', 'stock_transfer_items',
        'eod_reports',
        'store_settings',
        'loyalty_settings', 'loyalty_transactions',
        'notifications',
        'supplier_payments',
        'price_lists', 'price_list_items', 'price_changes',
        'price_history', 'scheduled_price_changes',
        'customer_wallet_transactions',
        'label_templates',
        'audit_logs'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        -- Drop first so this migration is idempotent on re-run
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_auto_business_id ON %I',
            tbl
        );
        EXECUTE format(
            'CREATE TRIGGER trg_auto_business_id
             BEFORE INSERT ON %I
             FOR EACH ROW EXECUTE FUNCTION auto_stamp_business_id()',
            tbl
        );
    END LOOP;
END $$;
