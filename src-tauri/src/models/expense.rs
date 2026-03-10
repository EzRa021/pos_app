// ============================================================================
// EXPENSE MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct Expense {
    pub id:               i32,
    pub store_id:         i32,
    pub category:         String,
    pub expense_type:     Option<String>,
    pub description:      String,
    pub amount:           Decimal,
    pub paid_to:          Option<String>,
    pub payment_method:   String,
    pub reference:        Option<String>,
    pub reference_number: Option<String>,
    pub reference_type:   Option<String>,
    pub reference_id:     Option<i32>,
    pub expense_date:     DateTime<Utc>,
    pub recorded_by:      i32,
    pub approved_by:      Option<i32>,
    pub approved_at:      Option<DateTime<Utc>>,
    pub status:           String,
    pub approval_status:  Option<String>,
    pub payment_status:   Option<String>,
    pub is_recurring:     Option<bool>,
    pub is_deductible:    Option<bool>,
    pub notes:            Option<String>,
    pub deleted_at:       Option<DateTime<Utc>>,
    pub created_at:       DateTime<Utc>,
    pub updated_at:       Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateExpenseDto {
    pub store_id:         i32,
    pub category:         String,
    pub expense_type:     Option<String>,
    pub description:      String,
    pub amount:           f64,
    pub paid_to:          Option<String>,
    pub payment_method:   String,
    pub reference:        Option<String>,
    pub reference_number: Option<String>,
    pub reference_type:   Option<String>,
    pub reference_id:     Option<i32>,
    pub expense_date:     Option<String>,
    pub payment_status:   Option<String>,
    pub is_recurring:     Option<bool>,
    pub is_deductible:    Option<bool>,
    pub approval_status:  Option<String>,
    pub notes:            Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateExpenseDto {
    pub category:         Option<String>,
    pub expense_type:     Option<String>,
    pub description:      Option<String>,
    pub amount:           Option<f64>,
    pub paid_to:          Option<String>,
    pub payment_method:   Option<String>,
    pub reference:        Option<String>,
    pub reference_number: Option<String>,
    pub expense_date:     Option<String>,
    pub payment_status:   Option<String>,
    pub is_recurring:     Option<bool>,
    pub is_deductible:    Option<bool>,
    pub notes:            Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExpenseFilters {
    pub page:            Option<i64>,
    pub limit:           Option<i64>,
    pub store_id:        Option<i32>,
    pub category:        Option<String>,
    pub expense_type:    Option<String>,
    pub status:          Option<String>,
    pub approval_status: Option<String>,
    pub payment_status:  Option<String>,
    pub date_from:       Option<String>,
    pub date_to:         Option<String>,
}
