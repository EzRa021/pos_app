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
//
// CURRENCY CONFIGURATION:
//   formatCurrency() reads from a module-level config set at startup.
//   Call setCurrencyConfig({ currency, locale }) once after the business
//   profile is loaded (done by useCurrencySetup in AppShell).
//   All existing call sites automatically pick up the configured currency —
//   no per-call changes needed.
// ============================================================================

// ── Currency config (module-level, set once at startup) ───────────────────────

/** Maps ISO currency codes to the best Intl locale for displaying them. */
const CURRENCY_LOCALE_MAP = {
  NGN: "en-NG",    // ₦ Nigerian Naira
  USD: "en-US",    // $ US Dollar
  GBP: "en-GB",    // £ British Pound
  EUR: "de-DE",    // € Euro
  GHS: "en-GH",    // ₵ Ghanaian Cedi
  KES: "en-KE",    // KSh Kenyan Shilling
  ZAR: "en-ZA",    // R South African Rand
};

let _currency = "NGN";
let _locale   = "en-NG";

/**
 * Configure the display currency for the entire app.
 * Called once from useCurrencySetup (AppShell) after the business profile loads.
 *
 * @param {{ currency?: string, locale?: string }} config
 */
export function setCurrencyConfig({ currency, locale } = {}) {
  if (currency) {
    _currency = currency.toUpperCase();
    // Auto-derive locale from the currency if none is explicitly provided
    _locale   = locale ?? CURRENCY_LOCALE_MAP[_currency] ?? "en-NG";
  } else if (locale) {
    _locale = locale;
  }
}

/** Returns the currently configured ISO currency code (e.g. "NGN"). */
export function getCurrencyCode() {
  return _currency;
}

// ── Currency ──────────────────────────────────────────────────────────────────

/**
 * Formats a number in the currently configured business currency.
 *
 * Usage:
 *   formatCurrency(parseFloat(item.price))                      → "₦1,500.00"
 *   formatCurrency(parseFloat(item.price), { decimals: 0 })     → "₦1,500"
 *   formatCurrency(price, { currency: "USD" })                  → "$price"
 *   formatCurrency(price, { minimumFractionDigits: 0,
 *                            maximumFractionDigits: 2 })         → fractional override
 *
 * Custom options (handled explicitly):
 *   currency  — ISO code, overrides the module-level _currency
 *   locale    — BCP 47 locale, overrides the auto-derived locale
 *   decimals  — shorthand: sets both min and max fraction digits
 *
 * All other keys are spread directly into Intl.NumberFormat options,
 * letting callers use any valid Intl option (notation, signDisplay, etc.)
 * and override minimumFractionDigits / maximumFractionDigits directly.
 */
export function formatCurrency(value, options = {}) {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return `${_currency} 0.00`;

  // Destructure our custom keys; everything else goes straight to Intl
  const { currency: currencyOpt, locale: localeOpt, decimals, ...intlOptions } = options;

  const currency      = currencyOpt ?? _currency;
  const locale        = localeOpt  ?? (currencyOpt
    ? (CURRENCY_LOCALE_MAP[currencyOpt.toUpperCase()] ?? _locale)
    : _locale);
  const fractionDigits = decimals ?? 2;

  return new Intl.NumberFormat(locale, {
    style:                 "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    // Caller can override fractionDigits or add any other Intl option here
    ...intlOptions,
  }).format(num);
}

/**
 * Compact version for tight spaces: "₦1.5K", "₦2.3M"
 * Uses the same currency symbol as formatCurrency.
 */
export function formatCurrencyCompact(value) {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return formatCurrency(0, { decimals: 0 });

  // Get just the symbol by formatting 0 and stripping the digits
  const symbolSample = new Intl.NumberFormat(_locale, {
    style: "currency", currency: _currency,
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(0);
  // Extract leading/trailing non-digit, non-space chars as the symbol
  const symbol = symbolSample.replace(/[\d,.\s]/g, "").trim() || _currency;

  if (Math.abs(num) >= 1_000_000)
    return symbol + (num / 1_000_000).toFixed(1) + "M";
  if (Math.abs(num) >= 1_000)
    return symbol + (num / 1_000).toFixed(1) + "K";
  return symbol + num.toFixed(0);
}

// ── Numbers ───────────────────────────────────────────────────────────────────

/**
 * Formats a decimal/quantity string from Rust to a display number.
 * "1500.0000" → "1,500" or "1,500.50" (trims trailing zeros)
 */
export function formatDecimal(value, maxDecimals = 2) {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat(_locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(num);
}

// ── Measurement Utilities ─────────────────────────────────────────────────────

/**
 * Returns the canonical singular unit label for an item.
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
 * Formats a raw numeric quantity with appropriate precision and unit suffix.
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
      return `${Math.round(num).toLocaleString(_locale)} ${unit}`;
  }
}

/**
 * Formats "price per unit" for display on product tiles, cart rows, and receipts.
 */
export function formatPricePerUnit(price, measurementType, unitType) {
  const unit = unitLabel(measurementType, unitType);
  return `${formatCurrency(price)} / ${unit}`;
}

/**
 * Returns the appropriate stepper increment for a given measurement type.
 */
export function stepForType(measurementType, override = null) {
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

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(_locale, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(_locale, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(_locale, {
    hour: "2-digit", minute: "2-digit",
  });
}

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

export function formatRef(ref) {
  return ref ?? "—";
}

// ── Phone numbers ─────────────────────────────────────────────────────────────

export function formatPhone(phone) {
  return phone?.trim() || "—";
}

// ── Names ─────────────────────────────────────────────────────────────────────

export function formatName(user) {
  if (!user) return "—";
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username || "—";
}

// ── Status strings ────────────────────────────────────────────────────────────

export function formatStatus(status) {
  if (!status) return "—";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
