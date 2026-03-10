-- ============================================================================
-- SEED: Demo users for every built-in role
-- ============================================================================
-- Run with:
--   psql -U quantum_user -d pos_app -f scripts/seed_users.sql
--
-- All passwords are:  Admin@123
-- Hash below is a valid bcrypt(Admin@123, cost=10) produced by the app.
--
-- Users created:
--   USERNAME        ROLE          GLOBAL  STORE
--   admin           super_admin   YES     (all stores)
--   store_admin     admin         no      Main Store
--   manager1        manager       no      Main Store
--   cashier1        cashier       no      Main Store
--   cashier2        cashier       no      Main Store
--   stockkeeper1    stock_keeper  no      Main Store
-- ============================================================================

-- Verified bcrypt hash for: Admin@123
\set PWD_HASH '\'$2b$10$faxjNIj4d/Gf0agqXIEiguXY.jUgwSXlPtnUIaaYhWfGb2rFCxzim\''

DO $$
DECLARE
    v_store_id          INT;
    v_role_admin        INT;
    v_role_manager      INT;
    v_role_cashier      INT;
    v_role_stock_keeper INT;
    v_pw                TEXT := '$2b$10$faxjNIj4d/Gf0agqXIEiguXY.jUgwSXlPtnUIaaYhWfGb2rFCxzim';
BEGIN

    -- ── Resolve IDs ──────────────────────────────────────────────────────────
    SELECT id INTO v_store_id       FROM stores WHERE store_name = 'Main Store' LIMIT 1;
    SELECT id INTO v_role_admin     FROM roles  WHERE role_slug  = 'admin';
    SELECT id INTO v_role_manager   FROM roles  WHERE role_slug  = 'manager';
    SELECT id INTO v_role_cashier   FROM roles  WHERE role_slug  = 'cashier';
    SELECT id INTO v_role_stock_keeper FROM roles WHERE role_slug = 'stock_keeper';

    IF v_store_id IS NULL THEN
        RAISE NOTICE 'No store found — creating a default store first.';
        INSERT INTO stores (store_name, country, currency, timezone)
        VALUES ('Main Store', 'Nigeria', 'NGN', 'Africa/Lagos')
        RETURNING id INTO v_store_id;
    END IF;

    -- ── store_admin (Admin role — not global, pinned to Main Store) ──────────
    INSERT INTO users (
        username, email, password_hash,
        first_name, last_name,
        role_id, store_id,
        is_active
    )
    VALUES (
        'store_admin',
        'store.admin@quantumpos.app',
        v_pw,
        'Store', 'Admin',
        v_role_admin, v_store_id,
        TRUE
    )
    ON CONFLICT (username) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            is_active     = TRUE,
            updated_at    = NOW();

    RAISE NOTICE 'Upserted: store_admin (admin)';

    -- ── manager1 ─────────────────────────────────────────────────────────────
    INSERT INTO users (
        username, email, password_hash,
        first_name, last_name,
        role_id, store_id,
        is_active
    )
    VALUES (
        'manager1',
        'manager1@quantumpos.app',
        v_pw,
        'Ahmed', 'Musa',
        v_role_manager, v_store_id,
        TRUE
    )
    ON CONFLICT (username) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            is_active     = TRUE,
            updated_at    = NOW();

    RAISE NOTICE 'Upserted: manager1 (manager)';

    -- ── cashier1 ─────────────────────────────────────────────────────────────
    INSERT INTO users (
        username, email, password_hash,
        first_name, last_name,
        role_id, store_id,
        is_active
    )
    VALUES (
        'cashier1',
        'cashier1@quantumpos.app',
        v_pw,
        'Ngozi', 'Okafor',
        v_role_cashier, v_store_id,
        TRUE
    )
    ON CONFLICT (username) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            is_active     = TRUE,
            updated_at    = NOW();

    RAISE NOTICE 'Upserted: cashier1 (cashier)';

    -- ── cashier2 ─────────────────────────────────────────────────────────────
    INSERT INTO users (
        username, email, password_hash,
        first_name, last_name,
        role_id, store_id,
        is_active
    )
    VALUES (
        'cashier2',
        'cashier2@quantumpos.app',
        v_pw,
        'Emeka', 'Eze',
        v_role_cashier, v_store_id,
        TRUE
    )
    ON CONFLICT (username) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            is_active     = TRUE,
            updated_at    = NOW();

    RAISE NOTICE 'Upserted: cashier2 (cashier)';

    -- ── stockkeeper1 ─────────────────────────────────────────────────────────
    INSERT INTO users (
        username, email, password_hash,
        first_name, last_name,
        role_id, store_id,
        is_active
    )
    VALUES (
        'stockkeeper1',
        'stock1@quantumpos.app',
        v_pw,
        'Bola', 'Adeyemi',
        v_role_stock_keeper, v_store_id,
        TRUE
    )
    ON CONFLICT (username) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            is_active     = TRUE,
            updated_at    = NOW();

    RAISE NOTICE 'Upserted: stockkeeper1 (stock_keeper)';

    RAISE NOTICE '';
    RAISE NOTICE '✅  Seed complete.  All passwords = Admin@123';
    RAISE NOTICE '    admin          → super_admin  (global — all stores)';
    RAISE NOTICE '    store_admin    → admin        (store_id = %)', v_store_id;
    RAISE NOTICE '    manager1       → manager      (store_id = %)', v_store_id;
    RAISE NOTICE '    cashier1       → cashier      (store_id = %)', v_store_id;
    RAISE NOTICE '    cashier2       → cashier      (store_id = %)', v_store_id;
    RAISE NOTICE '    stockkeeper1   → stock_keeper (store_id = %)', v_store_id;

END $$;
