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
use include_dir::{include_dir, Dir};
use crate::{error::{AppError, AppResult}, state::DbConfig};

/// All migration SQL files embedded into the binary at compile time.
/// This makes the production Tauri binary fully self-contained — no external
/// migrations folder is needed at runtime.
static EMBEDDED_MIGRATIONS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/migrations");

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
        .map_err(|e| {
            if is_missing_database_error(&e) {
                AppError::DatabaseMissing(cfg.database.clone())
            } else {
                AppError::Internal(format!("Failed to connect to database: {e}"))
            }
        })?;

    tracing::info!("PostgreSQL connection established — running pending migrations…");

    #[cfg(debug_assertions)]
    run_migrations(&pool, "./migrations", &cfg.username).await?;

    #[cfg(not(debug_assertions))]
    run_migrations_embedded(&pool, &cfg.username).await?;

    tracing::info!("All migrations up to date.");

    Ok(pool)
}

/// Create a cloud PgPool from a raw connection URL (no migrations — cloud DB
/// is assumed to already have the schema from the primary local DB).
/// Uses a smaller pool since cloud writes are background / async.
pub async fn create_cloud_pool(url: &str) -> AppResult<PgPool> {
    tracing::info!("Connecting to Supabase cloud database…");
    PgPoolOptions::new()
        .max_connections(5)
        .min_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(15))
        .idle_timeout(std::time::Duration::from_secs(120))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .connect(url)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to connect to Supabase cloud DB: {e}")))
}

/// Connect to Supabase **and** automatically run all pending migrations.
///
/// Migrations are read from the [`EMBEDDED_MIGRATIONS`] static — they are
/// baked into the binary at compile time, so no local folder is required at
/// runtime. This is the function used in production mode.
///
/// The same `_app_migrations` tracking table and idempotency guarantees used
/// for the local DB apply here, so re-running on an already-migrated cloud DB
/// is always safe.
pub async fn create_cloud_pool_with_migrations(url: &str) -> AppResult<PgPool> {
    let pool = create_cloud_pool(url).await?;
    tracing::info!("Running schema migrations on Supabase cloud database…");
    run_migrations_embedded(&pool, "supabase").await?;
    tracing::info!("Supabase schema is up to date.");
    Ok(pool)
}

/// Lightweight connectivity check — SELECT 1.
pub async fn ping(pool: &PgPool) -> bool {
    sqlx::query("SELECT 1").execute(pool).await.is_ok()
}

// ── Database creation (self-service, from the Setup screen) ──────────────────

/// True if a sqlx connect/query error is Postgres error 3D000
/// ("invalid_catalog_name" — i.e. the target database does not exist).
/// This is how we distinguish "server unreachable / bad credentials" from
/// "server is fine, the database just hasn't been created yet".
pub fn is_missing_database_error(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::Database(db_err) => db_err.code().as_deref() == Some("3D000"),
        _ => false,
    }
}

/// True if a sqlx query error is Postgres error 42501
/// ("insufficient_privilege" — the role can log in but lacks CREATEDB, or
/// otherwise isn't allowed to run this statement).
fn is_permission_denied_error(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::Database(db_err) => db_err.code().as_deref() == Some("42501"),
        _ => false,
    }
}

/// Validate a database name is safe to interpolate directly into a
/// `CREATE DATABASE "<name>"` statement (Postgres does not support bind
/// parameters for identifiers in DDL). Restricting to letters/digits/
/// underscore, starting with a letter or underscore, makes injection
/// impossible regardless of what the user typed in the setup form.
fn validate_db_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.len() > 63 {
        return Err(AppError::Validation(
            "Database name must be 1-63 characters.".into(),
        ));
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(AppError::Validation(
            "Database name must start with a letter or underscore.".into(),
        ));
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(AppError::Validation(
            "Database name may only contain letters, numbers, and underscores.".into(),
        ));
    }
    Ok(())
}

/// Connect to the `postgres` maintenance database on the same server/creds
/// and check whether `cfg.database` exists yet.
pub async fn database_exists(cfg: &DbConfig) -> AppResult<bool> {
    validate_db_name(&cfg.database)?;

    let maintenance = DbConfig { database: "postgres".to_string(), ..cfg.clone() };
    let url = build_connection_string(&maintenance);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&url)
        .await
        .map_err(|e| AppError::Internal(format!("Cannot reach PostgreSQL server: {e}")))?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)"
    )
    .bind(&cfg.database)
    .fetch_one(&pool)
    .await
    .map_err(|e| AppError::Internal(format!("Cannot check database existence: {e}")))?;

    pool.close().await;
    Ok(exists)
}

/// Create `cfg.database` on the Postgres server if it doesn't already exist.
/// Connects to the `postgres` maintenance database using the same host/port/
/// credentials, so this works against any reachable Postgres server — local
/// or remote — with no hardcoded database name anywhere in the flow.
///
/// Idempotent: if the database already exists (e.g. a second click, or a
/// race with another terminal setting up at the same time), this is a no-op.
pub async fn create_database(cfg: &DbConfig) -> AppResult<()> {
    validate_db_name(&cfg.database)?;

    if database_exists(cfg).await? {
        tracing::info!("Database '{}' already exists — skipping creation.", cfg.database);
        return Ok(());
    }

    let maintenance = DbConfig { database: "postgres".to_string(), ..cfg.clone() };
    let url = build_connection_string(&maintenance);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&url)
        .await
        .map_err(|e| AppError::Internal(format!("Cannot reach PostgreSQL server: {e}")))?;

    // CREATE DATABASE cannot be parameterized ($1) — Postgres only allows
    // bind params for values, not identifiers. Safe here because
    // validate_db_name() above restricts the name to [A-Za-z_][A-Za-z0-9_]*,
    // and we additionally double-escape any stray quote as defense in depth.
    let escaped = cfg.database.replace('"', "\"\"");
    let stmt = format!("CREATE DATABASE \"{escaped}\"");
    sqlx::query(&stmt)
        .execute(&pool)
        .await
        .map_err(|e| {
            if is_permission_denied_error(&e) {
                AppError::DatabaseCreatePermissionDenied(cfg.username.clone())
            } else {
                AppError::Internal(format!("Failed to create database '{}': {e}", cfg.database))
            }
        })?;

    pool.close().await;
    tracing::info!("Database '{}' created successfully.", cfg.database);
    Ok(())
}

// ── Migration Runner ──────────────────────────────────────────────────────────

/// Run migrations from the filesystem (used by local PostgreSQL on dev/setup).
async fn run_migrations(pool: &PgPool, migrations_dir: &str, username: &str) -> AppResult<()> {
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

        apply_migration(pool, version, &filename, &content, &hash, username).await?;

        tracing::info!("Migration {version:04} applied successfully.");
    }

    Ok(())
}

/// Run migrations from the [`EMBEDDED_MIGRATIONS`] static (used by Supabase
/// cloud in production). The logic is identical to `run_migrations` but reads
/// file content from the compile-time embedded directory instead of the
/// filesystem, so no external folder is required at runtime.
///
/// All pending migrations are applied in a SINGLE TRANSACTION for speed.
async fn run_migrations_embedded(pool: &PgPool, username: &str) -> AppResult<()> {
    // 1. Ensure tracking table exists
    ensure_migrations_table(pool).await?;

    // 2. Load what is already applied: version -> content_hash
    let applied = load_applied_migrations(pool).await?;

    // 3. Collect & sort embedded .sql files by version number
    let mut all_entries: Vec<(i64, String, &str)> = Vec::new();
    for file in EMBEDDED_MIGRATIONS.files() {
        let filename = match file.path().file_name().and_then(|n| n.to_str()) {
            Some(f) => f.to_string(),
            None    => continue,
        };
        if !filename.ends_with(".sql") { continue; }
        let version = match filename.split('_').next().and_then(|v| v.parse::<i64>().ok()) {
            Some(v) => v,
            None    => { tracing::warn!("Ignoring non-standard embedded migration: {filename}"); continue; }
        };
        let content = match file.contents_utf8() {
            Some(c) => c,
            None    => { tracing::warn!("Embedded migration {filename} is not valid UTF-8, skipping."); continue; }
        };
        all_entries.push((version, filename, content));
    }
    all_entries.sort_by_key(|(v, _, _)| *v);

    // 4. Separate into: needs_run vs needs_hash_upgrade vs already_ok
    // (version, name, content, hash)
    let mut to_run:     Vec<(i64, String, &str, String)> = Vec::new();
    // (version, name, hash)
    let mut to_upgrade: Vec<(i64, String, String)>       = Vec::new();

    for (version, filename, content) in &all_entries {
        let hash = compute_hash(content);
        match applied.get(version) {
            // Already applied, same content → skip
            Some(stored_hash) if stored_hash == &hash => {
                tracing::debug!("Cloud migration {version:04} up to date — skipping.");
                continue;
            }
            // Old DefaultHasher format (16 hex chars) → upgrade hash, don’t re-run
            Some(stored_hash) if stored_hash.len() == 16 => {
                // Old DefaultHasher format -- upgrade hash only, no re-run needed
                to_upgrade.push((*version, filename.clone(), hash));
            }
            // Applied before but file changed → re-run (idempotent migration)
            Some(_) => {
                // Content changed -- re-apply (idempotent migration)
                to_run.push((*version, filename.clone(), content, hash));
            }
            // Never applied → run fresh
            None => {
                tracing::info!("Cloud migration {version:04}: {filename}");
                to_run.push((*version, filename.clone(), content, hash));
            }
        }
    }

    if to_run.is_empty() && to_upgrade.is_empty() {
        tracing::info!("Cloud DB schema is already up to date.");
        return Ok(());
    }

    // Apply ALL pending migrations in ONE transaction -> single round-trip to Supabase
    if !to_run.is_empty() {
        tracing::info!(
            "Applying {} pending cloud migration(s) in a single transaction...",
            to_run.len()
        );

        let mut tx = pool.begin().await
            .map_err(|e| AppError::Internal(
                format!("Cannot begin cloud migration transaction: {e}")
            ))?;

        for (version, filename, content, hash) in &to_run {
            // Progress log per file — without this the runner is silent for the
            // entire transaction, which reads as a hang on slow WAN links
            // (a first-time Supabase migration is thousands of sequential
            // round-trips and legitimately takes several minutes).
            //
            // NOTE: batching each file into one sqlx::raw_sql() round-trip was
            // tried and reverted — RawSql's borrow across the awaits inside
            // tauri/axum's generated Send futures fails HRTB ("implementation
            // of `Executor` is not general enough"). Per-statement query() is
            // the proven-compiling path.
            tracing::info!("Applying migration {version:04}: {filename}");

            for stmt in split_sql_statements(content) {
                sqlx::query(&stmt)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| {
                        if is_permission_denied_error(&e) {
                            AppError::SchemaPermissionDenied(username.to_string())
                        } else {
                            AppError::Internal(
                                format!("Cloud migration {filename} failed.\nStatement:\n{stmt}\n\nError: {e}")
                            )
                        }
                    })?;
            }
            sqlx::query(
                "INSERT INTO _app_migrations (version, name, content_hash)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (version) DO UPDATE
                     SET name=EXCLUDED.name, content_hash=EXCLUDED.content_hash, applied_at=NOW()"
            )
            .bind(*version)
            .bind(filename.as_str())
            .bind(hash.as_str())
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Internal(
                format!("Cannot record cloud migration {filename}: {e}")
            ))?;
            tracing::debug!("Cloud migration {version:04} staged in batch.");
        }

        tx.commit().await
            .map_err(|e| AppError::Internal(
                format!("Cannot commit cloud migrations batch: {e}")
            ))?;
        tracing::info!("{} cloud migration(s) applied and committed.", to_run.len());
    }

    // Upgrade old-format hashes (no SQL re-run, just UPDATE the hash column)
    for (version, filename, hash) in to_upgrade {
        upgrade_migration_hash(pool, version, &filename, &hash).await?;
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
    username: &str,
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
            .map_err(|e| {
                if is_permission_denied_error(&e) {
                    AppError::SchemaPermissionDenied(username.to_string())
                } else {
                    AppError::Internal(
                        format!("Migration {filename} failed.\nStatement:\n{stmt}\n\nError: {e}")
                    )
                }
            })?;
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
