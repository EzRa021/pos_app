// ============================================================================
// CASH MOVEMENT MODELS
// ============================================================================
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct CashMovement {
    pub id:            i32,
    pub shift_id:      i32,
    pub movement_type: String,   // deposit | withdrawal | payout | adjustment
    pub amount:        Decimal,
    pub reason:        String,
    pub reference:     Option<String>,
    pub created_by:    i32,
    pub created_at:    DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCashMovementDto {
    pub shift_id:      i32,
    pub movement_type: String,
    pub amount:        f64,
    pub reason:        String,
    pub reference:     Option<String>,
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct CashDrawerEvent {
    pub id:         i32,
    pub shift_id:   i32,
    pub event_type: String,  // opened | closed | cash_added | cash_removed | reconciled
    pub notes:      Option<String>,
    pub created_by: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ShiftSummary {
    pub shift_id:          i32,
    pub opening_balance:   Decimal,
    pub total_sales:       Decimal,
    pub total_refunds:     Decimal,
    pub total_deposits:    Decimal,
    pub total_withdrawals: Decimal,
    pub total_payouts:     Decimal,
    pub expected_balance:  Decimal,
    pub closing_balance:   Option<Decimal>,
    pub discrepancy:       Option<Decimal>,
}
