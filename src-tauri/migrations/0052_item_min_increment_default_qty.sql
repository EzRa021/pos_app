-- ============================================================================
-- MIGRATION 0052: Add min_increment and default_qty to item_settings
-- ============================================================================
-- min_increment: smallest allowed quantity step for this item.
--   quantity items      → system default = 1        (1 piece at a time)
--   weight/volume/length → system default = 0.001   (e.g. 0.001 kg)
--
-- default_qty: quantity pre-filled when cashier adds this item in the
--   POS cart, restock dialog, returns stepper, or stock count entry.
--   quantity items      → system default = 1
--   weight/volume/length → system default = 1.000
--
-- Both columns are nullable — NULL means "use system default for
-- measurement_type"; callers treat NULL as "not overridden".
-- ============================================================================

ALTER TABLE item_settings
    ADD COLUMN IF NOT EXISTS min_increment NUMERIC(10, 6),
    ADD COLUMN IF NOT EXISTS default_qty   NUMERIC(20, 6);

COMMENT ON COLUMN item_settings.min_increment IS
    'Minimum allowed quantity step. NULL = system default (1 for qty, 0.001 for weight/volume/length)';

COMMENT ON COLUMN item_settings.default_qty IS
    'Default quantity when item is added to POS cart or inventory dialogs. NULL = system default.';
