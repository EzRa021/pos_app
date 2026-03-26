// ============================================================================
// AUTH MODELS
// ============================================================================
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

// ── Request DTOs ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password:     String,
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct TokenPair {
    pub access_token:  String,
    pub refresh_token: String,
    pub expires_in:    i64, // seconds
    pub user:          AuthUser,
}

#[derive(Debug, Serialize, Clone)]
pub struct AuthUser {
    pub id:         i32,
    pub username:   String,
    pub email:      String,
    pub first_name: String,
    pub last_name:  String,
    pub role_id:    i32,
    pub role_slug:  String,
    pub role_name:  String,
    pub store_id:   Option<i32>,
    pub is_global:  bool,
    pub is_active:  bool,
}

// ── JWT Claims ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub:       String,        // user_id as string
    pub user_id:   i32,
    pub username:  String,
    pub email:     String,
    pub role_id:   i32,
    pub role_slug: String,
    pub store_id:  Option<i32>,
    pub is_global: bool,
    pub exp:       usize,
    pub iat:       usize,
    pub iss:       String,
}

// ── DB Row ────────────────────────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
pub struct UserAuthRow {
    pub id:              i32,
    pub username:        String,
    pub email:           String,
    pub password_hash:   String,
    pub first_name:      String,
    pub last_name:       String,
    pub role_id:         i32,
    pub role_slug:       String,
    pub role_name:       String,
    pub store_id:        Option<i32>,
    pub is_global:       bool,
    pub is_active:       bool,
    pub failed_login_attempts: i32,
    pub locked_until:    Option<DateTime<Utc>>,
}
