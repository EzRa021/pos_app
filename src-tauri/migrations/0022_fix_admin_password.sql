-- ============================================================================
-- MIGRATION 0022: Fix admin seed password
-- The original seed in 0003 used a Laravel test hash (password: "password").
-- This migration corrects it to Admin@123.
-- Safe to run multiple times: only updates if the old hash is still present.
-- ============================================================================

UPDATE users
SET    password_hash = '$2b$10$faxjNIj4d/Gf0agqXIEiguXY.jUgwSXlPtnUIaaYhWfGb2rFCxzim'
WHERE  username      = 'admin'
  AND  password_hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
