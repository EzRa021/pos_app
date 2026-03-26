// features/customers/useCustomers.js
import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getCustomers, getCustomer, getCustomerStats, getCustomerTransactions,
  createCustomer, updateCustomer,
  activateCustomer, deactivateCustomer, deleteCustomer,
} from "@/commands/customers";
import { toastSuccess, onMutationError } from "@/lib/toast";

// ── List hook ─────────────────────────────────────────────────────────────────
export function useCustomers({ storeIdOverride, search, isActive, customerType, page = 1, limit = 25 } = {}) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  const queryKey = ["customers", storeId, { search, isActive, customerType, page, limit }];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getCustomers({
      store_id:      storeId,
      search:        search    || undefined,
      is_active:     isActive  ?? undefined,
      customer_type: customerType || undefined,
      page,
      limit,
    }),
    enabled:   !!storeId,
    staleTime: 2 * 60 * 1000,
  });

  const items = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const invalidate    = useCallback(() => qc.invalidateQueries({ queryKey: ["customers", storeId] }), [qc, storeId]);
  const invalidateAll = useCallback(() => qc.invalidateQueries({ queryKey: ["customers"] }),           [qc]);

  const create = useMutation({
    mutationFn: (p) => createCustomer({ store_id: storeId, ...p }),
    onSuccess: (c) => {
      toastSuccess("Customer Added", `${c.first_name} ${c.last_name} is now in your customer directory.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Add Customer", e),
  });
  const update = useMutation({
    mutationFn: ({ id, ...p }) => updateCustomer(id, p),
    onSuccess: (c) => {
      toastSuccess("Customer Updated", `Profile changes for ${c.first_name} ${c.last_name} have been saved.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Update Customer", e),
  });
  const activate = useMutation({
    mutationFn: (id) => activateCustomer(id),
    onSuccess: (c) => {
      toastSuccess("Customer Activated", `${c.first_name}'s account is now active.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Activate Customer", e),
  });
  const deactivate = useMutation({
    mutationFn: (id) => deactivateCustomer(id),
    onSuccess: (c) => {
      toastSuccess("Customer Deactivated", `${c.first_name}'s account has been suspended.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Deactivate Customer", e),
  });
  const remove = useMutation({
    mutationFn: (id) => deleteCustomer(id),
    onSuccess: () => {
      toastSuccess("Customer Removed", "The customer record has been deleted.");
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Remove Customer", e),
  });

  return { storeId, items, total, totalPages, isLoading, error: error ?? null, refetch,
           create, update, activate, deactivate, remove };
}

// ── Single customer + stats hook ──────────────────────────────────────────────
export function useCustomer(id) {
  const qc = useQueryClient();

  const { data: customer, isLoading: loadingCustomer, error: customerError } = useQuery({
    queryKey: ["customer", id],
    queryFn:  () => getCustomer(id),
    enabled:  !!id,
    staleTime: 2 * 60 * 1000,
  });

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["customer-stats", id],
    queryFn:  () => getCustomerStats(id),
    enabled:  !!id,
    staleTime: 2 * 60 * 1000,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["customer", id] });
    qc.invalidateQueries({ queryKey: ["customer-stats", id] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  }, [qc, id]);

  const update = useMutation({
    mutationFn: (p) => updateCustomer(id, p),
    onSuccess: (c) => {
      toastSuccess("Customer Updated", `Profile changes for ${c.first_name} ${c.last_name} have been saved.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Update Customer", e),
  });
  const activate = useMutation({
    mutationFn: () => activateCustomer(id),
    onSuccess: (c) => {
      toastSuccess("Customer Activated", `${c.first_name}'s account is now active.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Activate Customer", e),
  });
  const deactivate = useMutation({
    mutationFn: () => deactivateCustomer(id),
    onSuccess: (c) => {
      toastSuccess("Customer Deactivated", `${c.first_name}'s account has been suspended.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Deactivate Customer", e),
  });

  return {
    customer, stats,
    isLoading: loadingCustomer || loadingStats,
    error: customerError ?? null,
    update, activate, deactivate,
  };
}

// ── Customer transactions hook ────────────────────────────────────────────────
export function useCustomerTransactions(id, { page = 1, limit = 20, dateFrom, dateTo } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["customer-txns", id, { page, limit, dateFrom, dateTo }],
    queryFn:  () => getCustomerTransactions(id, {
      page, limit,
      date_from: dateFrom || undefined,
      date_to:   dateTo   || undefined,
    }),
    enabled:   !!id,
    staleTime: 1 * 60 * 1000,
  });

  const items      = useMemo(() => data?.data ?? [], [data]);
  const total      = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  return { items, total, totalPages, isLoading, error: error ?? null };
}
