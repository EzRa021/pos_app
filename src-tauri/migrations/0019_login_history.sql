-- ============================================================================
-- MIGRATION 0019: Login History & Security Events
-- ============================================================================

CREATE TABLE IF NOT EXISTS login_history (
    id           SERIAL PRIMARY KEY,
    user_id      INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username     VARCHAR(100) NOT NULL,
    ip_address   VARCHAR(45),
    user_agent   TEXT,
    status       VARCHAR(20)  NOT NULL DEFAULT 'success',  -- success | failed | locked
    failure_reason TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_hist_user ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_hist_date ON login_history(created_at DESC);

CREATE TABLE IF NOT EXISTS security_events (
    id          SERIAL PRIMARY KEY,
    user_id     INT          REFERENCES users(id) ON DELETE SET NULL,
    event_type  VARCHAR(50)  NOT NULL,  -- failed_login | account_locked | password_reset | suspicious_activity
    description TEXT         NOT NULL,
    ip_address  VARCHAR(45),
    severity    VARCHAR(20)  NOT NULL DEFAULT 'warning',  -- info | warning | critical
    resolved    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_events_user ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_sec_events_date ON security_events(created_at DESC);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pw_reset_token ON password_reset_tokens(token);
