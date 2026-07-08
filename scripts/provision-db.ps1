# ============================================================================
# provision-db.ps1
# ============================================================================
# Runs automatically after Quantum POS installs (wired via the NSIS installer
# hook — see src-tauri/installer-hooks.nsh). Its entire job is to make sure
# the app's fixed database ("myposdb") and role exist ahead of time, so a
# non-technical store owner never sees a connection error when they first
# open the app — ServerSetup.jsx assumes both are already there and does not
# create either itself.
#
# Does three things, all idempotent:
#   1. Creates the $AppDbUser role if missing (never touches its password if
#      it already exists, so it doesn't clobber a password IT may have
#      customized).
#   2. Creates the fixed "$AppDbName" database if missing, owned by
#      $AppDbUser.
#   3. Grants CREATE on the public schema of that database to $AppDbUser
#      (Postgres 15+ revokes this from non-owners by default; being explicit
#      here means it works regardless of Postgres version or who owns it).
#
# Idempotent — safe to run on every install/update. Silently does nothing if:
#   - PostgreSQL isn't installed on this machine yet (nothing to provision —
#     the in-app Setup screen will guide the user through manual entry as a
#     fallback, though it won't be able to create the database itself).
#   - The Postgres superuser password can't be determined (see below) — again,
#     falls through to the app's existing in-app screen. This script only
#     ever IMPROVES the odds of a silent first run.
# ============================================================================

param(
    [string]$AppDbUser     = "quantum_user",
    [string]$AppDbPassword = "quantum_password",
    [string]$AppDbName     = "myposdb",
    [string]$PgHost        = "localhost",
    [string]$PgPort        = "5432",
    # Superuser password — supplied by the installer via /D=... or an env var
    # set by IT for a silent/unattended install. NEVER hardcode a real
    # production superuser password in source control.
    [string]$PgSuperuserPassword = $env:QPOS_PG_SUPERUSER_PASSWORD
)

$ErrorActionPreference = "SilentlyContinue"

function Write-Log($msg) {
    $logDir = Join-Path $env:LOCALAPPDATA "QuantumPOS"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Add-Content -Path (Join-Path $logDir "provision-db.log") -Value "[$(Get-Date -Format o)] $msg"
}

# ── 1. Find psql ──────────────────────────────────────────────────────────
$psql = Get-Command psql.exe -ErrorAction SilentlyContinue
if (-not $psql) {
    # Fall back to common EDB installer paths
    $candidates = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue
    if ($candidates) { $psql = $candidates | Sort-Object FullName -Descending | Select-Object -First 1 }
}

if (-not $psql) {
    Write-Log "PostgreSQL not found on this machine — skipping auto-provision. App's in-app setup screens will handle it manually."
    exit 0
}

# ── 2. Need the superuser password to provision anything ───────────────────
if ([string]::IsNullOrWhiteSpace($PgSuperuserPassword)) {
    Write-Log "No Postgres superuser password supplied (QPOS_PG_SUPERUSER_PASSWORD not set) — skipping auto-provision. App's in-app setup screens will handle it manually."
    exit 0
}

$psqlPath = $psql.Source ?? $psql.FullName
$env:PGPASSWORD = $PgSuperuserPassword

# ── 3. Idempotent role provisioning ─────────────────────────────────────────
# Creates the role if missing. Never touches the password of an existing
# role (so it doesn't clobber a password an IT admin may have already
# customized).
$roleSql = @"
DO `$`$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$AppDbUser') THEN
        CREATE ROLE $AppDbUser WITH LOGIN PASSWORD '$AppDbPassword';
    END IF;
END
`$`$;
"@

$roleTmpFile = [System.IO.Path]::GetTempFileName()
Set-Content -Path $roleTmpFile -Value $roleSql -Encoding ASCII
& $psqlPath -h $PgHost -p $PgPort -U postgres -d postgres -f $roleTmpFile 2>&1 | Out-Null
$roleExitCode = $LASTEXITCODE
Remove-Item $roleTmpFile -Force

# ── 4. Idempotent database provisioning ─────────────────────────────────────
# CREATE DATABASE can't run inside a DO block or a transaction, so check for
# existence first, then create only if missing — owned by $AppDbUser so it
# automatically has full rights (including schema CREATE) on its own database.
$dbExists = & $psqlPath -h $PgHost -p $PgPort -U postgres -d postgres -tAc `
    "SELECT 1 FROM pg_database WHERE datname = '$AppDbName'" 2>&1

if ($dbExists -notmatch "1") {
    & $psqlPath -h $PgHost -p $PgPort -U postgres -d postgres -c `
        "CREATE DATABASE $AppDbName OWNER $AppDbUser;" 2>&1 | Out-Null
}
$dbExitCode = $LASTEXITCODE

# ── 5. Explicit schema grant (belt-and-braces alongside OWNER above) ────────
$grantSql = "GRANT CREATE ON SCHEMA public TO $AppDbUser;"
& $psqlPath -h $PgHost -p $PgPort -U postgres -d $AppDbName -c $grantSql 2>&1 | Out-Null
$grantExitCode = $LASTEXITCODE

Remove-Item Env:\PGPASSWORD

$exitCode = if ($roleExitCode -eq 0 -and $dbExitCode -eq 0 -and $grantExitCode -eq 0) { 0 } else { 1 }

if ($exitCode -eq 0) {
    Write-Log "Provisioned database '$AppDbName' and role '$AppDbUser' successfully."
} else {
    Write-Log "Provisioning failed (role exit $roleExitCode, db exit $dbExitCode, grant exit $grantExitCode) — app's in-app setup screen will require manual entry."
}

exit 0
