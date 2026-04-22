-- 0088_user_avatar.sql
-- Adds a profile photo column to the users table.
-- Stored as a base64 data URI (e.g. "data:image/webp;base64,…")
-- The frontend resizes every upload to 256×256 WebP before saving,
-- keeping typical values between 15 KB and 150 KB.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT NULL;
