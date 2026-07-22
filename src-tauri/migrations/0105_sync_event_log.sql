-- ============================================================================
-- 0105_sync_event_log.sql — append-only event log for the cloud sync workers
-- ============================================================================
-- Before this migration the only sync telemetry was the `sync:status` Tauri
-- event: one enum plus a free-text string, emitted by BOTH the push and pull
-- workers with no coordination. That is a status indicator, not a log — it
-- cannot answer "what happened at 14:32", it cannot show why a row failed, and
-- pull-side failures were never recorded anywhere at all (they went to
-- tracing::warn! and vanished).
--
-- `sync_event_log` is the missing durable record. One row per row-level sync
-- outcome, grouped into cycles by `cycle_id` so the UI can present the work
-- the way the worker actually performs it.
--
-- This is deliberately a LOCAL-ONLY table: it is never added to sync_queue and
-- never pushed to Supabase. Each device logs its own sync activity — shipping
-- these rows to the cloud would create a feedback loop where logging the sync
-- generates more rows to sync.
--
-- NAMING: this is `sync_event_log`, NOT `sync_log`. A `sync_log` table already
-- exists from 0054_create_businesses_and_app_config.sql — a business-lifecycle
-- audit trail (business_id, event_type, message) written by onboarding.rs.
-- The two are unrelated; do not merge them.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_event_log (
    id           BIGSERIAL    PRIMARY KEY,

    -- Groups every row processed in one worker pass. Lets the UI collapse
    -- "pushed 40 rows" into a single expandable entry instead of 40 lines.
    cycle_id     UUID         NOT NULL,
    direction    TEXT         NOT NULL CHECK (direction IN ('push', 'pull')),

    table_name   TEXT         NOT NULL,
    row_id       TEXT,
    operation    TEXT,

    -- ok        — row applied cleanly
    -- failed    — apply raised an error (see error_code / error_detail)
    -- skipped   — never attempted: a lower FK tier failed earlier this cycle
    -- conflict  — applied, but a concurrent edit was resolved (see sync_conflicts)
    outcome      TEXT         NOT NULL
                              CHECK (outcome IN ('ok', 'failed', 'skipped', 'conflict')),

    -- Coarse classification so the UI can group and explain failures instead
    -- of printing one hardcoded sentence for every error class.
    -- fk_violation | auth | network | constraint | serialization | unknown
    error_code   TEXT,
    error_detail TEXT,

    duration_ms  INT,
    attempt      INT          NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- The log viewer's default query: newest first, optionally filtered.
CREATE INDEX IF NOT EXISTS idx_sync_event_log_created
    ON sync_event_log (created_at DESC);

-- Expanding one cycle in the UI.
CREATE INDEX IF NOT EXISTS idx_sync_event_log_cycle
    ON sync_event_log (cycle_id);

-- "Show me only failures" — by far the most common filter, and the one that
-- matters when something is wrong. Partial keeps it small.
CREATE INDEX IF NOT EXISTS idx_sync_event_log_failures
    ON sync_event_log (created_at DESC)
    WHERE outcome IN ('failed', 'conflict');

-- ── sync_queue: the missing index behind the "recent activity" feed ─────────
-- get_sync_status runs
--     WHERE status = 'synced' ORDER BY synced_at DESC LIMIT 8
-- every 8 seconds. The existing indexes are (status, created_at),
-- (store_id, status) and a partial one on pending — none of them can serve
-- that ORDER BY, so Postgres sorted EVERY synced row on each poll. Combined
-- with the fact that synced rows were never pruned, this degraded without
-- bound the longer a terminal stayed online.
CREATE INDEX IF NOT EXISTS idx_sync_queue_synced_at
    ON sync_queue (synced_at DESC)
    WHERE status = 'synced';
