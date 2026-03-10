-- ============================================================================
-- MIGRATION 0021: Bulk Operations
-- ============================================================================

CREATE TABLE IF NOT EXISTS bulk_operation_jobs (
    id              SERIAL PRIMARY KEY,
    store_id        INT          REFERENCES stores(id),
    operation_type  VARCHAR(30)  NOT NULL,   -- create | update | delete | activate | deactivate | import
    entity_type     VARCHAR(50)  NOT NULL,   -- items | customers | users | suppliers | categories | departments
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed | cancelled
    total_records   INT          NOT NULL DEFAULT 0,
    processed       INT          NOT NULL DEFAULT 0,
    succeeded       INT          NOT NULL DEFAULT 0,
    failed          INT          NOT NULL DEFAULT 0,
    error_log       JSONB,
    result_summary  JSONB,
    created_by      INT          NOT NULL REFERENCES users(id),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bulk_jobs_store  ON bulk_operation_jobs(store_id);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_status ON bulk_operation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_user   ON bulk_operation_jobs(created_by);
