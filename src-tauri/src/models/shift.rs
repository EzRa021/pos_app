// ============================================================================
// SHIFT MODELS
// ============================================================================
// Mirrors quantum-pos-app shift.service.js logic:
//   - shift_number generated as SH-YYYYMMDD-NNN
//   - opening_float (was opening_balance)
//   - actual_cash / expected_cash / cash_difference on close
//   - status: open → active (on first sale) → closed | suspended
//   - payment-method breakdown: total_cash_sales, total_card_sales, etc.
//   - total_cash_in / total_cash_out updated by cash movements
//   - total_returns / return_count updated by refunds
//   - Cash movements: deposit | withdrawal | payout
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

// ── Shift ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Shift {
    pub id:                 i32,
    pub shift_number:       String,
    pub store_id:           i32,
    pub terminal_id:        Option<String>,
    /// User who opened the shift (was cashier_id)
    pub opened_by:          i32,
    pub cashier_name:       Option<String>,
    /// Cash in drawer at start (was opening_balance)
    pub opening_float:      Decimal,
    /// Cash actually counted at close (was closing_balance)
    pub actual_cash:        Option<Decimal>,
    /// Computed: opening_float + total_cash_sales + total_cash_in − total_cash_out − total_returns
    pub expected_cash:      Option<Decimal>,
    /// actual_cash − expected_cash (negative = short, positive = over)
    pub cash_difference:    Option<Decimal>,
    // ── Sales totals ──────────────────────────────────────────────────────────
    pub total_sales:        Option<Decimal>,
    pub total_cash_sales:   Option<Decimal>,
    pub total_card_sales:   Option<Decimal>,
    pub total_transfers:    Option<Decimal>,
    pub total_mobile_sales: Option<Decimal>,
    pub transaction_count:  Option<i64>,
    // ── Cash movement totals ──────────────────────────────────────────────────
    pub total_cash_in:      Option<Decimal>,   // deposits added to drawer
    pub total_cash_out:     Option<Decimal>,   // withdrawals + payouts removed
    // ── Return totals ─────────────────────────────────────────────────────────
    pub total_returns:      Option<Decimal>,   // was total_refunds
    pub return_count:       Option<i64>,
    // ── Reconciliation ────────────────────────────────────────────────────────
    pub reconciled:         Option<bool>,
    pub reconciled_by:      Option<i32>,
    pub reconciled_at:      Option<DateTime<Utc>>,
    pub discrepancy_notes:  Option<String>,
    // ── Notes ─────────────────────────────────────────────────────────────────
    pub opening_notes:      Option<String>,
    pub closing_notes:      Option<String>,
    // ── Lifecycle ─────────────────────────────────────────────────────────────
    pub status:             String,   // open | active | suspended | closed
    pub opened_at:          DateTime<Utc>,
    pub closed_at:          Option<DateTime<Utc>>,
    pub closed_by:          Option<i32>,
}

// ── Cash Movement ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct CashMovement {
    pub id:                i32,
    pub shift_id:          i32,
    pub movement_number:   Option<String>,  // nullable until first INSERT sets it
    /// "deposit" | "withdrawal" | "payout"
    pub movement_type:     String,
    pub amount:            Decimal,
    pub reason:            Option<String>,
    pub reference_number:  Option<String>,
    pub performed_by:      i32,
    pub created_at:        DateTime<Utc>,
}

// ── Shift Summary (for close-shift modal) ────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ShiftSummary {
    pub shift_id:          i32,
    pub opening_float:     Decimal,
    pub total_sales:       Decimal,
    pub total_returns:     Decimal,
    pub total_deposits:    Decimal,    // cash-in breakdown
    pub total_withdrawals: Decimal,    // cash-out breakdown
    pub total_payouts:     Decimal,    // cash-out breakdown
    /// opening_float + total_cash_sales + total_deposits − total_withdrawals − total_payouts − total_returns
    pub expected_balance:  Decimal,
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct OpenShiftDto {
    pub store_id:      i32,
    pub opening_float: f64,
    pub terminal_id:   Option<String>,
    pub opening_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CloseShiftDto {
    pub actual_cash:   f64,
    pub closing_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SuspendShiftDto {
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCashMovementDto {
    pub shift_id:         i32,
    /// "deposit" | "withdrawal" | "payout"
    pub movement_type:    String,
    pub amount:           f64,
    pub reason:           Option<String>,
    pub reference_number: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ShiftFilters {
    pub page:       Option<i64>,
    pub limit:      Option<i64>,
    pub store_id:   Option<i32>,
    pub cashier_id: Option<i32>,   // maps to opened_by
    pub status:     Option<String>,
    pub date_from:  Option<String>,
    pub date_to:    Option<String>,
}
