-- Per-store reference number counters.
--
-- The global transaction_ref_seq produces TXN-000001, TXN-000004 … per store
-- in a multi-store deployment, which confuses managers who expect sequential
-- numbers within their own store.
--
-- This table provides atomic per-store counters for each reference type.
-- next_ref_no() in utils/ref_no.rs increments and returns the next value in a
-- single INSERT … ON CONFLICT DO UPDATE … RETURNING, safe under concurrent calls.

CREATE TABLE IF NOT EXISTS store_ref_counters (
    store_id   INT          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    ref_type   VARCHAR(20)  NOT NULL,   -- 'TXN' | 'RET' | 'PO' | 'SHIFT' | 'CM'
    next_val   BIGINT       NOT NULL DEFAULT 1,
    PRIMARY KEY (store_id, ref_type)
);

-- ── Seed counters from existing data ─────────────────────────────────────────
-- For each (store, ref_type) pair we start the counter ONE ABOVE the highest
-- number already used, so the first new document gets the next sequential number
-- and never collides with an existing reference_no.
--
-- The numeric suffix is extracted by stripping the prefix and casting to BIGINT.
-- If a store has no existing records the subquery returns NULL and we fall back
-- to 1 (DEFAULT), so fresh stores also start at TXN-000001.

-- TXN
-- Only rows whose suffix after the prefix is purely numeric (e.g. TXN-000001).
-- References with extra segments (e.g. TXN-000005-IKE) are intentionally skipped;
-- the counter starts at MAX(pure-numeric) + 1 so there is no collision.
INSERT INTO store_ref_counters (store_id, ref_type, next_val)
SELECT
    s.id,
    'TXN',
    COALESCE(
        (SELECT MAX(CAST(REGEXP_REPLACE(reference_no, '^[A-Z]+-0*(\d+)$', '\1') AS BIGINT)) + 1
         FROM   transactions
         WHERE  store_id = s.id
           AND  reference_no ~ '^TXN-\d+$'),
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
        (SELECT MAX(CAST(REGEXP_REPLACE(reference_no, '^[A-Z]+-0*(\d+)$', '\1') AS BIGINT)) + 1
         FROM   returns
         WHERE  store_id = s.id
           AND  reference_no ~ '^RET-\d+$'),
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
        (SELECT MAX(CAST(REGEXP_REPLACE(po_number, '^[A-Z]+-0*(\d+)$', '\1') AS BIGINT)) + 1
         FROM   purchase_orders
         WHERE  store_id = s.id
           AND  po_number ~ '^PO-\d+$'),
        1
    )
FROM stores s
ON CONFLICT (store_id, ref_type) DO UPDATE
    SET next_val = GREATEST(store_ref_counters.next_val, EXCLUDED.next_val);

-- SHIFT (if stores have no shifts yet, just seed at 1)
INSERT INTO store_ref_counters (store_id, ref_type, next_val)
SELECT id, 'SHIFT', 1 FROM stores
ON CONFLICT DO NOTHING;

-- CM (cash movements — no ref numbers currently, seed at 1)
INSERT INTO store_ref_counters (store_id, ref_type, next_val)
SELECT id, 'CM', 1 FROM stores
ON CONFLICT DO NOTHING;
