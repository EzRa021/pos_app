// ============================================================================
// ERROR TYPES
// ============================================================================
// Centralised error enum that converts into Tauri InvokeError (serialised as
// a JSON string so the frontend can read the message).
// ============================================================================

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    // ── Database ──────────────────────────────────────────────────────────────
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Database not connected. Please configure the database first.")]
    NotConnected,

    // ── Auth ──────────────────────────────────────────────────────────────────
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
