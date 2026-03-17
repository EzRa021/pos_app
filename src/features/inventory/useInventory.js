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
  startCountSession, recordCount, completeCountSession,
  getCountSessions, getCountSession,
  getVarianceReport, applyVariancesStandalone,
} from "@/commands/inventory";
import { invalidateStock } from "@/lib/invalidations";

// ── Query key factories ────────────────────────────────────────────────────────
export const inventoryListKey    = (f)           => ["inventory", f];
export const inventoryItemKey    = (id, storeId) => ["inventory_item", id, storeId];
export const inventorySummaryKey = (storeId)     => ["inv_summary", storeId];
export const lowStockKey         = (storeId)     => ["low_stock", storeId];
export const movementKey         = (storeId, f)  => ["movements", storeId, f];
export const countSessionsKey    = (f)           => ["count_sessions", f];
export const countSessionKey     = (id, store)   => ["count_session", id, store];
export const varianceReportKey   = (id, store)   => ["variance_report", id, store];

// ── useInventory — paginated stock list ───────────────────────────────────────
export function useInventory({
  page = 1, limit = 25,
  search, categoryId, departmentId, lowStock, measurementType,
} = {}) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const filters = useMemo(() => ({
    store_id:         storeId   ?? null,
    page, limit,
    search:           search           || null,
    category_id:      categoryId       ?? null,
    department_id:    departmentId     ?? null,
    low_stock:        lowStock         ?? null,
    measurement_type: measurementType  || null,
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
    onSuccess: invalidateAll,
  });

  const adjust = useMutation({
    mutationFn: ({ itemId, adjustmentQuantity, reason, notes }) =>
      adjustInventory(itemId, storeId, adjustmentQuantity, reason, notes),
    onSuccess: invalidateAll,
  });

  return {
    storeId,
    records:     useMemo(() => data?.data ?? [], [data]),
    total:       data?.total ?? 0,
    totalPages:  data?.total_pages ?? 1,
    currentPage: data?.page ?? page,
    isLoading, isFetching,
    error:       error ?? null,
    summary:     summary ?? null,
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
    onSuccess:  invalidate,
  });

  const adjust = useMutation({
    mutationFn: ({ adjustmentQuantity, reason, notes }) =>
      adjustInventory(itemId, storeId, adjustmentQuantity, reason, notes),
    onSuccess: invalidate,
  });

  return {
    detail: data ?? null,
    isLoading,
    error:  error ?? null,
    restock, adjust,
  };
}

// ── useMovementHistory ────────────────────────────────────────────────────────
export function useMovementHistory(storeId, {
  page = 1, limit = 20,
  itemId, eventType, dateFrom, dateTo,
} = {}) {
  const allFilters = useMemo(() => ({
    page,
    limit,
    item_id:    itemId    || null,
    event_type: eventType || null,
    // start_date / end_date are DateTime<Utc> in the backend — send ISO strings
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
    total:      data?.total ?? 0,
    totalPages: data?.total_pages ?? 1,
    isLoading,
    error: error ?? null,
  };
}

// ── useCountSessions ──────────────────────────────────────────────────────────
export function useCountSessions(storeId, { page = 1, limit = 20, status } = {}) {
  const qc = useQueryClient();

  const filters = useMemo(() => ({
    store_id: storeId ?? null,
    page, limit,
    status:   status ?? null,
  }), [storeId, page, limit, status]);

  const { data, isLoading, error } = useQuery({
    queryKey:        countSessionsKey(filters),
    queryFn:         () => getCountSessions(filters),
    enabled:         !!storeId,
    staleTime:       60_000,
    placeholderData: (prev) => prev,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["count_sessions"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: inventorySummaryKey(storeId) });
  }, [qc, storeId]);

  const startSession = useMutation({
    mutationFn: ({ countType, notes }) => startCountSession(storeId, countType, notes),
    onSuccess:  invalidate,
  });

  return {
    sessions:    useMemo(() => data?.data ?? [], [data]),
    total:       data?.total ?? 0,
    totalPages:  data?.total_pages ?? 1,
    currentPage: data?.page ?? page,
    isLoading,
    error: error ?? null,
    startSession,
    invalidate,
  };
}

// ── useCountSession — single session ─────────────────────────────────────────
export function useCountSession(sessionId, storeId) {
  const qc = useQueryClient();

  const { data: session, isLoading, error } = useQuery({
    queryKey:       countSessionKey(sessionId, storeId),
    queryFn:        () => getCountSession(sessionId, storeId),
    enabled:        !!(sessionId && storeId),
    staleTime:      15_000,
    refetchInterval: (q) =>
      q.state.data?.status === "in_progress" ? 30_000 : false,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: countSessionKey(sessionId, storeId) });
    qc.invalidateQueries({ queryKey: ["count_sessions"] });
    qc.invalidateQueries({ queryKey: varianceReportKey(sessionId, storeId) });
  }, [qc, sessionId, storeId]);

  const recordCountMut = useMutation({
    mutationFn: ({ itemId, countedQuantity, notes }) =>
      recordCount(sessionId, storeId, itemId, countedQuantity, notes),
    onSuccess: invalidate,
  });

  const completeSession = useMutation({
    mutationFn: ({ applyVariances = false }) =>
      completeCountSession(sessionId, storeId, applyVariances),
    onSuccess: () => {
      invalidate();
      invalidateStock(storeId);
    },
  });

  return {
    session:       session ?? null,
    isLoading,
    error:         error ?? null,
    recordCount:   recordCountMut,
    completeSession,
    invalidate,
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
    onSuccess:  () => {
      refetch();
      invalidateStock(storeId);
    },
  });

  return {
    report:   report ?? null,
    isLoading,
    error:    error ?? null,
    applyVariances,
    refetch,
  };
}
