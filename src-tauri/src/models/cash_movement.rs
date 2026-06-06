// ============================================================================
// CASH MOVEMENT MODELS
// ============================================================================
// NOTE: The canonical CashMovement, ShiftSummary, and CreateCashMovementDto
//       types now live in models/shift.rs (aligned with quantum-pos-app).
//       This file retains only CashDrawerEvent, which is used exclusively by
//       commands/cash_movements.rs (log_drawer_event standalone command).
//
// Schema alignment:
//   cash_drawer_events — migration 0030 added `user_id` as the canonical
//   column; `created_by` is kept for backwards compat but new rows insert
//   into `user_id`. SELECT uses COALESCE(user_id, created_by) to handle both.
// ============================================================================
#![allow(dead_code)]

use serde::Serialize;
use chrono::{DateTime, Utc};

/// Mirrors the cash_drawer_events table.
/// `user_id` is the canonical author column (added migration 0030).
/// Old rows written before migration 0030 have user_id = NULL but created_by set;
/// COALESCE(user_id, created_by) in the SELECT handles both cases.
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct CashDrawerEvent {
    pub id:         i32,
    pub shift_id:   i32,
    pub event_type: String,
    pub notes:      Option<String>,
    /// Canonical author — COALESCE(user_id, created_by) from DB
    pub user_id:    Option<i32>,
    pub created_at: DateTime<Utc>,
}
