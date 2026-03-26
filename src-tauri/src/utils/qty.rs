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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    // ── validate_qty ──────────────────────────────────────────────────────────

    #[test]
    fn qty_rejects_zero() {
        assert!(validate_qty(dec!(0), "quantity", "Widget").is_err());
    }

    #[test]
    fn qty_rejects_negative() {
        assert!(validate_qty(dec!(-1), "quantity", "Widget").is_err());
    }

    #[test]
    fn qty_allows_whole_number_for_piece_type() {
        let result = validate_qty(dec!(5), "quantity", "Widget");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dec!(5));
    }

    #[test]
    fn qty_rejects_fractional_for_piece_type() {
        assert!(validate_qty(dec!(1.5), "quantity", "Widget").is_err());
    }

    #[test]
    fn qty_allows_decimal_for_weight() {
        let result = validate_qty(dec!(2.5), "weight", "Rice");
        assert!(result.is_ok());
    }

    #[test]
    fn qty_rounds_weight_to_3dp() {
        let result = validate_qty(dec!(1.23456), "weight", "Rice").unwrap();
        assert_eq!(result, dec!(1.235));
    }

    #[test]
    fn qty_allows_decimal_for_volume() {
        assert!(validate_qty(dec!(0.5), "volume", "Oil").is_ok());
    }

    #[test]
    fn qty_allows_decimal_for_length() {
        assert!(validate_qty(dec!(3.14), "length", "Wire").is_ok());
    }

    #[test]
    fn qty_unknown_type_passes_through() {
        let result = validate_qty(dec!(7.89), "other", "Mystery");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dec!(7.89));
    }

    // ── validate_qty_signed ───────────────────────────────────────────────────

    #[test]
    fn signed_rejects_zero() {
        assert!(validate_qty_signed(dec!(0), "quantity", "Widget").is_err());
    }

    #[test]
    fn signed_allows_negative_whole_number_for_piece_type() {
        let result = validate_qty_signed(dec!(-3), "quantity", "Widget");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dec!(-3));
    }

    #[test]
    fn signed_rejects_fractional_negative_for_piece_type() {
        assert!(validate_qty_signed(dec!(-1.5), "quantity", "Widget").is_err());
    }

    #[test]
    fn signed_rounds_negative_weight_and_preserves_sign() {
        let result = validate_qty_signed(dec!(-2.5678), "weight", "Grain").unwrap();
        assert_eq!(result, dec!(-2.568));
    }

    #[test]
    fn signed_rounds_positive_weight() {
        let result = validate_qty_signed(dec!(1.0004), "weight", "Grain").unwrap();
        assert_eq!(result, dec!(1.000));
    }

    #[test]
    fn signed_rejects_weight_that_rounds_to_zero() {
        // 0.0001 rounds to 0.000 at 3dp — must be rejected
        assert!(validate_qty_signed(dec!(0.0001), "weight", "Grain").is_err());
    }
}
