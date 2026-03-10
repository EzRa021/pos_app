// ============================================================================
// stores/shift.store.js — Active shift state
// ============================================================================
// Field names match src-tauri/src/models/shift.rs exactly:
//   Shift { id, store_id, opened_by, cashier_name?, opening_float,
//           actual_cash?, expected_cash?, cash_difference?,
//           total_sales?, total_returns?, return_count?,
//           opening_notes?, closing_notes?, status, opened_at, closed_at? }
//
// Mirrors quantum-pos-app shift.service.js:
//   openShift  → opening_float (was opening_balance)
//   closeShift → actual_cash   (was closing_balance)
//   total_returns              (was total_refunds)
//
// Lifecycle:
//   initForStore is called by branch.store after the active store resolves.
//   It is NOT called from a React useEffect — that pattern caused the
//   forceStoreRerender crash. All store-to-store orchestration is done
//   directly via getState() inside async store actions.
// ============================================================================

import { create } from "zustand";
import { rpc }    from "@/lib/apiClient";
import { SHIFT_STATUS, isActiveShiftStatus } from "@/lib/constants";

export const useShiftStore = create((set, get) => ({
  activeShift: null,
  isLoading:   false,
  error:       null,

  // ── Load active shift for a store ─────────────────────────────────────────
  // Called by branch.store.initForUser and setActiveStore.
  // Clears the previous shift immediately so stale data never shows.
  async initForStore(storeId) {
    if (!storeId) {
      set({ activeShift: null, isLoading: false, error: null });
      return;
    }
    // Clear previous shift while loading — don't leave stale data visible.
    set({ activeShift: null, isLoading: true, error: null });
    try {
      const shift = await rpc("get_active_shift", { store_id: storeId });
      set({ activeShift: shift ?? null, isLoading: false });
    } catch (err) {
      const msg = typeof err === "string" ? err : "Failed to load active shift";
      console.error("[shift.store] initForStore failed:", err);
      set({ activeShift: null, isLoading: false, error: msg });
    }
  },

  setActiveShift(shift) {
    set({ activeShift: shift ?? null });
  },

  // ── Open shift ────────────────────────────────────────────────────────────
  // OpenShiftDto: { store_id, opening_float, terminal_id?, opening_notes? }
  async openShift({ storeId, openingFloat = 0, notes = "" }) {
    set({ isLoading: true, error: null });
    try {
      const shift = await rpc("open_shift", {
        store_id:      storeId,
        opening_float: openingFloat,
        opening_notes: notes || undefined,
      });
      set({ activeShift: shift, isLoading: false });
      return shift;
    } catch (err) {
      const msg = typeof err === "string" ? err : "Failed to open shift";
      set({ error: msg, isLoading: false });
      throw msg;
    }
  },

  // ── Close shift ───────────────────────────────────────────────────────────
  // CloseShiftDto: { actual_cash, closing_notes? }
  async closeShift({ actualCash, notes = "" }) {
    const { activeShift } = get();
    if (!activeShift) throw "No active shift to close";

    set({ isLoading: true, error: null });
    try {
      const shift = await rpc("close_shift", {
        id:            activeShift.id,
        actual_cash:   actualCash,
        closing_notes: notes || undefined,
      });
      set({ activeShift: null, isLoading: false });
      return shift;
    } catch (err) {
      const msg = typeof err === "string" ? err : "Failed to close shift";
      set({ error: msg, isLoading: false });
      throw msg;
    }
  },

  isShiftOpen() {
    // Covers open, active, and suspended — all mean the shift is still running.
    return isActiveShiftStatus(get().activeShift?.status);
  },

  reset() {
    set({ activeShift: null, isLoading: false, error: null });
  },

  clearError() {
    set({ error: null });
  },
}));
