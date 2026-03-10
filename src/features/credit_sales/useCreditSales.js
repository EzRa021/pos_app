// features/credit_sales/useCreditSales.js
import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getCreditSales, getCreditSale, getCreditPayments,
  getCreditSummary, getOutstandingBalances, getOverdueSales,
  recordCreditPayment, cancelCreditSale,
} from "@/commands/credit_sales";

// ── Credit sales list hook ────────────────────────────────────────────────────
export function useCreditSales({
  storeIdOverride, customerId, status, dateFrom, dateTo, page = 1, limit = 25,
} = {}) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  const queryKey = ["credit-sales", storeId, { customerId, status, dateFrom, dateTo, page, limit }];

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getCreditSales({
      store_id:    storeId,
      customer_id: customerId  ?? undefined,
      status:      status      || undefined,
      date_from:   dateFrom    || undefined,
      date_to:     dateTo      || undefined,
      page,
      limit,
    }),
    enabled:         !!storeId,
    staleTime:       60 * 1000,
    placeholderData: (prev) => prev,
  });

  const sales      = useMemo(() => data?.data ?? [], [data]);
  const total      = data?.total      ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const invalidate    = useCallback(() => qc.invalidateQueries({ queryKey: ["credit-sales", storeId] }), [qc, storeId]);
  const invalidateAll = useCallback(() => qc.invalidateQueries({ queryKey: ["credit-sales"] }), [qc]);

  const recordPayment = useMutation({
    mutationFn: ({ creditSaleId, amount, paymentMethod, notes, reference }) =>
      recordCreditPayment(creditSaleId, amount, paymentMethod, notes, reference),
    onSuccess: () => {
      invalidateAll();
      // Also refresh customer cache since outstanding balance changes
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["credit-summary", storeId] });
    },
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }) => cancelCreditSale(id, reason),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["credit-summary", storeId] });
    },
  });

  return {
    storeId, sales, total, totalPages, isLoading, isFetching, error: error ?? null, refetch,
    recordPayment, cancel,
  };
}

// ── Single credit sale + payments hook ───────────────────────────────────────
export function useCreditSale(id) {
  const qc = useQueryClient();

  const { data: sale, isLoading: loadingSale, error } = useQuery({
    queryKey: ["credit-sale", id],
    queryFn:  () => getCreditSale(id),
    enabled:  !!id,
    staleTime: 30 * 1000,
  });

  const { data: payments, isLoading: loadingPayments } = useQuery({
    queryKey: ["credit-payments", id],
    queryFn:  () => getCreditPayments(id),
    enabled:  !!id,
    staleTime: 30 * 1000,
  });

  const paymentsArr = useMemo(() => payments ?? [], [payments]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["credit-sale",     id] });
    qc.invalidateQueries({ queryKey: ["credit-payments", id] });
    qc.invalidateQueries({ queryKey: ["credit-sales"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  }, [qc, id]);

  const recordPayment = useMutation({
    mutationFn: ({ amount, paymentMethod, notes, reference }) =>
      recordCreditPayment(id, amount, paymentMethod, notes, reference),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: (reason) => cancelCreditSale(id, reason),
    onSuccess: invalidate,
  });

  return {
    sale, payments: paymentsArr,
    isLoading: loadingSale || loadingPayments,
    error: error ?? null,
    recordPayment, cancel,
  };
}

// ── Summary + outstanding balances hook ──────────────────────────────────────
export function useCreditSummary(storeIdOverride) {
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["credit-summary", storeId],
    queryFn:  () => getCreditSummary(storeId),
    enabled:  !!storeId,
    staleTime: 60 * 1000,
  });

  const { data: outstanding, isLoading: loadingOutstanding } = useQuery({
    queryKey: ["outstanding-balances", storeId],
    queryFn:  () => getOutstandingBalances(storeId),
    enabled:  !!storeId,
    staleTime: 60 * 1000,
  });

  const { data: overdue, isLoading: loadingOverdue } = useQuery({
    queryKey: ["overdue-sales", storeId],
    queryFn:  () => getOverdueSales(storeId),
    enabled:  !!storeId,
    staleTime: 60 * 1000,
  });

  const outstandingArr = useMemo(() => outstanding ?? [], [outstanding]);
  const overdueArr     = useMemo(() => overdue     ?? [], [overdue]);

  return {
    summary,
    outstanding: outstandingArr,
    overdue:     overdueArr,
    isLoading:   loadingSummary || loadingOutstanding || loadingOverdue,
  };
}
