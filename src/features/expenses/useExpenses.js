// features/expenses/useExpenses.js
import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getExpenses, getExpense,
  getExpenseSummary, getExpenseBreakdown,
  createExpense, updateExpense,
  approveExpense, rejectExpense, deleteExpense,
} from "@/commands/expenses";

// ── Expenses list hook ────────────────────────────────────────────────────────
export function useExpenses({
  storeIdOverride, expenseType, approvalStatus, paymentStatus,
  dateFrom, dateTo, page = 1, limit = 25,
} = {}) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  const queryKey = ["expenses", storeId, { expenseType, approvalStatus, paymentStatus, dateFrom, dateTo, page, limit }];

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getExpenses({
      store_id:        storeId,
      expense_type:    expenseType    || undefined,
      approval_status: approvalStatus || undefined,
      payment_status:  paymentStatus  || undefined,
      date_from:       dateFrom       || undefined,
      date_to:         dateTo         || undefined,
      page,
      limit,
    }),
    enabled:         !!storeId,
    staleTime:       60 * 1000,
    placeholderData: (prev) => prev,
  });

  const expenses   = useMemo(() => data?.data       ?? [], [data]);
  const total      = data?.total      ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const invalidate    = useCallback(() => qc.invalidateQueries({ queryKey: ["expenses", storeId] }), [qc, storeId]);
  const invalidateAll = useCallback(() => qc.invalidateQueries({ queryKey: ["expenses"] }),          [qc]);

  const create  = useMutation({
    mutationFn: (p) => createExpense({ store_id: storeId, ...p }),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["expense-summary"] }); },
  });
  const update  = useMutation({
    mutationFn: ({ id, ...p }) => updateExpense(id, p),
    onSuccess: () => { invalidateAll(); qc.invalidateQueries({ queryKey: ["expense-summary"] }); },
  });
  const approve = useMutation({
    mutationFn: (id) => approveExpense(id),
    onSuccess: () => { invalidateAll(); qc.invalidateQueries({ queryKey: ["expense-summary"] }); },
  });
  const reject  = useMutation({
    mutationFn: (id) => rejectExpense(id),
    onSuccess: () => { invalidateAll(); qc.invalidateQueries({ queryKey: ["expense-summary"] }); },
  });
  const remove  = useMutation({
    mutationFn: (id) => deleteExpense(id),
    onSuccess: () => { invalidateAll(); qc.invalidateQueries({ queryKey: ["expense-summary"] }); },
  });

  return {
    storeId, expenses, total, totalPages,
    isLoading, isFetching, error: error ?? null, refetch,
    create, update, approve, reject, remove,
  };
}

// ── Expense summary + breakdown hook ─────────────────────────────────────────
export function useExpenseSummary(dateFrom, dateTo) {
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId = branchStoreId;

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["expense-summary", storeId, dateFrom, dateTo],
    queryFn:  () => getExpenseSummary(storeId, dateFrom, dateTo),
    enabled:  !!storeId,
    staleTime: 2 * 60 * 1000,
  });

  const { data: breakdown, isLoading: loadingBreakdown } = useQuery({
    queryKey: ["expense-breakdown", storeId, dateFrom, dateTo],
    queryFn:  () => getExpenseBreakdown(storeId, dateFrom, dateTo),
    enabled:  !!storeId,
    staleTime: 2 * 60 * 1000,
  });

  const breakdownList = useMemo(() => breakdown ?? [], [breakdown]);

  return {
    summary,
    breakdownList,
    isLoading: loadingSummary || loadingBreakdown,
  };
}
