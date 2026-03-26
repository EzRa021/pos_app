// ============================================================================
// lib/toast.js — Centralized toast utility for Quantum POS
// ============================================================================
// All toast calls across the app flow through this module.
// • toastSuccess / toastInfo / toastWarn  — 4 500 ms
// • toastError                            — 7 000 ms (user needs time to read)
// • onMutationError(title, err)           — normalizes any error shape → toast
//
// Usage in mutation hooks:
//   import { toastSuccess, onMutationError } from "@/lib/toast";
//
//   onSuccess: (data) => toastSuccess("Item Added", `"${data.name}" is ready for sale.`),
//   onError:   (e)    => onMutationError("Couldn't Add Item", e),
// ============================================================================

import { toast } from "sonner";

// ── Error extractor ──────────────────────────────────────────────────────────
// Handles every error shape our stack produces:
//   • Plain strings    (Axios interceptor rejects with strings)
//   • Error objects    (standard JS errors)
//   • Axios responses  (error.response.data.message / .error)
//   • Unknown objects  (last resort stringify)
export function extractErrorMessage(
  err,
  fallback = "Something went wrong. Please try again.",
) {
  if (!err) return fallback;
  if (typeof err === "string" && err.trim()) {
    // Strip "RPC error:" prefix that some commands prepend
    return err.replace(/^rpc error:\s*/i, "").trim();
  }
  if (err?.response?.data?.message) return err.response.data.message;
  if (err?.response?.data?.error)   return err.response.data.error;
  if (err?.message)                 return err.message;
  try { return JSON.stringify(err); } catch { return fallback; }
}

// ── Base helpers ─────────────────────────────────────────────────────────────

/** Green success toast. */
export function toastSuccess(title, description) {
  toast.success(title, { description, duration: 4500 });
}

/** Red error toast — stays longer so the user can read. */
export function toastError(title, description) {
  toast.error(title, { description, duration: 7000 });
}

/** Blue info toast. */
export function toastInfo(title, description) {
  toast.info(title, { description, duration: 4500 });
}

/** Amber warning toast. */
export function toastWarn(title, description) {
  toast.warning(title, { description, duration: 5000 });
}

// ── Mutation error handler ───────────────────────────────────────────────────
/**
 * Normalises `err` and shows a red toast.
 *
 * @param {string} title   — Short, action-oriented title  e.g. "Couldn't Add Item"
 * @param {*}      err     — Anything thrown by a mutation
 * @param {string} [fallback] — Optional custom fallback description
 */
export function onMutationError(title, err, fallback) {
  toastError(title, extractErrorMessage(err, fallback));
}
