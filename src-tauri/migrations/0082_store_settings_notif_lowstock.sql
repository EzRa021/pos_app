-- ============================================================================
-- MIGRATION 0082: Store Settings — Notification Prefs + Low Stock Defaults
-- ============================================================================

-- Notification thresholds & toggles (per store)
ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS notif_low_stock_enabled          BOOLEAN      NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notif_low_stock_threshold        INT          NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS notif_overdue_credit_enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notif_overdue_credit_days        INT          NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS notif_shift_end_reminder_enabled BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notif_shift_end_minutes          INT          NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS notif_min_float_warning_enabled  BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notif_min_float_amount           DECIMAL(15,4),
    ADD COLUMN IF NOT EXISTS notif_in_app_enabled             BOOLEAN      NOT NULL DEFAULT TRUE,

    -- Low stock defaults applied to new items
    ADD COLUMN IF NOT EXISTS default_reorder_point            INT          NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS default_reorder_qty              INT          NOT NULL DEFAULT 20;
