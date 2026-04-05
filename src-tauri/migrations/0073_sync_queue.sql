-- ============================================================================
-- SYNC QUEUE
-- ============================================================================
-- Stores pending writes that need to be replicated to the Supabase cloud DB.
-- The background sync worker polls this table and replays rows to the cloud.
-- Rows are soft-failed after 10 retries.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_queue (
    id           BIGSERIAL    PRIMARY KEY,
    table_name   TEXT         NOT NULL,
    operation    TEXT         NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    row_id       TEXT         NOT NULL,
    row_data     JSONB        NOT NULL,
    store_id     INT,
    status       TEXT         NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'syncing', 'synced', 'failed')),
    retries      INT          NOT NULL DEFAULT 0,
    error        TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    synced_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status  ON sync_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_store   ON sync_queue(store_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(status) WHERE status = 'pending';
