# fix_migrations.ps1
# Fixes the "migration 51 was previously applied but has been modified" error
# by deleting the stale checksum row, then re-running all pending migrations.
#
# All statements in 0051 are IF NOT EXISTS / idempotent — safe to re-apply.
# After re-applying 0051, sqlx will also apply 0053 (image_data column).

$env:PGPASSWORD = "quantum_password"
$psql = "psql"   # assumes psql is on PATH; adjust if needed

Write-Host "Deleting stale checksum for migration 0051..." -ForegroundColor Yellow
& $psql -h localhost -p 5432 -U quantum_user -d pos_app -c `
    "DELETE FROM _sqlx_migrations WHERE version = 51;"

Write-Host "Running all pending migrations (0051 re-apply + 0053 new)..." -ForegroundColor Yellow
Set-Location "C:\Users\user\Desktop\pos-app\src-tauri"
cargo sqlx migrate run

Write-Host "Done. Column image_data should now exist on the items table." -ForegroundColor Green
