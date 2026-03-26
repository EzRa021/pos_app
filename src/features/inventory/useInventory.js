// ============================================================================
// features/inventory/useInventory.js
// ============================================================================

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getInventory, getInventoryItem, getInventorySummary,
  getLowStock, getMovementHistory,
  restockItem, adjustInventory,
  getStockCountStats,
  startCountSession, cancelCountSession,
  recordCount, completeCountSession,
  getCountSessions, getCountSession,
  getSessionCountItems,
  getInventoryForCount,
  getVarianceReport, applyVariancesStandalone,
} from "@/commands/inventory";
import { invalidateStock } from "@/lib/invalidations";
import { toastSuccess, onMutationError } from "@/lib/toast";

// ── Query key factories ────────────────────────────────────────────────────────
export const inventoryListKey      = (f)           => ["inventory",           f];
export const inventoryItemKey      = (id, storeId) => ["inventory_item",      id, storeId];
export const inventorySummaryKey   = (storeId)     => ["inv_summary",         storeId];
export const lowStockKey           = (storeId)     => ["low_stock",           storeId];
export const movementKey           = (storeId, f)  => ["movements",           storeId, f];
export const countSessionsKey      = (f)           => ["count_sessions",      f];
export const countSessionKey       = (id, store)   => ["count_session",       id, store];
export const countStatsKey         = (storeId)     => ["count_stats",         storeId];
export const sessionCountItemsKey  = (id, store)   => ["session_count_items", id, store];
export const varianceReportKey     = (id, store)   => ["variance_report",     id, store];
export const inventoryForCountKey  = (storeId)     => ["inventory_for_count", storeId];

// ── useInventory — paginated stock list ───────────────────────────────────────
export function useInventory({
  page = 1, limit = 25,
  search, categoryId, departmentId, lowStock, measurementType,
} = {}) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const filters = useMemo(() => ({
    store_id:         storeId        ?? null,
    page, limit,
    search:           search         || null,
    category_id:      categoryId     ?? null,
    department_id:    departmentId   ?? null,
    low_stock:        lowStock       ?? null,
    measurement_type: measurementType || null,
  }), [storeId, page, limit, search, categoryId, departmentId, lowStock, measurementType]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey:        inventoryListKey(filters),
    queryFn:         () => getInventory(filters),
    enabled:         !!storeId,
    staleTime:       2 * 60_000,
    placeholderData: (prev) => prev,
  });

  const { data: summary } = useQuery({
    queryKey:  inventorySummaryKey(storeId),
    queryFn:   () => getInventorySummary(storeId),
    enabled:   !!storeId,
    staleTime: 5 * 60_000,
  });

  const { data: lowStockList } = useQuery({
    queryKey:  lowStockKey(storeId),
    queryFn:   () => getLowStock(storeId, 100),
    enabled:   !!storeId,
    staleTime: 3 * 60_000,
  });

  const invalidateAll = useCallback(() => {
    invalidateStock(storeId);
  }, [storeId]);

  const restock = useMutation({
    mutationFn: ({ itemId, quantity, note }) =>
      restockItem(itemId, storeId, quantity, note),
    onSuccess: (_, vars) => {
      toastSuccess("Stock Restocked", `+${vars.quantity} units have been added to inventory.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Restock Failed", e),
  });

  const adjust = useMutation({
    mutationFn: ({ itemId, adjustmentQuantity, reason, notes }) =>
      adjustInventory(itemId, storeId, adjustmentQuantity, reason, notes),
    onSuccess: (_, vars) => {
      const qty = vars.adjustmentQuantity;
      toastSuccess("Stock Adjusted", `${qty > 0 ? "+" : ""}${qty} units applied to inventory.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Stock Adjustment Failed", e),
  });

  return {
    storeId,
    records:      useMemo(() => data?.data ?? [], [data]),
    total:        data?.total       ?? 0,
    totalPages:   data?.total_pages ?? 1,
    currentPage:  data?.page        ?? page,
    isLoading, isFetching,
    error:        error ?? null,
    summary:      summary   ?? null,
    lowStockList: lowStockList ?? [],
    restock, adjust,
    invalidateAll,
  };
}

// ── useInventoryItem — single item detail ─────────────────────────────────────
export function useInventoryItem(itemId, storeId) {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey:  inventoryItemKey(itemId, storeId),
    queryFn:   () => getInventoryItem(itemId, storeId),
    enabled:   !!(itemId && storeId),
    staleTime: 60_000,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: inventoryItemKey(itemId, storeId) });
    invalidateStock(storeId);
  }, [qc, itemId, storeId]);

  const restock = useMutation({
    mutationFn: ({ quantity, note }) => restockItem(itemId, storeId, quantity, note),
    onSuccess: (_, vars) => {
      toastSuccess("Stock Restocked", `+${vars.quantity} units have been added.`);
      invalidate();
    },
    onError: (e) => onMutationError("Restock Failed", e),
  });

  const adjust = useMutation({
    mutationFn: ({ adjustmentQuantity, reason, notes }) =>
      adjustInventory(itemId, storeId, adjustmentQuantity, reason, notes),
    onSuccess: (_, vars) => {
      const qty = vars.adjustmentQuantity;
      toastSuccess("Stock Adjusted", `${qty > 0 ? "+" : ""}${qty} units applied.`);
      invalidate();
    },
    onError: (e) => onMutationError("Stock Adjustment Failed", e),
  });

  return {
    detail:    data ?? null,
    isLoading,
    error:     error ?? null,
    restock, adjust,
  };
}

// ── useMovementHistory ────────────────────────────────────────────────────────
export function useMovementHistory(storeId, {
  page = 1, limit = 20,
  itemId, eventType, dateFrom, dateTo,
} = {}) {
  const allFilters = useMemo(() => ({
    page, limit,
    item_id:    itemId    || null,
    event_type: eventType || null,
    start_date: dateFrom  ? `${dateFrom}T00:00:00.000Z` : null,
    end_date:   dateTo    ? `${dateTo}T23:59:59.999Z`   : null,
  }), [page, limit, itemId, eventType, dateFrom, dateTo]);

  const { data, isLoading, error } = useQuery({
    queryKey:  movementKey(storeId, allFilters),
    queryFn:   () => getMovementHistory(storeId, allFilters),
    enabled:   !!storeId,
    staleTime: 60_000,
  });

  return {
    movements:  useMemo(() => data?.data ?? [], [data]),
    total:      data?.total       ?? 0,
    totalPages: data?.total_pages ?? 1,
    isLoading,
    error:      error ?? null,
  };
}

// ── useStockCountStats — efficient single-query stats ─────────────────────────
export function useStockCountStats() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading } = useQuery({
    queryKey:  countStatsKey(storeId),
    queryFn:   () => getStockCountStats(storeId),
    enabled:   !!storeId,
    staleTime: 60_000,
  });

  return {
    total:               data?.total_count              ?? 0,
    inProgressCount:     data?.in_progress_count        ?? 0,
    completedCount:      data?.completed_count          ?? 0,
    cancelledCount:      data?.cancelled_count          ?? 0,
    totalVarianceValue:  parseFloat(data?.total_variance_value ?? 0),
    totalItemsVariance:  data?.total_items_with_variance ?? 0,
    isLoading,
  };
}

// ── useCountSessions ──────────────────────────────────────────────────────────
export function useCountSessions(storeId, { page = 1, limit = 20, status, countType, search } = {}) {
  const qc = useQueryClient();

  const filters = useMemo(() => ({
    store_id:   storeId    ?? null,
    page, limit,
    status:     status     ?? null,
    count_type: countType  ?? null,
    search:     search     || null,
  }), [storeId, page, limit, status, countType, search]);

  const { data, isLoading, error } = useQuery({
    queryKey:        countSessionsKey(filters),
    queryFn:         () => getCountSessions(filters),
    enabled:         !!storeId,
    staleTime:       60_000,
    placeholderData: (prev) => prev,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["count_sessions"] });
    qc.invalidateQueries({ queryKey: ["count_stats"] });
    qc.invalidateQueries({ queryKey: inventorySummaryKey(storeId) });
  }, [qc, storeId]);

  const startSession = useMutation({
    mutationFn: ({ countType: ct, notes }) => startCountSession(storeId, ct, notes),
    onSuccess: (newSession) => {
      toastSuccess("Count Session Started", "You can now begin counting items.");
      invalidate();
      // Return the new session so callers can navigate to it
      return newSession;
    },
    onError: (e) => onMutationError("Couldn't Start Session", e),
  });

  return {
    sessions:    useMemo(() => data?.data ?? [], [data]),
    total:       data?.total       ?? 0,
    totalPages:  data?.total_pages ?? 1,
    currentPage: data?.page        ?? page,
    isLoading,
    error:       error ?? null,
    startSession,
    invalidate,
  };
}

// ── useCountSession — single session + mutations ──────────────────────────────
export function useCountSession(sessionId, storeId) {
  const qc = useQueryClient();

  const { data: session, isLoading, error } = useQuery({
    queryKey:        countSessionKey(sessionId, storeId),
    queryFn:         () => getCountSession(sessionId, storeId),
    enabled:         !!(sessionId && storeId),
    staleTime:       15_000,
    refetchInterval: (q) =>
      q.state.data?.status === "in_progress" ? 30_000 : false,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: countSessionKey(sessionId, storeId) });
    qc.invalidateQueries({ queryKey: sessionCountItemsKey(sessionId, storeId) });
    qc.invalidateQueries({ queryKey: ["count_sessions"] });
    qc.invalidateQueries({ queryKey: ["count_stats"] });
    qc.invalidateQueries({ queryKey: varianceReportKey(sessionId, storeId) });
  }, [qc, sessionId, storeId]);

  const recordCountMut = useMutation({
    mutationFn: ({ itemId, countedQuantity, notes }) =>
      recordCount(sessionId, storeId, itemId, countedQuantity, notes),
    onSuccess: invalidate,
    onError: (e) => onMutationError("Record Failed", e),
  });

  const completeSession = useMutation({
    mutationFn: ({ applyVariances = false }) =>
      completeCountSession(sessionId, storeId, applyVariances),
    onSuccess: (_, vars) => {
      if (vars.applyVariances) {
        toastSuccess("Count Completed", "Variances have been applied and stock updated.");
      } else {
        toastSuccess("Count Completed", "Variances are ready for review.");
      }
      invalidate();
      invalidateStock(storeId);
    },
    onError: (e) => onMutationError("Couldn't Complete Session", e),
  });

  const cancelSession = useMutation({
    mutationFn: ({ reason } = {}) =>
      cancelCountSession(sessionId, storeId, reason),
    onSuccess: () => {
      toastSuccess("Session Cancelled", "The stock count session has been cancelled.");
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Cancel Session", e),
  });

  return {
    session:        session ?? null,
    isLoading,
    error:          error ?? null,
    recordCount:    recordCountMut,
    completeSession,
    cancelSession,
    invalidate,
  };
}

// ── useInventoryForCount — full unpaginated item list for StockCountRunner ──────
// Returns every active tracked item in the store — no pagination.
// Replaces the fragile useInventory({ limit: 200 }) workaround that silently
// missed items beyond 200 in large stores.
export function useInventoryForCount(storeId) {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey:  inventoryForCountKey(storeId),
    queryFn:   () => getInventoryForCount(storeId),
    enabled:   !!storeId,
    staleTime: 5 * 60_000,
    gcTime:    10 * 60_000,
  });

  return {
    items:      useMemo(() => data ?? [], [data]),
    isLoading,
    isFetching,
    error:      error ?? null,
  };
}

// ── useSessionCountItems — items already counted in a session ─────────────────
// sessionStatus: pass session.status so polling stops when count is done.
export function useSessionCountItems(sessionId, storeId, sessionStatus) {
  const isActive = sessionStatus === "in_progress";

  const { data, isLoading, error } = useQuery({
    queryKey:        sessionCountItemsKey(sessionId, storeId),
    queryFn:         () => getSessionCountItems(sessionId, storeId),
    enabled:         !!(sessionId && storeId),
    staleTime:       isActive ? 10_000 : 60_000,
    // Poll every 20s during active counts; stops once completed / cancelled
    refetchInterval: isActive ? 20_000 : false,
  });

  return {
    countedItems:    useMemo(() => data ?? [], [data]),
    // Lookup map: item_id (UUID string) → StockCountItem
    countedItemsMap: useMemo(() => {
      const map = {};
      (data ?? []).forEach((ci) => { map[String(ci.item_id)] = ci; });
      return map;
    }, [data]),
    isLoading,
    error: error ?? null,
  };
}

// ── useVarianceReport ─────────────────────────────────────────────────────────
export function useVarianceReport(sessionId, storeId) {
  const qc = useQueryClient();

  const { data: report, isLoading, error, refetch } = useQuery({
    queryKey:  varianceReportKey(sessionId, storeId),
    queryFn:   () => getVarianceReport(sessionId, storeId),
    enabled:   !!(sessionId && storeId),
    staleTime: 60_000,
  });

  const applyVariances = useMutation({
    mutationFn: () => applyVariancesStandalone(sessionId, storeId),
    onSuccess: () => {
      toastSuccess("Variances Applied", "Stock levels have been updated to match your count.");
      refetch();
      invalidateStock(storeId);
      // Also refresh the session itself so its status is current
      qc.invalidateQueries({ queryKey: countSessionKey(sessionId, storeId) });
    },
    onError: (e) => onMutationError("Couldn't Apply Variances", e),
  });

  return {
    report:   report ?? null,
    isLoading,
    error:    error ?? null,
    applyVariances,
    refetch,
  };
}
