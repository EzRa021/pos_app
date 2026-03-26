// ============================================================================
// features/transactions/useTransactions.js
// ============================================================================
import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getTransactions,
  getTransaction,
  getTransactionStats,
  voidTransaction,
  partialRefund,
  fullRefund,
} from "@/commands/transactions";
import { invalidateAfterVoid } from "@/lib/invalidations";

export const txListKey  = (filters) => ["transactions", "list",   filters];
export const txKey      = (id)      => ["transactions", "detail", id];
export const txStatsKey = (storeId) => ["transactions", "stats",  storeId];

// ── useTransactions ───────────────────────────────────────────────────────────
export function useTransactions({
  page = 1, limit = 25, search, status, paymentMethod, paymentStatus,
  cashierId, customerId, dateFrom, dateTo,
} = {}) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const filters = useMemo(() => ({
    store_id:       storeId        ?? null,
    page,
    limit,
    search:         search         || null,
    status:         status         || null,
    payment_method: paymentMethod  || null,
    payment_status: paymentStatus  || null,
    cashier_id:     cashierId      ?? null,
    customer_id:    customerId     ?? null,
    date_from:      dateFrom       || null,
    date_to:        dateTo         || null,
  }), [storeId, page, limit, search, status, paymentMethod, paymentStatus, cashierId, customerId, dateFrom, dateTo]);

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
// Single SQL aggregate query — replaces the previous 5 round-trips.
// Backend computes all counts + today's revenue in one pass.
export function useTransactionStats() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data } = useQuery({
    queryKey: txStatsKey(storeId),
    queryFn:  () => getTransactionStats(storeId),
    enabled:  !!storeId,
    staleTime: 60 * 1000,
  });

  return {
    total:        data?.total         ?? 0,
    completed:    data?.completed     ?? 0,
    voided:       data?.voided        ?? 0,
    refunded:     data?.refunded      ?? 0,
    todayCount:   data?.today_count   ?? 0,
    todayRevenue: parseFloat(data?.today_revenue ?? 0),
  };
}

// ── useTransaction — single detail + mutations ────────────────────────────────
export function useTransaction(id) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  txKey(id),
    queryFn:   () => getTransaction(parseInt(id, 10)),
    enabled:   !!id,
    staleTime: 30 * 1000,
  });

  // After void or refund: transaction status changes AND stock is restocked
  const invalidateVoid = useCallback(() => {
    qc.invalidateQueries({ queryKey: txKey(id) });
    invalidateAfterVoid(storeId);
  }, [qc, id, storeId]);

  const voidTx = useMutation({
    mutationFn: (payload) => voidTransaction(parseInt(id, 10), payload),
    onSuccess:  invalidateVoid,
  });

  const partialRefundTx = useMutation({
    mutationFn: (payload) => partialRefund(parseInt(id, 10), payload),
    onSuccess:  invalidateVoid,
  });

  const fullRefundTx = useMutation({
    mutationFn: (payload) => fullRefund(parseInt(id, 10), payload),
    onSuccess:  invalidateVoid,
  });

  return {
    transaction:    data?.transaction ?? null,
    items:          useMemo(() => data?.items     ?? [], [data]),
    payments:       useMemo(() => data?.payments  ?? [], [data]),
    isLoading,
    error:          error ?? null,
    refetch,
    voidTx,
    partialRefundTx,
    fullRefundTx,
  };
}
