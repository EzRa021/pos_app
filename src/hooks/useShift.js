// ============================================================================
// hooks/useShift.js — Active shift access + derived values
// ============================================================================
import { useShiftStore }      from "@/stores/shift.store";
import { useBranchStore }     from "@/stores/branch.store";
import { isActiveShiftStatus } from "@/lib/constants";

/**
 * Compute a human-readable shift number from the shift's id and opened_at date.
 * Format: SH-YYYYMMDD-NNN  (e.g. SH-20250305-042)
 * This is a display-only value — no DB column required.
 */
function computeShiftNumber(shift) {
  if (!shift) return null;
  const date = new Date(shift.opened_at)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const seq = String(shift.id).padStart(3, "0");
  return `SH-${date}-${seq}`;
}

export function useShift() {
  const activeShift  = useShiftStore((s) => s.activeShift);
  const isLoading    = useShiftStore((s) => s.isLoading);
  const error        = useShiftStore((s) => s.error);

  const openShiftAction  = useShiftStore((s) => s.openShift);
  const closeShiftAction = useShiftStore((s) => s.closeShift);
  const initForStore     = useShiftStore((s) => s.initForStore);
  const clearError       = useShiftStore((s) => s.clearError);

  const storeId = useBranchStore((s) => s.activeStore?.id ?? null);

  // A shift is "open" if it exists and is not yet closed.
  // Status can be "open" (no sales yet), "active" (first sale made),
  // or "suspended" — all three mean the shift is still in progress.
  const isShiftOpen = isActiveShiftStatus(activeShift?.status);

  async function openShift(openingBalance = 0, notes = "") {
    if (!storeId) throw "No active store selected";
    return openShiftAction({ storeId, openingBalance, notes });
  }

  async function closeShift(closingBalance, notes = "") {
    return closeShiftAction({ closingBalance, notes });
  }

  async function reload() {
    if (storeId) await initForStore(storeId);
  }

  return {
    activeShift,
    isLoading,
    error,
    isShiftOpen,
    storeId,

    // Derived — uses correct backend field names
    shiftId:         activeShift?.id              ?? null,
    shiftNumber:     computeShiftNumber(activeShift),
    openedAt:        activeShift?.opened_at       ?? null,
    cashierName:     activeShift?.cashier_name    ?? null,
    openingBalance:  activeShift?.opening_balance ?? 0,
    shiftNotes:      activeShift?.notes           ?? null,

    openShift,
    closeShift,
    reload,
    clearError,
  };
}
