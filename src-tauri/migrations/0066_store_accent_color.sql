-- Migration 0066: Per-store accent colour preference
-- Stores the accent colour key (e.g. 'blue', 'violet', 'rose').
-- Default is 'blue' to match the previous hard-coded primary token.
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS accent_color VARCHAR(20) NOT NULL DEFAULT 'blue';
