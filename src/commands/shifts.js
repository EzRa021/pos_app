// commands/shifts.js — Shift management
// Field names match src-tauri/src/models/shift.rs exactly.
// Mirrors quantum-pos-app shift.service.js API surface.
import { rpc } from "@/lib/apiClient";

// ── Shift lifecycle ───────────────────────────────────────────────────────────

// OpenShiftDto: { store_id, opening_float, terminal_id?, opening_notes? }
export const openShift = (storeId, openingFloat = 0, options = {}) =>
  rpc("open_shift", {
    store_id:      storeId,
    opening_float: openingFloat,
    terminal_id:   options.terminalId  ?? null,
    opening_notes: options.openingNotes ?? null,
  });

// Cancel own open shift — super_admin / global-role only
export const cancelShift = (shiftId) =>
  rpc("cancel_shift", { id: shiftId });

// CloseShiftDto: { actual_cash, closing_notes? }
export const closeShift = (shiftId, actualCash, closingNotes = "") =>
  rpc("close_shift", {
    id:            shiftId,
    actual_cash:   actualCash,
    closing_notes: closingNotes || null,
  });

// SuspendShiftDto: { reason? }  — params are flat, not nested
export const suspendShift = (shiftId, reason = "") =>
  rpc("suspend_shift", { id: shiftId, reason: reason || undefined });

export const resumeShift = (shiftId) =>
  rpc("resume_shift", { id: shiftId });

// ── Queries ───────────────────────────────────────────────────────────────────

export const getActiveShift = (storeId) =>
  rpc("get_active_shift", { store_id: storeId });

// ShiftFilters: { store_id?, cashier_id?, status?, date_from?, date_to?, page?, limit? }
export const getShifts = (params = {}) =>
  rpc("get_shifts", params);

export const getShift = (id) =>
  rpc("get_shift", { id });

// Returns all active (open/active/suspended) shifts for a store.
// Global users see ALL cashiers. Non-global users see only their own.
export const getStoreActiveShifts = (storeId) =>
  rpc("get_store_active_shifts", { store_id: storeId });

// ── Reconciliation ────────────────────────────────────────────────────────────

export const reconcileShift = (shiftId, notes = "") =>
  rpc("reconcile_shift", { id: shiftId, notes: notes || null });

// Returns items sold, top item, unique customers, credit sales for a shift.
// These are computed on-demand from transaction_items — not stored on the shift row.
export const getShiftDetailStats = (shiftId) =>
  rpc("get_shift_detail_stats", { shift_id: shiftId });
