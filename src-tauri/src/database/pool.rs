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

use std::path::Path;
use sha2::{Sha256, Digest};
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
            // Old DefaultHasher format (16 hex chars) → upgrade hash, don't re-run
            Some(stored_hash) if stored_hash.len() == 16 => {
                tracing::info!(
                    "Migration {version:04}: upgrading hash from DefaultHasher to SHA-256."
                );
                upgrade_migration_hash(pool, version, &filename, &hash).await?;
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

/// Update the stored hash for an already-applied migration without re-running it.
/// Used to migrate from the old DefaultHasher format to SHA-256.
async fn upgrade_migration_hash(
    pool:     &PgPool,
    version:  i64,
    filename: &str,
    hash:     &str,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE _app_migrations SET name = $2, content_hash = $3 WHERE version = $1"
    )
    .bind(version)
    .bind(filename)
    .bind(hash)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(
        format!("Cannot upgrade hash for migration {filename}: {e}")
    ))?;
    Ok(())
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

/// Compute a stable SHA-256 hex hash of the migration file content.
fn compute_hash(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── compute_hash ──────────────────────────────────────────────────────────

    #[test]
    fn hash_is_64_hex_chars() {
        let h = compute_hash("SELECT 1");
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn hash_is_stable_across_calls() {
        let a = compute_hash("CREATE TABLE foo (id SERIAL PRIMARY KEY)");
        let b = compute_hash("CREATE TABLE foo (id SERIAL PRIMARY KEY)");
        assert_eq!(a, b);
    }

    #[test]
    fn different_content_produces_different_hash() {
        let a = compute_hash("SELECT 1");
        let b = compute_hash("SELECT 2");
        assert_ne!(a, b);
    }

    #[test]
    fn hash_matches_known_sha256() {
        // echo -n "" | sha256sum → e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        let h = compute_hash("");
        assert_eq!(h, "e3b0c44298fc1c149afbf4c8996fb924\
                        27ae41e4649b934ca495991b7852b855");
    }

    // ── split_sql_statements ──────────────────────────────────────────────────

    #[test]
    fn splits_two_simple_statements() {
        let sql = "CREATE TABLE a (id INT); CREATE TABLE b (id INT);";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 2);
        assert!(stmts[0].starts_with("CREATE TABLE a"));
        assert!(stmts[1].starts_with("CREATE TABLE b"));
    }

    #[test]
    fn trailing_statement_without_semicolon_is_included() {
        let sql = "SELECT 1";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 1);
        assert_eq!(stmts[0], "SELECT 1");
    }

    #[test]
    fn empty_input_returns_empty_vec() {
        assert!(split_sql_statements("").is_empty());
    }

    #[test]
    fn whitespace_only_input_returns_empty_vec() {
        assert!(split_sql_statements("   \n\t  ").is_empty());
    }

    #[test]
    fn dollar_quote_block_preserved_as_one_statement() {
        let sql = r#"
            CREATE OR REPLACE FUNCTION test_fn() RETURNS void AS $$
            BEGIN
                INSERT INTO foo VALUES (1);
                INSERT INTO foo VALUES (2);
            END;
            $$ LANGUAGE plpgsql;
        "#;
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 1, "Dollar-quoted block must not be split");
        assert!(stmts[0].contains("INSERT INTO foo VALUES (1)"));
        assert!(stmts[0].contains("INSERT INTO foo VALUES (2)"));
    }

    #[test]
    fn semicolons_inside_dollar_quote_are_not_terminators() {
        let sql = "DO $$ BEGIN RAISE NOTICE 'a;b;c'; END $$;";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 1);
    }

    #[test]
    fn inline_comment_is_stripped_and_does_not_affect_split() {
        let sql = "-- comment\nSELECT 1;\nSELECT 2;";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 2);
    }

    #[test]
    fn blank_statements_between_semicolons_are_dropped() {
        let sql = "SELECT 1;;SELECT 2;";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 2);
    }

    #[test]
    fn multiple_dollar_quote_blocks_each_become_one_statement() {
        let sql = r#"
            CREATE FUNCTION f1() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;
            CREATE FUNCTION f2() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;
        "#;
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 2);
    }
}
