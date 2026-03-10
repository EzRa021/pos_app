// features/suppliers/useSuppliers.js
import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getSuppliers, getSupplier, getSupplierStats,
  createSupplier, updateSupplier,
  activateSupplier, deactivateSupplier, deleteSupplier,
} from "@/commands/suppliers";
import { getPurchaseOrders } from "@/commands/purchase_orders";

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
    onSuccess: invalidate,
  });
  const update     = useMutation({
    mutationFn: ({ id, ...p }) => updateSupplier(id, p),
    onSuccess: invalidateAll,
  });
  const activate   = useMutation({
    mutationFn: (id) => activateSupplier(id),
    onSuccess: invalidateAll,
  });
  const deactivate = useMutation({
    mutationFn: (id) => deactivateSupplier(id),
    onSuccess: invalidateAll,
  });
  const remove     = useMutation({
    mutationFn: (id) => deleteSupplier(id),
    onSuccess: invalidateAll,
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
    onSuccess:  invalidate,
  });
  const activate = useMutation({
    mutationFn: () => activateSupplier(id),
    onSuccess:  invalidate,
  });
  const deactivate = useMutation({
    mutationFn: () => deactivateSupplier(id),
    onSuccess:  invalidate,
  });

  return {
    supplier, stats,
    isLoading: loadingSupplier || loadingStats,
    error: error ?? null,
    update, activate, deactivate,
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
