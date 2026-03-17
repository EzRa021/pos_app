// ============================================================================
// features/returns/useReturns.js — React Query data hooks
// ============================================================================

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getReturns,
  getReturn,
  getTransactionReturns,
  createReturn,
} from "@/commands/returns";
import { invalidateAfterReturn } from "@/lib/invalidations";

export const returnListKey   = (filters) => ["returns", "list",   filters];
export const returnKey       = (id)      => ["returns", "detail", id];
export const returnStatsKey  = (storeId) => ["returns", "stats",  storeId];
export const txReturnsKey    = (txId)    => ["returns", "tx",     txId];

// ── useReturns — paginated list ────────────────────────────────────────────────
export function useReturns({
  page = 1, limit = 25,
  status, returnType, dateFrom, dateTo,
} = {}) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const filters = useMemo(() => ({
    store_id:    storeId     ?? null,
    page,
    limit,
    status:      status      || null,
    return_type: returnType  || null,
    date_from:   dateFrom    || null,
    date_to:     dateTo      || null,
  }), [storeId, page, limit, status, returnType, dateFrom, dateTo]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey:        returnListKey(filters),
    queryFn:         () => getReturns(filters),
    enabled:         !!storeId,
    staleTime:       60 * 1000,
    placeholderData: (prev) => prev,
  });

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["returns"] });
  }, [qc]);

  return {
    storeId,
    returns:    useMemo(() => data?.data ?? [], [data]),
    total:      data?.total       ?? 0,
    totalPages: data?.total_pages ?? 1,
    currentPage: data?.page       ?? page,
    isLoading,
    isFetching,
    error: error ?? null,
    invalidateAll,
  };
}

// ── useReturnStats — for stat cards ────────────────────────────────────────────
export function useReturnStats() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const base    = { store_id: storeId, page: 1, limit: 200 };

  const { data: all }     = useQuery({ queryKey: [...returnStatsKey(storeId), "all"],     queryFn: () => getReturns({ ...base }),                              enabled: !!storeId, staleTime: 60000 });
  const { data: full }    = useQuery({ queryKey: [...returnStatsKey(storeId), "full"],    queryFn: () => getReturns({ ...base, return_type: "full" }),         enabled: !!storeId, staleTime: 60000 });
  const { data: partial } = useQuery({ queryKey: [...returnStatsKey(storeId), "partial"], queryFn: () => getReturns({ ...base, return_type: "partial" }),      enabled: !!storeId, staleTime: 60000 });

  const totalRefunded = useMemo(() => {
    const rows = all?.data ?? [];
    return rows.reduce((sum, r) => sum + parseFloat(r.total_amount ?? 0), 0);
  }, [all]);

  return {
    total:          all?.total     ?? 0,
    fullCount:      full?.total    ?? 0,
    partialCount:   partial?.total ?? 0,
    totalRefunded,
  };
}

// ── useReturn — single detail + create mutation ────────────────────────────────
export function useReturn(id) {
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  returnKey(id),
    queryFn:   () => getReturn(parseInt(id, 10)),
    enabled:   !!id,
    staleTime: 30 * 1000,
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
  };
}

// ── useTransactionReturns — returns linked to a transaction ────────────────────
export function useTransactionReturns(txId) {
  const { data, isLoading } = useQuery({
    queryKey: txReturnsKey(txId),
    queryFn:  () => getTransactionReturns(txId),
    enabled:  !!txId,
    staleTime: 30 * 1000,
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
    onSuccess: () => invalidateAfterReturn(storeId),
  });
}
