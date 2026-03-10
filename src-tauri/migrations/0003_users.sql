-- ============================================================================
-- MIGRATION 0003: Users & Sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id                      SERIAL PRIMARY KEY,
    username                VARCHAR(100) NOT NULL UNIQUE,
    email                   VARCHAR(255) NOT NULL UNIQUE,
    password_hash           TEXT         NOT NULL,
    first_name              VARCHAR(100) NOT NULL,
    last_name               VARCHAR(100) NOT NULL,
    phone                   VARCHAR(50),
    role_id                 INT          NOT NULL REFERENCES roles(id),
    store_id                INT          REFERENCES stores(id) ON DELETE SET NULL,
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    failed_login_attempts   INT          NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    last_login              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username  ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_id   ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_store_id  ON users(store_id);

CREATE TABLE IF NOT EXISTS user_sessions (
    id            SERIAL PRIMARY KEY,
    user_id       INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token         TEXT NOT NULL UNIQUE,
    refresh_token TEXT,
    expires_at    TIMESTAMPTZ NOT NULL,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token   ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);

-- ── Seed: default super_admin ─────────────────────────────────────────────────
-- Default password: Admin@123  (bcrypt hash — change immediately in production)
INSERT INTO users (username, email, password_hash, first_name, last_name, role_id)
SELECT 'admin', 'admin@quantumpos.app',
       '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
       'Super', 'Admin',
       r.id
FROM   roles r WHERE r.role_slug = 'super_admin'
ON CONFLICT (username) DO NOTHING;
