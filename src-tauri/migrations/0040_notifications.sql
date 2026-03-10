-- ============================================================================
-- MIGRATION 0040: Notifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id              SERIAL PRIMARY KEY,
    store_id        INT          NOT NULL REFERENCES stores(id),
    user_id         INT          REFERENCES users(id),   -- NULL = broadcast to all admins/managers
    type            VARCHAR(40)  NOT NULL,
    title           VARCHAR(200) NOT NULL,
    message         TEXT         NOT NULL,
    reference_type  VARCHAR(50),
    reference_id    VARCHAR(100),
    is_read         BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_store_read
    ON notifications(store_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user
    ON notifications(user_id, is_read)
    WHERE user_id IS NOT NULL;
