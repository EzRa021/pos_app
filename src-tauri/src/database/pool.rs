// ============================================================================
// DATABASE POOL
// ============================================================================
// Creates and validates the SQLx PostgreSQL connection pool.
//
// MIGRATION STRATEGY — version + content-hash tracking:
//   • Migrations are tracked in `_app_migrations` by version number AND
//     a hash of the file's content.
//   • If a migration file has NEVER been applied → run it now.
//   • If a migration file WAS applied but the file content has CHANGED
//     → re-run it automatically (files must be fully idempotent).
//   • If the version is applied AND the hash matches → skip (no-op).
//   • Files that don't match the NNNN_*.sql naming pattern are ignored.
//   • No checksums from sqlx's _sqlx_migrations table are consulted.
//
// IDEMPOTENCY REQUIREMENT:
//   Every migration file MUST be safe to re-run:
//   - CREATE TABLE IF NOT EXISTS
//   - ALTER TABLE ADD COLUMN IF NOT EXISTS
//   - CREATE INDEX IF NOT EXISTS
//   - INSERT ... ON CONFLICT DO NOTHING
//   - CREATE OR REPLACE FUNCTION
//   - DROP TRIGGER IF EXISTS before CREATE TRIGGER
//   - DO $$ BEGIN IF NOT EXISTS ... END $$ for constraints
// ============================================================================

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use crate::{error::{AppError, AppResult}, state::DbConfig};

// ── Public API ────────────────────────────────────────────────────────────────

/// Build the Postgres connection string from a DbConfig.
pub fn build_connection_string(cfg: &DbConfig) -> String {
    format!(
        "postgres://{}:{}@{}:{}/{}",
        cfg.username, cfg.password, cfg.host, cfg.port, cfg.database
    )
}

/// Create a PgPool and immediately run all pending / changed migrations.
pub async fn create_pool(cfg: &DbConfig) -> AppResult<PgPool> {
    let url = build_connection_string(cfg);

    tracing::info!(
        "Connecting to PostgreSQL at {}:{}/{}",
        cfg.host, cfg.port, cfg.database
    );

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .idle_timeout(std::time::Duration::from_secs(60))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .connect(&url)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to connect to database: {e}")))?;

    tracing::info!("PostgreSQL connection established — running pending migrations…");

    run_migrations(&pool, "./migrations").await?;

    tracing::info!("All migrations up to date.");

    Ok(pool)
}

/// Lightweight connectivity check — SELECT 1.
pub async fn ping(pool: &PgPool) -> bool {
    sqlx::query("SELECT 1").execute(pool).await.is_ok()
}

// ── Migration Runner ──────────────────────────────────────────────────────────

async fn run_migrations(pool: &PgPool, migrations_dir: &str) -> AppResult<()> {
    // 1. Ensure tracking table exists with content_hash column
    ensure_migrations_table(pool).await?;

    // 2. Load what is already applied: version → content_hash
    let applied = load_applied_migrations(pool).await?;

    // 3. Collect & sort .sql files by version number
    let entries = collect_migration_files(migrations_dir)?;

    // 4. For each file: run if new or if content changed
    for (version, filename, path) in entries {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| AppError::Internal(format!("Cannot read {filename}: {e}")))?;

        let hash = compute_hash(&content);

        match applied.get(&version) {
            // Already applied, same content → skip
            Some(stored_hash) if stored_hash == &hash => {
                tracing::debug!("Migration {version:04} up to date — skipping.");
                continue;
            }
            // Applied before but file changed → re-run (idempotent migration)
            Some(_) => {
                tracing::info!(
                    "Migration {version:04} ({filename}) content changed — re-applying…"
                );
            }
            // Never applied → run fresh
            None => {
                tracing::info!("Applying migration {version:04}: {filename}");
            }
        }

        apply_migration(pool, version, &filename, &content, &hash).await?;

        tracing::info!("Migration {version:04} applied successfully.");
    }

    Ok(())
}

async fn ensure_migrations_table(pool: &PgPool) -> AppResult<()> {
    // Create the table if it doesn't exist
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _app_migrations (
            version      BIGINT      PRIMARY KEY,
            name         TEXT        NOT NULL,
            content_hash TEXT        NOT NULL DEFAULT '',
            applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("Cannot create _app_migrations: {e}")))?;

    // Add content_hash column if this table existed before this feature was added
    sqlx::query(
        "ALTER TABLE _app_migrations ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT ''"
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("Cannot alter _app_migrations: {e}")))?;

    Ok(())
}

async fn load_applied_migrations(
    pool: &PgPool,
) -> AppResult<std::collections::HashMap<i64, String>> {
    let rows = sqlx::query("SELECT version, content_hash FROM _app_migrations")
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(format!("Cannot read _app_migrations: {e}")))?;

    Ok(rows
        .into_iter()
        .map(|r| (r.get::<i64, _>("version"), r.get::<String, _>("content_hash")))
        .collect())
}

fn collect_migration_files(
    dir: &str,
) -> AppResult<Vec<(i64, String, std::path::PathBuf)>> {
    let mut entries = Vec::new();

    let read_dir = std::fs::read_dir(Path::new(dir))
        .map_err(|e| AppError::Internal(format!("Cannot read migrations dir '{dir}': {e}")))?;

    for entry in read_dir.flatten() {
        let path = entry.path();

        // Only .sql files
        if path.extension().and_then(|e| e.to_str()) != Some("sql") {
            continue;
        }

        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(f) => f.to_string(),
            None    => continue,
        };

        // Must start with a numeric version prefix: "0001_name.sql"
        let version = match filename.split('_').next().and_then(|v| v.parse::<i64>().ok()) {
            Some(v) => v,
            None    => {
                tracing::warn!("Ignoring non-standard file in migrations dir: {filename}");
                continue;
            }
        };

        entries.push((version, filename, path));
    }

    entries.sort_by_key(|(v, _, _)| *v);
    Ok(entries)
}

async fn apply_migration(
    pool:     &PgPool,
    version:  i64,
    filename: &str,
    content:  &str,
    hash:     &str,
) -> AppResult<()> {
    let mut tx = pool.begin().await
        .map_err(|e| AppError::Internal(
            format!("Cannot begin transaction for {filename}: {e}")
        ))?;

    // Execute each statement individually (prepared statements are single-command only).
    // The splitter is dollar-quote-aware so PL/pgSQL $$ blocks are kept intact.
    for stmt in split_sql_statements(content) {
        sqlx::query(&stmt)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Internal(
                format!("Migration {filename} failed.\nStatement:\n{stmt}\n\nError: {e}")
            ))?;
    }

    // Upsert the tracking record with the new hash
    sqlx::query(
        "INSERT INTO _app_migrations (version, name, content_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (version) DO UPDATE
             SET name         = EXCLUDED.name,
                 content_hash = EXCLUDED.content_hash,
                 applied_at   = NOW()"
    )
    .bind(version)
    .bind(filename)
    .bind(hash)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(
        format!("Cannot record migration {filename}: {e}")
    ))?;

    tx.commit().await
        .map_err(|e| AppError::Internal(
            format!("Cannot commit migration {filename}: {e}")
        ))?;

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Compute a stable hex string hash of the migration file content.
/// Uses Rust's DefaultHasher — fast, no external crate needed.
fn compute_hash(content: &str) -> String {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Split a SQL migration file into individual executable statements.
///
/// Rules:
///   • `$$…$$` dollar-quoted PL/pgSQL blocks — semicolons inside are NOT terminators.
///   • `--` single-line comments — stripped so they don't affect parsing.
///   • Blank chunks after stripping are dropped.
///   • Everything else is split on `;`.
fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_dollar_quote = false;
    let bytes = sql.as_bytes();
    let len = sql.len();
    let mut i = 0;

    while i < len {
        // Detect $$ (dollar-quote open/close)
        if i + 1 < len && bytes[i] == b'$' && bytes[i + 1] == b'$' {
            current.push_str("$$");
            in_dollar_quote = !in_dollar_quote;
            i += 2;
            continue;
        }

        // Inside a dollar-quoted block — copy verbatim, never split
        if in_dollar_quote {
            let ch = sql[i..].chars().next().unwrap_or('\0');
            current.push(ch);
            i += ch.len_utf8();
            continue;
        }

        // Strip -- comment (only outside dollar-quote)
        if i + 1 < len && bytes[i] == b'-' && bytes[i + 1] == b'-' {
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            current.push('\n');
            continue;
        }

        // Statement terminator
        if bytes[i] == b';' {
            let stmt = current.trim().to_string();
            if !stmt.is_empty() {
                statements.push(stmt);
            }
            current = String::new();
            i += 1;
            continue;
        }

        // Normal character
        let ch = sql[i..].chars().next().unwrap_or('\0');
        current.push(ch);
        i += ch.len_utf8();
    }

    // Trailing content without a final semicolon
    let stmt = current.trim().to_string();
    if !stmt.is_empty() {
        statements.push(stmt);
    }

    statements
}
