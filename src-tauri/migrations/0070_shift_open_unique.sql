-- Prevent concurrent duplicate open shifts for the same user in the same store.
--
-- The open_shift command does a SELECT-then-INSERT in two separate queries,
-- creating a TOCTOU window where two simultaneous requests from the same
-- terminal could both pass the check and insert two open shifts.
--
-- A partial unique index covering the three "live" statuses causes the
-- second concurrent INSERT to fail with a unique-violation error, which
-- sqlx maps to AppError::Conflict before it reaches the application layer.
--
-- Scope: (store_id, opened_by) — each user gets at most one live shift
-- per store. Different users in the same store each have their own shift.

CREATE UNIQUE INDEX IF NOT EXISTS ux_shifts_one_open_per_user_store
    ON shifts (store_id, opened_by)
    WHERE status IN ('open', 'active', 'suspended');
