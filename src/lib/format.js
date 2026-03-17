// ============================================================================
// lib/format.js — Display formatting utilities
// ============================================================================
// Pure functions — no React, no Tauri, no side effects.
// Import anywhere: components, stores, hooks, command wrappers.
//
// FINANCIAL VALUES:
//   The Rust backend returns Decimal as strings ("1500.0000").
//   Always call parseFloat() before passing to these functions.
//   Never do arithmetic on raw strings.
// ============================================================================

// ── Currency ──────────────────────────────────────────────────────────────────
// Formats a number as Nigerian Naira.
// Usage: formatCurrency(parseFloat(item.price))  → "₦1,500.00"
export function formatCurrency(value, options = {}) {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return "₦0.00";

  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: options.decimals ?? 2,
    maximumFractionDigits: options.decimals ?? 2,
    ...options,
  }).format(num);
}

// Compact version for tight spaces: "₦1.5K", "₦2.3M"
export function formatCurrencyCompact(value) {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return "₦0";
  if (Math.abs(num) >= 1_000_000)
    return "₦" + (num / 1_000_000).toFixed(1) + "M";
  if (Math.abs(num) >= 1_000)
    return "₦" + (num / 1_000).toFixed(1) + "K";
  return "₦" + num.toFixed(0);
}

// ── Numbers ───────────────────────────────────────────────────────────────────
// Formats a decimal/quantity string from Rust to a display number.
// "1500.0000" → "1,500" or "1,500.50" (trims trailing zeros)
export function formatDecimal(value, maxDecimals = 2) {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(num);
}

// ── Measurement Utilities ─────────────────────────────────────────────────────

/**
 * Returns the canonical singular unit label for an item.
 *
 * Priority: explicit unit_type from DB → sensible default from measurement_type.
 *
 * Examples:
 *   unitLabel("weight", "kg")       → "kg"
 *   unitLabel("quantity", "piece")  → "piece"
 *   unitLabel("quantity", null)     → "pcs"
 *   unitLabel("weight", null)       → "kg"
 */
export function unitLabel(measurementType, unitType) {
  if (unitType && String(unitType).trim()) return String(unitType).trim();
  switch (measurementType) {
    case "weight":  return "kg";
    case "volume":  return "L";
    case "length":  return "m";
    case "quantity":
    default:        return "pcs";
  }
}

/**
 * Human-readable label for a measurement type enum value.
 *
 * measurementTypeLabel("weight")   → "Weight"
 * measurementTypeLabel("quantity") → "Quantity"
 */
export function measurementTypeLabel(measurementType) {
  switch (measurementType) {
    case "weight":   return "Weight";
    case "volume":   return "Volume";
    case "length":   return "Length";
    case "quantity":
    default:         return "Quantity";
  }
}

/**
 * Formats a raw numeric quantity with the appropriate precision and unit suffix.
 *
 * * quantity items  → whole number, "pcs" suffix (or unit_type)
 * * weight/volume/length → up to 3 decimal places, unit suffix
 *
 * Examples:
 *   formatQuantity(5,     "quantity", "piece") → "5 piece"
 *   formatQuantity(2.5,   "weight",  "kg")    → "2.500 kg"
 *   formatQuantity(1.2,   "volume",  "litre") → "1.200 litre"
 *   formatQuantity(0,     "quantity", null)   → "0 pcs"
 */
export function formatQuantity(value, measurementType, unitType) {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return `0 ${unitLabel(measurementType, unitType)}`;

  const unit = unitLabel(measurementType, unitType);

  switch (measurementType) {
    case "weight":
    case "volume":
    case "length":
      return `${num.toFixed(3).replace(/\.?0+$/, "")} ${unit}`;
    case "quantity":
    default:
      return `${Math.round(num).toLocaleString("en-NG")} ${unit}`;
  }
}

/**
 * Formats "price per unit" for display on product tiles, cart rows, and receipts.
 *
 * Examples:
 *   formatPricePerUnit(500, "quantity", "piece") → "₦500.00 / piece"
 *   formatPricePerUnit(2500, "weight",  "kg")   → "₦2,500.00 / kg"
 *   formatPricePerUnit(150, "volume",  "litre") → "₦150.00 / litre"
 */
export function formatPricePerUnit(price, measurementType, unitType) {
  const unit = unitLabel(measurementType, unitType);
  return `${formatCurrency(price)} / ${unit}`;
}

/**
 * Returns the appropriate stepper increment for a given measurement type.
 * Used in cart qty inputs, restock dialogs, stock count dialogs.
 *
 *   stepForType("quantity") → 1
 *   stepForType("weight")   → 0.001
 *   stepForType("volume")   → 0.001
 *   stepForType("length")   → 0.001
 *
 * If the item has a `min_increment` setting, pass it as `override`.
 */
export function stepForType(measurementType, override = null) {
  // Always parse to a number — min_increment from the Rust backend is a
  // Decimal that serialises as a string (e.g. "5.0000"). Returning the raw
  // string causes `qty + step` to become string concatenation in JS.
  if (override != null) {
    const n = parseFloat(override);
    if (n > 0) return n;
  }
  switch (measurementType) {
    case "weight":
    case "volume":
    case "length":  return 0.001;
    case "quantity":
    default:        return 1;
  }
}

/**
 * Determines the number of decimal places to display for a given measurement type.
 *
 *   decimalsForType("quantity") → 0
 *   decimalsForType("weight")   → 3
 */
export function decimalsForType(measurementType) {
  switch (measurementType) {
    case "weight":
    case "volume":
    case "length":  return 3;
    case "quantity":
    default:        return 0;
  }
}

// ── Dates & times ─────────────────────────────────────────────────────────────
// ISO timestamp → "Mar 2, 2026"
export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ISO timestamp → "Mar 2, 2026, 10:45 AM"
export function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ISO timestamp → "10:45 AM"
export function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Duration between two ISO timestamps → "2h 15m"
export function formatDuration(startIso, endIso) {
  if (!startIso) return "—";
  const start = new Date(startIso).getTime();
  const end   = endIso ? new Date(endIso).getTime() : Date.now();
  const mins  = Math.floor((end - start) / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Reference numbers ─────────────────────────────────────────────────────────
// Formats backend reference strings for display.
// "TXN-000042" → "TXN-000042" (pass-through, backend already formats)
// Null-safe fallback.
export function formatRef(ref) {
  return ref ?? "—";
}

// ── Phone numbers ─────────────────────────────────────────────────────────────
// Displays a phone number or "—" if empty.
export function formatPhone(phone) {
  return phone?.trim() || "—";
}

// ── Names ─────────────────────────────────────────────────────────────────────
// Builds a full name from first + last, falls back to username.
export function formatName(user) {
  if (!user) return "—";
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username || "—";
}

// ── Status strings ────────────────────────────────────────────────────────────
// Converts snake_case status values to Title Case for display.
// "partially_paid" → "Partially Paid"
export function formatStatus(status) {
  if (!status) return "—";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
