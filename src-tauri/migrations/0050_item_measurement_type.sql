-- ============================================================================
-- MIGRATION 0050: Add measurement_type to item_settings
-- ============================================================================
-- Adds a structured measurement type column to distinguish items sold by
-- quantity (pieces/packs) from items sold by weight (kg/g), volume (L/ml),
-- or length (m/cm).
--
-- Valid values: 'quantity' | 'weight' | 'volume' | 'length'
-- Default: 'quantity'  — safe for all existing items.
-- ============================================================================

ALTER TABLE item_settings
    ADD COLUMN IF NOT EXISTS measurement_type VARCHAR(20) NOT NULL DEFAULT 'quantity';

-- Back-fill from existing unit_type where it clearly implies a measurement type
UPDATE item_settings
SET measurement_type = 'weight'
WHERE measurement_type = 'quantity'
  AND LOWER(unit_type) IN ('kg', 'g', 'gram', 'grams', 'kilogram', 'kilograms', 'lb', 'lbs', 'oz', 'ounce');

UPDATE item_settings
SET measurement_type = 'volume'
WHERE measurement_type = 'quantity'
  AND LOWER(unit_type) IN ('litre', 'liter', 'litres', 'liters', 'l', 'ml', 'millilitre', 'milliliter', 'cl');

UPDATE item_settings
SET measurement_type = 'length'
WHERE measurement_type = 'quantity'
  AND LOWER(unit_type) IN ('m', 'cm', 'mm', 'metre', 'meter', 'metres', 'meters');

-- CHECK constraint to enforce valid values
ALTER TABLE item_settings
    DROP CONSTRAINT IF EXISTS chk_measurement_type;

ALTER TABLE item_settings
    ADD CONSTRAINT chk_measurement_type
    CHECK (measurement_type IN ('quantity', 'weight', 'volume', 'length'));

CREATE INDEX IF NOT EXISTS idx_item_settings_measurement_type
    ON item_settings(measurement_type);

COMMENT ON COLUMN item_settings.measurement_type IS
    'How this item is measured: quantity=pieces/packs, weight=kg/g/lb, volume=L/ml, length=m/cm';
