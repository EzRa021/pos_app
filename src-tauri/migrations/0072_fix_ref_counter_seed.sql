-- Fix ref counters that were seeded at next_val=1 by migration 0071 on
-- databases that already had existing transactions/returns/POs.
--
-- We set each counter to MAX(existing_number) + 1, but never lower than
-- its current value (in case some counters are already correct).

-- TXN
INSERT INTO store_ref_counters (store_id, ref_type, next_val)
SELECT
    s.id,
    'TXN',
    COALESCE(
        (SELECT MAX(CAST(REGEXP_REPLACE(reference_no, '^[A-Z]+-0*', '') AS BIGINT)) + 1
         FROM   transactions
         WHERE  store_id = s.id
           AND  reference_no ~ '^TXN-'),
        1
    )
FROM stores s
ON CONFLICT (store_id, ref_type) DO UPDATE
    SET next_val = GREATEST(store_ref_counters.next_val, EXCLUDED.next_val);

-- RET
INSERT INTO store_ref_counters (store_id, ref_type, next_val)
SELECT
    s.id,
    'RET',
    COALESCE(
        (SELECT MAX(CAST(REGEXP_REPLACE(reference_no, '^[A-Z]+-0*', '') AS BIGINT)) + 1
         FROM   returns
         WHERE  store_id = s.id
           AND  reference_no ~ '^RET-'),
        1
    )
FROM stores s
ON CONFLICT (store_id, ref_type) DO UPDATE
    SET next_val = GREATEST(store_ref_counters.next_val, EXCLUDED.next_val);

-- PO
INSERT INTO store_ref_counters (store_id, ref_type, next_val)
SELECT
    s.id,
    'PO',
    COALESCE(
        (SELECT MAX(CAST(REGEXP_REPLACE(po_number, '^[A-Z]+-0*', '') AS BIGINT)) + 1
         FROM   purchase_orders
         WHERE  store_id = s.id
           AND  po_number ~ '^PO-'),
        1
    )
FROM stores s
ON CONFLICT (store_id, ref_type) DO UPDATE
    SET next_val = GREATEST(store_ref_counters.next_val, EXCLUDED.next_val);
