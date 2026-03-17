// ============================================================================
// utils/qty.rs — Measurement-type-aware quantity validation and rounding
// ============================================================================
//
// Rules enforced across ALL write paths (transactions, returns, restocks,
// adjustments, stock counts, purchase orders, stock transfers):
//
//   measurement_type = "quantity"
//     → Must be a whole number (no fractional part).
//       e.g. 3.0 is fine; 3.5 is rejected.
//
//   measurement_type = "weight" | "volume" | "length"
//     → Decimals are allowed; value is rounded to 3 decimal places.
//       e.g. 2.5678 → 2.568
//
// All callers should call `validate_qty(qty, measurement_type, item_name)`
// before writing any quantity to the database.
// ============================================================================

use rust_decimal::{Decimal, RoundingStrategy};
use crate::error::{AppError, AppResult};

/// Validate and normalise a quantity according to the item's measurement type.
///
/// * `qty`              — the raw incoming quantity (may have many decimals)
/// * `measurement_type` — "quantity" | "weight" | "volume" | "length"
/// * `item_name`        — used in user-facing error messages
///
/// Returns the validated (and possibly rounded) quantity, or an AppError::Validation.
pub fn validate_qty(qty: Decimal, measurement_type: &str, item_name: &str) -> AppResult<Decimal> {
    if qty <= Decimal::ZERO {
        return Err(AppError::Validation(format!(
            "Quantity for '{}' must be greater than zero",
            item_name
        )));
    }

    match measurement_type {
        "quantity" => {
            // Integer check: fractional part must be exactly zero.
            if qty.fract() != Decimal::ZERO {
                return Err(AppError::Validation(format!(
                    "'{}' is sold by piece/unit — fractional quantities are not allowed. \
                     Got: {}. Please enter a whole number.",
                    item_name, qty
                )));
            }
            Ok(qty)
        }
        "weight" | "volume" | "length" => {
            // Round to 3 decimal places (standard precision for these types).
            let rounded = qty.round_dp_with_strategy(3, RoundingStrategy::MidpointNearestEven);
            if rounded <= Decimal::ZERO {
                return Err(AppError::Validation(format!(
                    "Quantity for '{}' rounds to zero at 3 decimal places (got {}). \
                     Minimum is 0.001.",
                    item_name, qty
                )));
            }
            Ok(rounded)
        }
        // Unknown / null measurement type — fall back to lenient: accept as-is.
        _ => Ok(qty),
    }
}

/// Same as `validate_qty` but accepts an `Option<&str>` for measurement_type.
/// When None (e.g. legacy items without the column set), behaves leniently.
pub fn validate_qty_opt(
    qty: Decimal,
    measurement_type: Option<&str>,
    item_name: &str,
) -> AppResult<Decimal> {
    validate_qty(qty, measurement_type.unwrap_or(""), item_name)
}

/// Validate a *signed* adjustment quantity (can be negative, e.g. -5 for a loss).
///
/// Rules:
///   * Zero is rejected (a zero adjustment is a no-op and almost always a UI bug).
///   * For "quantity" items: the magnitude must be a whole number.
///   * For "weight"|"volume"|"length": the magnitude is rounded to 3 dp; the
///     sign is preserved on the rounded value.
///   * Unknown / null measurement_type: pass-through (lenient).
pub fn validate_qty_signed(qty: Decimal, measurement_type: &str, item_name: &str) -> AppResult<Decimal> {
    if qty == Decimal::ZERO {
        return Err(AppError::Validation(format!(
            "Adjustment quantity for '{}' must be non-zero",
            item_name
        )));
    }
    let abs = qty.abs();
    match measurement_type {
        "quantity" => {
            if abs.fract() != Decimal::ZERO {
                return Err(AppError::Validation(format!(
                    "'{}' is sold by piece/unit — fractional adjustments are not allowed. Got: {}.",
                    item_name, qty
                )));
            }
            Ok(qty)
        }
        "weight" | "volume" | "length" => {
            let rounded_abs = abs.round_dp_with_strategy(3, RoundingStrategy::MidpointNearestEven);
            if rounded_abs == Decimal::ZERO {
                return Err(AppError::Validation(format!(
                    "Adjustment for '{}' rounds to zero at 3 dp (got {}). Minimum is \u{00b1}0.001.",
                    item_name, qty
                )));
            }
            let sign = if qty < Decimal::ZERO { Decimal::NEGATIVE_ONE } else { Decimal::ONE };
            Ok(sign * rounded_abs)
        }
        _ => Ok(qty),
    }
}

/// Same as `validate_qty_signed` but accepts `Option<&str>` for measurement_type.
pub fn validate_qty_signed_opt(
    qty: Decimal,
    measurement_type: Option<&str>,
    item_name: &str,
) -> AppResult<Decimal> {
    validate_qty_signed(qty, measurement_type.unwrap_or(""), item_name)
}
