// ============================================================================
// features/shifts/useShifts.js — React Query data hook for shift history
// ============================================================================
// Wraps paginated shift queries and shift-level mutations (cancel, reconcile).
// Active shift state lives in shift.store.js (Zustand) — this hook is for
// shift *history* and detail queries, not the live running shift.
// ============================================================================

import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useBranchStore } from "@/stores/branch.store";
import {
  getShifts,
  getShift,
  getStoreActiveShifts,
  cancelShift,
  reconcileShift,
  getShiftDetailStats,
} from "@/commands/shifts";
import { getShiftSummary, getCashMovements } from "@/commands/cash_movements";
import { PAGE_SIZE } from "@/lib/constants";

// ── Shift history list ────────────────────────────────────────────────────────

export function useShiftHistory({
  page = 1,
  tabKey = "all",
  search = "",
  storeIdOverride,
} = {}) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  // Map tab keys to backend filter params
  const tabParams = useMemo(() => {
    if (tabKey === "in_progress") return { is_active_only: true };
    if (tabKey === "closed")      return { status: "closed" };
    return {};
  }, [tabKey]);

  const queryKey = ["shifts", storeId, page, tabKey, search];

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => getShifts({
      store_id: storeId,
      page,
      limit:    PAGE_SIZE,
      search:   search || undefined,
      ...tabParams,
    }),
    enabled:          !!storeId,
    keepPreviousData: true,
    staleTime:        0,
    refetchOnMount:   true,
  });

  const rows  = useMemo(() => data?.data  ?? [], [data]);
  const total = data?.total ?? 0;

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["shifts"] }),
    [qc],
  );

  const cancel = useMutation({
    mutationFn: (shiftId) => cancelShift(shiftId),
    onSuccess:  invalidate,
  });

  const reconcile = useMutation({
    mutationFn: ({ shiftId, notes }) => reconcileShift(shiftId, notes),
    onSuccess:  invalidate,
  });

  return {
    storeId,
    rows,
    total,
    isLoading,
    isFetching,
    error: error ?? null,
    invalidate,
    cancel,
    reconcile,
  };
}

// ── Single shift detail ───────────────────────────────────────────────────────

export function useShiftDetail(shiftId) {
  const shiftQ = useQuery({
    queryKey: ["shift", shiftId],
    queryFn:  () => getShift(shiftId),
    enabled:  !!shiftId,
    staleTime: 60_000,
  });

  const summaryQ = useQuery({
    queryKey: ["shift-summary", shiftId],
    queryFn:  () => getShiftSummary(shiftId),
    enabled:  !!shiftId,
    staleTime: 0,
  });

  const movementsQ = useQuery({
    queryKey:        ["cash-movements", shiftId],
    queryFn:         () => getCashMovements(shiftId),
    enabled:         !!shiftId,
    refetchInterval: shiftQ.data?.status !== "closed" ? 30_000 : false,
    staleTime:       0,
  });

  const statsQ = useQuery({
    queryKey: ["shift-stats", shiftId],
    queryFn:  () => getShiftDetailStats(shiftId),
    enabled:  !!shiftId,
    staleTime: 5 * 60_000,
  });

  return {
    shift:        shiftQ.data      ?? null,
    summary:      summaryQ.data    ?? null,
    movements:    useMemo(() => movementsQ.data ?? [], [movementsQ.data]),
    stats:        statsQ.data      ?? null,
    isLoading:    shiftQ.isLoading,
    summaryLoading:   summaryQ.isLoading,
    movementsLoading: movementsQ.isLoading,
    statsLoading:     statsQ.isLoading,
    error: shiftQ.error ?? null,
  };
}

// ── Store-wide active shifts (global users) ───────────────────────────────────

export function useStoreActiveShifts(storeIdOverride) {
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  const { data, isLoading } = useQuery({
    queryKey:        ["store-active-shifts", storeId],
    queryFn:         () => getStoreActiveShifts(storeId),
    enabled:         !!storeId,
    refetchInterval: 30_000,
    staleTime:       0,
  });

  const shifts = useMemo(() => data ?? [], [data]);

  const storeTotalSales = useMemo(
    () => shifts.reduce((s, sh) => s + parseFloat(sh.total_sales ?? 0), 0),
    [shifts],
  );
  const storeTotalTxns = useMemo(
    () => shifts.reduce((s, sh) => s + (sh.transaction_count ?? 0), 0),
    [shifts],
  );

  return { storeId, shifts, isLoading, storeTotalSales, storeTotalTxns };
}
