// ============================================================================
// FX RATES MODELS
// ============================================================================

use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use chrono::{DateTime, NaiveDate, Utc};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ExchangeRate {
    pub id:             i32,
    pub from_currency:  String,
    pub to_currency:    String,
    pub rate:           Decimal,
    pub effective_date: NaiveDate,
    pub set_by:         Option<i32>,
    pub created_at:     DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ConversionResult {
    pub from_currency:  String,
    pub to_currency:    String,
    pub original:       Decimal,
    pub converted:      Decimal,
    pub rate:           Decimal,
    pub effective_date: NaiveDate,
}

#[derive(Debug, Deserialize)]
pub struct SetRateDto {
    pub from_currency:  String,
    pub to_currency:    String,
    pub rate:           f64,
    pub effective_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ConvertDto {
    pub amount:        f64,
    pub from_currency: String,
    pub to_currency:   String,
}
