// ============================================================================
// ERROR TYPES
// ============================================================================
// Centralised error enum that converts into Tauri InvokeError (serialised as
// a JSON string so the frontend can read the message).
// ============================================================================

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    // ── Database ────────────────────────────────────────────────────────────
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Database not connected. Please configure the database first.")]
    NotConnected,

    /// The target database does not exist on the Postgres server (but the
    /// server itself was reachable with the given credentials). Carries the
    /// database name so the frontend can offer to create it.
    /// Serializes as "DATABASE_MISSING:<name>" so the frontend can detect it
    /// with a simple string match without needing structured invoke errors.
    #[error("DATABASE_MISSING:{0}")]
    DatabaseMissing(String),

    /// The connected role lacks CREATEDB — it can log in but can't create
    /// new databases. Carries the username so the frontend can show the
    /// exact command to run as a Postgres superuser.
    /// Serializes as "DATABASE_CREATE_PERMISSION_DENIED:<username>".
    #[error("DATABASE_CREATE_PERMISSION_DENIED:{0}")]
    DatabaseCreatePermissionDenied(String),

    /// The connected role can log in and the database exists, but it lacks
    /// CREATE on the target schema (Postgres 15+ default: only the schema
    /// owner can create objects in `public` unless explicitly granted).
    /// Serializes as "SCHEMA_PERMISSION_DENIED:<username>".
    #[error("SCHEMA_PERMISSION_DENIED:{0}")]
    SchemaPermissionDenied(String),

    // ── Auth ───────────────────────────────────────────────────────────────
    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: insufficient permissions to perform this action")]
    Forbidden,

    #[error("Session expired. Please log in again.")]
    SessionExpired,

    // ── Validation ────────────────────────────────────────────────────────────
    #[error("Validation error: {0}")]
    Validation(String),

    // ── Resource ──────────────────────────────────────────────────────────────
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    // ── Crypto / JWT ──────────────────────────────────────────────────────────
    #[error("Token error: {0}")]
    Token(String),

    #[error("Password hashing error: {0}")]
    Crypto(String),

    // ── IO / Excel ────────────────────────────────────────────────────────────
    #[error("File error: {0}")]
    File(String),

    #[allow(dead_code)]
    #[error("Excel error: {0}")]
    Excel(String),

    // ── Generic ───────────────────────────────────────────────────────────────
    #[error("Internal error: {0}")]
    Internal(String),
}

// Required so Tauri can serialise the error and send it to the frontend.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

// ── Convenience From impls ────────────────────────────────────────────────────

impl From<jsonwebtoken::errors::Error> for AppError {
    fn from(e: jsonwebtoken::errors::Error) -> Self {
        AppError::Token(e.to_string())
    }
}

impl From<bcrypt::BcryptError> for AppError {
    fn from(e: bcrypt::BcryptError) -> Self {
        AppError::Crypto(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::File(e.to_string())
    }
}
