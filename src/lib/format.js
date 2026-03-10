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
