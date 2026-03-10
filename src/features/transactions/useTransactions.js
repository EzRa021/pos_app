// ============================================================================
// features/transactions/useTransactions.js
// ============================================================================
import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getTransactions,
  getTransaction,
  voidTransaction,
  partialRefund,
  fullRefund,
} from "@/commands/transactions";

export const txListKey  = (filters) => ["transactions", "list",   filters];
export const txKey      = (id)      => ["transactions", "detail", id];
export const txStatsKey = (storeId) => ["transactions", "stats",  storeId];

// ── useTransactions ───────────────────────────────────────────────────────────
export function useTransactions({
  page = 1, limit = 25, search, status,
  cashierId, customerId, dateFrom, dateTo,
} = {}) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const filters = useMemo(() => ({
    store_id:    storeId    ?? null,
    page,
    limit,
    search:      search     || null,
    status:      status     || null,
    cashier_id:  cashierId  ?? null,
    customer_id: customerId ?? null,
    date_from:   dateFrom   || null,
    date_to:     dateTo     || null,
  }), [storeId, page, limit, search, status, cashierId, customerId, dateFrom, dateTo]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey:        txListKey(filters),
    queryFn:         () => getTransactions(filters),
    enabled:         !!storeId,
    staleTime:       60 * 1000,
    placeholderData: (prev) => prev,
  });

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["transactions"] });
  }, [qc]);

  return {
    storeId,
    transactions: useMemo(() => data?.data ?? [], [data]),
    total:        data?.total       ?? 0,
    totalPages:   data?.total_pages ?? 1,
    currentPage:  data?.page        ?? page,
    isLoading,
    isFetching,
    error: error ?? null,
    invalidateAll,
  };
}

// ── useTransactionStats ───────────────────────────────────────────────────────
export function useTransactionStats() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const base    = { store_id: storeId, page: 1, limit: 1 };
  const today   = new Date().toISOString().split("T")[0];

  const { data: all }       = useQuery({ queryKey: [...txStatsKey(storeId), "all"],       queryFn: () => getTransactions({ ...base }),                              enabled: !!storeId, staleTime: 60000 });
  const { data: completed } = useQuery({ queryKey: [...txStatsKey(storeId), "completed"], queryFn: () => getTransactions({ ...base, status: "completed" }),          enabled: !!storeId, staleTime: 60000 });
  const { data: voided }    = useQuery({ queryKey: [...txStatsKey(storeId), "voided"],    queryFn: () => getTransactions({ ...base, status: "voided" }),              enabled: !!storeId, staleTime: 60000 });
  const { data: refunded }  = useQuery({ queryKey: [...txStatsKey(storeId), "refunded"],  queryFn: () => getTransactions({ ...base, status: "refunded" }),            enabled: !!storeId, staleTime: 60000 });
  const { data: todayData } = useQuery({ queryKey: [...txStatsKey(storeId), "today"],     queryFn: () => getTransactions({ ...base, limit: 200, date_from: today, status: "completed" }), enabled: !!storeId, staleTime: 60000 });

  const todayRevenue = useMemo(() => {
    const rows = todayData?.data ?? [];
    return rows.reduce((sum, tx) => sum + parseFloat(tx.total_amount ?? 0), 0);
  }, [todayData]);

  return {
    total:       all?.total       ?? 0,
    completed:   completed?.total ?? 0,
    voided:      voided?.total    ?? 0,
    refunded:    refunded?.total  ?? 0,
    todayCount:  todayData?.total ?? 0,
    todayRevenue,
  };
}

// ── useTransaction — single detail + mutations ────────────────────────────────
export function useTransaction(id) {
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  txKey(id),
    queryFn:   () => getTransaction(parseInt(id, 10)),
    enabled:   !!id,
    staleTime: 30 * 1000,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: txKey(id) });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  }, [qc, id]);

  const voidTx = useMutation({
    mutationFn: (payload) => voidTransaction(parseInt(id, 10), payload),
    onSuccess:  invalidate,
  });

  const partialRefundTx = useMutation({
    mutationFn: (payload) => partialRefund(parseInt(id, 10), payload),
    onSuccess:  invalidate,
  });

  const fullRefundTx = useMutation({
    mutationFn: (payload) => fullRefund(parseInt(id, 10), payload),
    onSuccess:  invalidate,
  });

  return {
    transaction:    data?.transaction ?? null,
    items:          useMemo(() => data?.items ?? [], [data]),
    isLoading,
    error:          error ?? null,
    refetch,
    voidTx,
    partialRefundTx,
    fullRefundTx,
  };
}
