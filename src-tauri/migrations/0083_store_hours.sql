-- ============================================================================
-- MIGRATION 0083: Opening Hours (per store, per weekday)
-- ============================================================================

CREATE TABLE IF NOT EXISTS store_hours (
    id          SERIAL PRIMARY KEY,
    store_id    INT         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    day_of_week SMALLINT    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 6=Sat
    is_open     BOOLEAN     NOT NULL DEFAULT TRUE,
    open_time   TIME,                -- e.g. '08:00'
    close_time  TIME,                -- e.g. '22:00'
    UNIQUE (store_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_store_hours_store ON store_hours(store_id);

-- Seed Mon–Fri 08:00–18:00, Sat 09:00–16:00, Sun closed for all existing stores
INSERT INTO store_hours (store_id, day_of_week, is_open, open_time, close_time)
SELECT
    s.id,
    d.dow,
    d.is_open,
    d.open_time::TIME,
    d.close_time::TIME
FROM stores s
CROSS JOIN (VALUES
    (0, FALSE, NULL,    NULL),     -- Sunday
    (1, TRUE,  '08:00', '18:00'), -- Monday
    (2, TRUE,  '08:00', '18:00'), -- Tuesday
    (3, TRUE,  '08:00', '18:00'), -- Wednesday
    (4, TRUE,  '08:00', '18:00'), -- Thursday
    (5, TRUE,  '08:00', '18:00'), -- Friday
    (6, TRUE,  '09:00', '16:00')  -- Saturday
) AS d(dow, is_open, open_time, close_time)
ON CONFLICT (store_id, day_of_week) DO NOTHING;
