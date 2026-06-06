-- ============================================================================
-- 0094: Customers hardening, constraints, and search indexes
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_customer_type'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT chk_customer_type
      CHECK (customer_type IN ('regular', 'vip', 'wholesale')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_active
  ON customers(store_id, is_active);

CREATE INDEX IF NOT EXISTS idx_customers_type
  ON customers(store_id, customer_type);

CREATE INDEX IF NOT EXISTS idx_customers_updated_at
  ON customers(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_wallet_balance
  ON customers(store_id, wallet_balance DESC)
  WHERE wallet_balance > 0;

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers
  USING GIN((first_name || ' ' || last_name) gin_trgm_ops);
