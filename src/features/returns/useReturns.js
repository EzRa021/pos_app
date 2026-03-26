// ============================================================================
// features/returns/useReturns.js — React Query data hooks
// ============================================================================

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getReturns,
  getReturn,
  getReturnStats,
  getTransactionReturns,
  createReturn,
  voidReturn,
} from "@/commands/returns";
import { invalidateAfterReturn } from "@/lib/invalidations";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { formatCurrency } from "@/lib/format";

// ── Query key factories ────────────────────────────────────────────────────────
export const returnListKey  = (filters) => ["returns", "list",   filters];
export const returnKey      = (id)      => ["returns", "detail", id];
export const returnStatsKey = (storeId) => ["returns", "stats",  storeId];
export const txReturnsKey   = (txId)    => ["returns", "tx",     txId];

// ── useReturns — paginated list ────────────────────────────────────────────────
export function useReturns({
  page = 1, limit = 25,
  search, status, returnType, dateFrom, dateTo,
} = {}) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const filters = useMemo(() => ({
    store_id:    storeId    ?? null,
    page,
    limit,
    search:      search     || null,
    status:      status     || null,
    return_type: returnType || null,
    date_from:   dateFrom   || null,
    date_to:     dateTo     || null,
  }), [storeId, page, limit, search, status, returnType, dateFrom, dateTo]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey:        returnListKey(filters),
    queryFn:         () => getReturns(filters),
    enabled:         !!storeId,
    staleTime:       60_000,
    placeholderData: (prev) => prev,
  });

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["returns"] });
  }, [qc]);

  return {
    storeId,
    returns:     useMemo(() => data?.data       ?? [], [data]),
    total:       data?.total       ?? 0,
    totalPages:  data?.total_pages ?? 1,
    currentPage: data?.page        ?? page,
    isLoading,
    isFetching,
    error:       error ?? null,
    invalidateAll,
  };
}

// ── useReturnStats — single efficient query via v_return_stats ─────────────────
export function useReturnStats() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading } = useQuery({
    queryKey: returnStatsKey(storeId),
    queryFn:  () => getReturnStats(storeId),
    enabled:  !!storeId,
    staleTime: 60_000,
  });

  return {
    total:          data?.total_count     ?? 0,
    fullCount:      data?.full_count      ?? 0,
    partialCount:   data?.partial_count   ?? 0,
    completedCount: data?.completed_count ?? 0,
    voidedCount:    data?.voided_count    ?? 0,
    totalRefunded:  parseFloat(data?.total_refunded ?? 0),
    isLoading,
  };
}

// ── useReturn — single return detail ──────────────────────────────────────────
export function useReturn(id) {
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  returnKey(id),
    queryFn:   () => getReturn(parseInt(id, 10)),
    enabled:   !!id,
    staleTime: 30_000,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: returnKey(id) });
    qc.invalidateQueries({ queryKey: ["returns"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  }, [qc, id]);

  return {
    ret:      data?.ret   ?? null,
    items:    useMemo(() => data?.items ?? [], [data]),
    isLoading,
    error:    error ?? null,
    refetch,
    invalidate,
  };
}

// ── useTransactionReturns — returns linked to a transaction ────────────────────
export function useTransactionReturns(txId) {
  const { data, isLoading } = useQuery({
    queryKey:  txReturnsKey(txId),
    queryFn:   () => getTransactionReturns(txId),
    enabled:   !!txId,
    staleTime: 30_000,
  });

  return {
    returns:   useMemo(() => data ?? [], [data]),
    isLoading,
  };
}

// ── useCreateReturn ────────────────────────────────────────────────────────────
export function useCreateReturn() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  return useMutation({
    mutationFn: (payload) => createReturn(payload),
    onSuccess: (result) => {
      const amount = formatCurrency(parseFloat(result?.ret?.total_amount ?? 0));
      toastSuccess(
        "Return Processed",
        `Refund of ${amount} has been issued.`,
      );
      invalidateAfterReturn(storeId);
    },
    onError: (e) => onMutationError("Return Failed", e),
  });
}

// ── useVoidReturn ──────────────────────────────────────────────────────────────
export function useVoidReturn() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }) => voidReturn(id, { reason }),
    onSuccess: (result) => {
      const ref = result?.ret?.reference_no ?? "";
      toastSuccess("Return Voided", `${ref} has been voided and stock reversed.`);
      // Invalidate the specific return + all related lists
      qc.invalidateQueries({ queryKey: returnKey(result?.ret?.id) });
      invalidateAfterReturn(storeId);
    },
    onError: (e) => onMutationError("Void Failed", e),
  });
}
