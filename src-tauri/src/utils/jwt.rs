// ============================================================================
// JWT UTILITIES
// ============================================================================

use chrono::Utc;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use crate::{error::{AppError, AppResult}, models::auth::Claims};

const ISSUER:          &str = "quantum-pos";
const ACCESS_EXPIRY:   i64  = 7 * 24 * 3600;   // 7 days (seconds)
const REFRESH_EXPIRY:  i64  = 14 * 24 * 3600;  // 14 days

/// Encode a standard access-token JWT from the given Claims fields.
pub fn encode_access_token(
    user_id:   i32,
    username:  &str,
    email:     &str,
    role_id:   i32,
    role_slug: &str,
    store_id:  Option<i32>,
    is_global: bool,
    secret:    &str,
) -> AppResult<String> {
    let now = Utc::now().timestamp() as usize;
    let claims = Claims {
        sub:       user_id.to_string(),
        user_id,
        username:  username.to_string(),
        email:     email.to_string(),
        role_id,
        role_slug: role_slug.to_string(),
        store_id,
        is_global,
        iat:       now,
        exp:       (now as i64 + ACCESS_EXPIRY) as usize,
        iss:       ISSUER.to_string(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(AppError::from)
}

/// Encode a refresh token (minimal claims).
pub fn encode_refresh_token(user_id: i32, secret: &str) -> AppResult<String> {
    let now = Utc::now().timestamp() as usize;
    let claims = Claims {
        sub:       user_id.to_string(),
        user_id,
        username:  String::new(),
        email:     String::new(),
        role_id:   0,
        role_slug: "refresh".to_string(),
        store_id:  None,
        is_global: false,
        iat:       now,
        exp:       (now as i64 + REFRESH_EXPIRY) as usize,
        iss:       ISSUER.to_string(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(AppError::from)
}

/// Create a short-lived token for PIN-based POS session unlock.
/// `expiry` is the absolute expiry time as a DateTime<Utc>.
pub fn create_token(
    user_id:  i32,
    username: &str,
    expiry:   chrono::DateTime<chrono::Utc>,
    secret:   &str,
) -> AppResult<String> {
    let now = Utc::now().timestamp() as usize;
    let claims = Claims {
        sub:       user_id.to_string(),
        user_id,
        username:  username.to_string(),
        email:     String::new(),
        role_id:   0,
        role_slug: "pin_session".to_string(),
        store_id:  None,
        is_global: false,
        iat:       now,
        exp:       expiry.timestamp() as usize,
        iss:       ISSUER.to_string(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(AppError::from)
}

/// Decode and validate a JWT. Returns Claims on success.
pub fn decode_token(token: &str, secret: &str) -> AppResult<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[ISSUER]);

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|e| AppError::Token(e.to_string()))
}

/// Returns how many seconds until expiry the new access token has.
pub fn access_expiry_secs() -> i64 {
    ACCESS_EXPIRY
}
