-- ============================================================================
-- MIGRATION 0047: PIN Security & Session Management
-- ============================================================================

-- Add security fields to users
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pos_pin_hash        VARCHAR(200),
    ADD COLUMN IF NOT EXISTS failed_login_count  INT         NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until        TIMESTAMPTZ;

-- Active sessions table (one row per live session token)
CREATE TABLE IF NOT EXISTS active_sessions (
    id           SERIAL PRIMARY KEY,
    user_id      INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id     INT          REFERENCES stores(id),
    token_hash   VARCHAR(200) NOT NULL UNIQUE,
    device_info  VARCHAR(300),
    ip_address   VARCHAR(45),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user       ON active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON active_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires    ON active_sessions(expires_at);

-- Extend store_settings with security rules (idempotent)
ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS auto_lock_after_minutes   INT NOT NULL DEFAULT 15,
    ADD COLUMN IF NOT EXISTS max_failed_login_attempts INT NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS lockout_duration_minutes  INT NOT NULL DEFAULT 30;
