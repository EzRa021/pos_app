// ============================================================================
// CRYPTO UTILITIES
// ============================================================================

use rand::Rng;
use sha2::{Sha256, Digest};
use crate::error::{AppError, AppResult};

const BCRYPT_COST: u32 = 10;

/// Hash a plain-text password.
pub fn hash_password(plain: &str) -> AppResult<String> {
    bcrypt::hash(plain, BCRYPT_COST).map_err(AppError::from)
}

/// Verify a plain-text password against a stored hash.
pub fn verify_password(plain: &str, hash: &str) -> AppResult<bool> {
    bcrypt::verify(plain, hash).map_err(AppError::from)
}

/// Generate a secure random hex token (64 chars = 32 bytes).
pub fn random_token() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    hex::encode(bytes)
}

/// SHA-256 hex digest of a string (used for checksums, non-auth purposes).
pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

/// Hash a string (token, etc.) for session storage lookups.
/// Alias for sha256_hex.
pub fn hash_string(s: &str) -> String {
    sha256_hex(s)
}

/// Validate password strength.
pub fn validate_password(password: &str) -> Result<(), String> {
    if password.len() < 8 {
        return Err("Password must be at least 8 characters".to_string());
    }
    if !password.chars().any(|c| c.is_uppercase()) {
        return Err("Password must contain at least one uppercase letter".to_string());
    }
    if !password.chars().any(|c| c.is_lowercase()) {
        return Err("Password must contain at least one lowercase letter".to_string());
    }
    if !password.chars().any(|c| c.is_ascii_digit()) {
        return Err("Password must contain at least one digit".to_string());
    }
    Ok(())
}
