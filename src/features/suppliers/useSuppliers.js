// features/suppliers/useSuppliers.js
import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getSuppliers, getSupplier, getSupplierStats, getSupplierSpendTimeline,
  createSupplier, updateSupplier,
  activateSupplier, deactivateSupplier, deleteSupplier,
} from "@/commands/suppliers";
import { getPurchaseOrders } from "@/commands/purchase_orders";
import {
  getSupplierBalance, getSupplierPayments, recordSupplierPayment,
} from "@/commands/supplier_payments";
import { toastSuccess, onMutationError } from "@/lib/toast";

// ── Suppliers list hook ────────────────────────────────────────────────────────
export function useSuppliers({ storeIdOverride, search, isActive, page = 1, limit = 50 } = {}) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  const queryKey = ["suppliers", storeId, { search, isActive, page, limit }];

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getSuppliers({
      store_id:  storeId,
      search:    search    || undefined,
      is_active: isActive  ?? undefined,
      page,
      limit,
    }),
    enabled:         !!storeId,
    staleTime:       5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const items      = useMemo(() => data?.data ?? [], [data]);
  const total      = data?.total      ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const invalidate    = useCallback(() => qc.invalidateQueries({ queryKey: ["suppliers", storeId] }), [qc, storeId]);
  const invalidateAll = useCallback(() => qc.invalidateQueries({ queryKey: ["suppliers"] }),          [qc]);

  const create     = useMutation({
    mutationFn: (p) => createSupplier({ store_id: storeId, ...p }),
    onSuccess: (s) => {
      toastSuccess("Supplier Added", `${s.name} is now in your supplier directory.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Add Supplier", e),
  });
  const update     = useMutation({
    mutationFn: ({ id, ...p }) => updateSupplier(id, p),
    onSuccess: (s) => {
      toastSuccess("Supplier Updated", `Profile changes for ${s.name} have been saved.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Update Supplier", e),
  });
  const activate   = useMutation({
    mutationFn: (id) => activateSupplier(id),
    onSuccess: (s) => {
      toastSuccess("Supplier Activated", `${s.name} is now an active supplier.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Activate Supplier", e),
  });
  const deactivate = useMutation({
    mutationFn: (id) => deactivateSupplier(id),
    onSuccess: (s) => {
      toastSuccess("Supplier Deactivated", `${s.name} has been deactivated.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Deactivate Supplier", e),
  });
  const remove     = useMutation({
    mutationFn: (id) => deleteSupplier(id),
    onSuccess: () => {
      toastSuccess("Supplier Removed", "The supplier record has been deleted.");
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Remove Supplier", e),
  });

  return {
    storeId, items, total, totalPages,
    isLoading, isFetching, error: error ?? null, refetch,
    create, update, activate, deactivate, remove,
  };
}

// ── Single supplier + stats hook ──────────────────────────────────────────────
export function useSupplier(id) {
  const qc = useQueryClient();

  const { data: supplier, isLoading: loadingSupplier, error } = useQuery({
    queryKey: ["supplier", id],
    queryFn:  () => getSupplier(id),
    enabled:  !!id,
    staleTime: 60 * 1000,
  });

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["supplier-stats", id],
    queryFn:  () => getSupplierStats(id),
    enabled:  !!id,
    staleTime: 60 * 1000,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["supplier",       id] });
    qc.invalidateQueries({ queryKey: ["supplier-stats", id] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  }, [qc, id]);

  const update = useMutation({
    mutationFn: (p) => updateSupplier(id, p),
    onSuccess: (s) => {
      toastSuccess("Supplier Updated", `Profile changes for ${s.name} have been saved.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Update Supplier", e),
  });
  const activate = useMutation({
    mutationFn: () => activateSupplier(id),
    onSuccess: (s) => {
      toastSuccess("Supplier Activated", `${s.name} is now an active supplier.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Activate Supplier", e),
  });
  const deactivate = useMutation({
    mutationFn: () => deactivateSupplier(id),
    onSuccess: (s) => {
      toastSuccess("Supplier Deactivated", `${s.name} has been deactivated.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Deactivate Supplier", e),
  });

  return {
    supplier, stats,
    isLoading: loadingSupplier || loadingStats,
    error: error ?? null,
    update, activate, deactivate,
  };
}

// ── Supplier spend timeline hook ──────────────────────────────────────────────
export function useSupplierSpendTimeline(id) {
  const { data, isLoading } = useQuery({
    queryKey: ["supplier-spend-timeline", id],
    queryFn:  () => getSupplierSpendTimeline(id),
    enabled:  !!id,
    staleTime: 5 * 60 * 1000,
  });
  return { timeline: data ?? [], isLoading };
}

// ── Supplier payments hook ────────────────────────────────────────────────────
export function useSupplierPayments(supplierId) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const { data: balance, isLoading: loadingBalance } = useQuery({
    queryKey: ["supplier-balance",  supplierId],
    queryFn:  () => getSupplierBalance(supplierId),
    enabled:  !!supplierId,
    staleTime: 30_000,
  });

  const { data: paymentsRaw, isLoading: loadingPayments } = useQuery({
    queryKey: ["supplier-payments", supplierId],
    queryFn:  () => getSupplierPayments({ supplier_id: supplierId, limit: 50 }),
    enabled:  !!supplierId,
    staleTime: 30_000,
  });

  const payments = useMemo(() => paymentsRaw ?? [], [paymentsRaw]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["supplier-balance",  supplierId] });
    qc.invalidateQueries({ queryKey: ["supplier-payments", supplierId] });
    qc.invalidateQueries({ queryKey: ["supplier",          supplierId] });
    qc.invalidateQueries({ queryKey: ["supplier-stats",    supplierId] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
  }, [qc, supplierId]);

  const record = useMutation({
    mutationFn: (p) => recordSupplierPayment({ supplier_id: supplierId, store_id: storeId, ...p }),
    onSuccess: () => {
      toastSuccess("Payment Recorded", "The supplier payment has been logged.");
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Record Payment", e),
  });

  return {
    balance,
    payments,
    isLoading: loadingBalance || loadingPayments,
    record,
  };
}

// ── Supplier purchase orders hook ─────────────────────────────────────────────
export function useSupplierPurchaseOrders(supplierId, { page = 1, limit = 10 } = {}) {
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-pos", supplierId, { page, limit }],
    queryFn:  () => getPurchaseOrders({
      supplier_id: supplierId,
      store_id:    branchStoreId,
      page,
      limit,
    }),
    enabled:  !!supplierId,
    staleTime: 30 * 1000,
  });

  const orders = useMemo(() => data?.data ?? [], [data]);
  const total  = data?.total ?? 0;

  return { orders, total, isLoading };
}
