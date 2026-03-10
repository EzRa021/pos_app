-- ============================================================================
-- MIGRATION 0013: Audit Logs & Receipts
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id          SERIAL PRIMARY KEY,
    user_id     INT         REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    resource    VARCHAR(100) NOT NULL,
    description TEXT,
    details     JSONB,
    ip_address  VARCHAR(45),
    user_agent  TEXT,
    severity    VARCHAR(20)  NOT NULL DEFAULT 'info',  -- info | warning | error | critical
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user     ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS receipts (
    id             SERIAL PRIMARY KEY,
    transaction_id INT          NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    html_content   TEXT,
    printed_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipts_tx ON receipts(transaction_id);
