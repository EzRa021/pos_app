-- ============================================================================
-- MIGRATION 0056: Backfill business_id for pre-existing data
-- ============================================================================
-- For installations that had data before onboarding was added (migration 0054).
-- Creates one default business and assigns every orphaned row to it.
-- Also seeds app_config so the onboarding gate is skipped on next launch.
--
-- Safe to re-run: the entire block is guarded by an early-exit check.
-- ============================================================================

DO $$
DECLARE
    default_biz_id UUID;
BEGIN
    -- Guard 1: if app_config already has a business_id, onboarding already ran.
    -- Do nothing — this block must never overwrite a real business.
    IF EXISTS (SELECT 1 FROM app_config WHERE key = 'business_id') THEN
        RAISE NOTICE 'business_id already set in app_config — skipping backfill.';
        RETURN;
    END IF;

    -- Guard 2: only backfill if there is real operational data that predates
    -- the business_id feature. If the DB is brand-new (no items, no transactions,
    -- no customers) then onboarding must be shown — don't mark it complete.
    --
    -- The seeded "Main Store" row from migration 0002 does NOT count as
    -- "existing data" — we specifically exclude the default store seed.
    IF NOT EXISTS (SELECT 1 FROM items       LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM transactions LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM customers   LIMIT 1) THEN
        RAISE NOTICE 'Fresh database — no operational data found. Skipping backfill; onboarding is required.';
        RETURN;
    END IF;

    default_biz_id := gen_random_uuid();

    INSERT INTO businesses (id, name, type, currency, timezone)
    VALUES (default_biz_id, 'My Business', 'retail', 'NGN', 'Africa/Lagos')
    ON CONFLICT DO NOTHING;

    -- ── STORES & USERS ───────────────────────────────────────────────────────
    UPDATE stores           SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE users            SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── ITEMS ────────────────────────────────────────────────────────────────
    UPDATE items            SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE item_settings    SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE item_stock       SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE item_history     SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── DEPARTMENTS & CATEGORIES ─────────────────────────────────────────────
    UPDATE departments      SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE categories       SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── CUSTOMERS & SUPPLIERS ────────────────────────────────────────────────
    UPDATE customers        SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE suppliers        SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── TRANSACTIONS ─────────────────────────────────────────────────────────
    UPDATE transactions        SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE transaction_items   SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE held_transactions   SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE payments            SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── SHIFTS & CASH ────────────────────────────────────────────────────────
    UPDATE shifts              SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE cash_movements      SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE cash_drawer_events  SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── PURCHASE ORDERS ──────────────────────────────────────────────────────
    UPDATE purchase_orders      SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE purchase_order_items SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── CREDIT SALES ─────────────────────────────────────────────────────────
    UPDATE credit_sales         SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE credit_payments      SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── EXPENSES ─────────────────────────────────────────────────────────────
    UPDATE expenses             SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── RETURNS ──────────────────────────────────────────────────────────────
    UPDATE returns              SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE return_items         SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── RECEIPTS ─────────────────────────────────────────────────────────────
    UPDATE receipt_settings     SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE receipts             SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── STOCK COUNTS ─────────────────────────────────────────────────────────
    UPDATE stock_count_sessions SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE stock_count_items    SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── REORDER ALERTS ───────────────────────────────────────────────────────
    UPDATE reorder_alerts       SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── STOCK TRANSFERS ──────────────────────────────────────────────────────
    UPDATE stock_transfers      SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE stock_transfer_items SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── EOD REPORTS ──────────────────────────────────────────────────────────
    UPDATE eod_reports          SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── STORE SETTINGS ───────────────────────────────────────────────────────
    UPDATE store_settings       SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── LOYALTY ──────────────────────────────────────────────────────────────
    UPDATE loyalty_settings      SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE loyalty_transactions  SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── NOTIFICATIONS ────────────────────────────────────────────────────────
    UPDATE notifications         SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── SUPPLIER PAYMENTS ────────────────────────────────────────────────────
    UPDATE supplier_payments     SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── PRICE MANAGEMENT ─────────────────────────────────────────────────────
    UPDATE price_lists           SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE price_list_items      SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE price_changes         SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE price_history         SET business_id = default_biz_id WHERE business_id IS NULL;
    UPDATE scheduled_price_changes SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── CUSTOMER WALLET ──────────────────────────────────────────────────────
    UPDATE customer_wallet_transactions SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── LABEL TEMPLATES ──────────────────────────────────────────────────────
    UPDATE label_templates       SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── AUDIT LOGS ───────────────────────────────────────────────────────────
    UPDATE audit_logs            SET business_id = default_biz_id WHERE business_id IS NULL;

    -- ── SEED app_config ──────────────────────────────────────────────────────
    INSERT INTO app_config (key, value)
    VALUES
        ('business_id',         default_biz_id::text),
        ('onboarding_complete', 'true')
    ON CONFLICT DO NOTHING;

    -- ── Record the event ─────────────────────────────────────────────────────
    INSERT INTO sync_log (business_id, event_type, message)
    VALUES (default_biz_id, 'backfill', 'Auto-backfill via migration 0056');

    RAISE NOTICE 'Backfill complete. Default business_id = %', default_biz_id;
END $$;
