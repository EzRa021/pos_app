-- ============================================================================
-- MIGRATION 0077: Seed per-store ITEM reference counters
-- ============================================================================
-- Adds 'ITEM' as a ref_type in store_ref_counters so that new items created
-- via create_item() get a unique SKU in the format  ITEM-{SLUG}-{N}.
-- Existing items are unaffected — only future inserts use the counter.
-- The counter starts at 1 for all stores (fresh) or just after the highest
-- existing auto-generated SKU sequence number for stores that already have some.
-- ============================================================================

INSERT INTO store_ref_counters (store_id, ref_type, next_val)
SELECT
    s.id,
    'ITEM',
    COALESCE(
        -- If any auto-generated SKUs (starting with 'ITEM-') already exist,
        -- pick up right after the highest sequence number.
        (
            SELECT MAX(
                CAST(
                    REGEXP_REPLACE(i.sku, '^ITEM-[^-]+-', '', 'i') AS BIGINT
                )
            ) + 1
            FROM items i
            WHERE i.store_id = s.id
              AND i.sku ~ '^ITEM-[^-]+-[0-9]+$'
        ),
        1
    )
FROM stores s
ON CONFLICT (store_id, ref_type) DO UPDATE
    SET next_val = GREATEST(store_ref_counters.next_val, EXCLUDED.next_val);
