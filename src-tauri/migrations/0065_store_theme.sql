-- Migration 0065: Per-store UI theme preference
-- Stores whether the branch uses dark or light mode.
-- Dark is the default — existing stores will inherit it.
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS theme VARCHAR(10) NOT NULL DEFAULT 'dark';
