-- ============================================================================
-- MIGRATION 0085: Add suffix column to number_series
-- Enables the TNX-0001-STORE format: {prefix}{padded_n}-{suffix}
-- suffix is auto-derived from store_code / store_name and is configurable.
-- ============================================================================

ALTER TABLE number_series
    ADD COLUMN IF NOT EXISTS suffix VARCHAR(20) NOT NULL DEFAULT '';

-- Backfill suffix for all existing rows from store_code (preferred) or store_name.
-- Logic mirrors store_txn_slug() in Rust:
--   store_code (≤4 alphanumeric chars)  OR  first 3 alphanumeric chars of store_name
UPDATE number_series ns
SET suffix = (
    SELECT
        CASE
            WHEN s.store_code IS NOT NULL
             AND LENGTH(TRIM(s.store_code)) > 0
            THEN UPPER(SUBSTRING(
                    REGEXP_REPLACE(TRIM(s.store_code), '[^A-Za-z0-9]', '', 'g'),
                    1, 4
                ))
            ELSE UPPER(SUBSTRING(
                    REGEXP_REPLACE(TRIM(s.store_name), '[^A-Za-z0-9]', '', 'g'),
                    1, 3
                ))
        END
    FROM stores s
    WHERE s.id = ns.store_id
)
WHERE suffix = '';

-- Update the invoice default prefix from INV- to TNX- and pad from 5 to 4
-- for stores that are still using the original out-of-box defaults.
-- Stores that already customised their prefix are left untouched.
UPDATE number_series
SET prefix = 'TNX-', pad_length = 4
WHERE doc_type = 'invoice'
  AND prefix   = 'INV-'
  AND pad_length = 5;
