-- Add tax_inclusive flag to store_settings.
-- TRUE  (default) = prices already include VAT; tax is extracted for display only.
-- FALSE           = prices exclude VAT; tax is added on top at checkout.
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN NOT NULL DEFAULT TRUE;
