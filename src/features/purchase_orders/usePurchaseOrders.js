// features/purchase_orders/usePurchaseOrders.js
import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getPurchaseOrders, getPurchaseOrder,
  createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder,
  submitPurchaseOrder, approvePurchaseOrder, rejectPurchaseOrder,
  deletePurchaseOrder,
} from "@/commands/purchase_orders";
import { invalidateAfterPOReceive, invalidateAfterPOChange } from "@/lib/invalidations";

// ── PO list hook ──────────────────────────────────────────────────────────────
export function usePurchaseOrders({
  storeIdOverride, supplierId, status, dateFrom, dateTo,
  page = 1, limit = 20,
} = {}) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  const queryKey = ["purchase-orders", storeId, { supplierId, status, dateFrom, dateTo, page, limit }];

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getPurchaseOrders({
      store_id:    storeId,
      supplier_id: supplierId  || undefined,
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

  const orders     = useMemo(() => data?.data       ?? [], [data]);
  const total      = data?.total      ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const invalidate    = useCallback(() => qc.invalidateQueries({ queryKey: ["purchase-orders", storeId] }), [qc, storeId]);
  const invalidateAll = useCallback(() => qc.invalidateQueries({ queryKey: ["purchase-orders"] }),          [qc]);

  const create = useMutation({
    mutationFn: (p) => createPurchaseOrder({ store_id: storeId, ...p }),
    onSuccess: invalidate,
  });

  return {
    storeId, orders, total, totalPages,
    isLoading, isFetching, error: error ?? null, refetch,
    create, invalidate, invalidateAll,
  };
}

// ── Single PO hook ────────────────────────────────────────────────────────────
export function usePurchaseOrder(id) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data: detail, isLoading, error, refetch } = useQuery({
    queryKey: ["purchase-order", id],
    queryFn:  () => getPurchaseOrder(id),
    enabled:  !!id,
    staleTime: 30 * 1000,
  });

  // receive: stock changes + PO status changes
  const invalidateReceive = useCallback(() => invalidateAfterPOReceive(storeId, id), [storeId, id]);
  // all other status transitions: only PO list/detail changes, no stock
  const invalidateChange  = useCallback(() => invalidateAfterPOChange(id), [id]);

  const receive  = useMutation({ mutationFn: ({ items, notes }) => receivePurchaseOrder(id, items, notes), onSuccess: invalidateReceive });
  const cancel   = useMutation({ mutationFn: () => cancelPurchaseOrder(id),               onSuccess: invalidateChange });
  const submit   = useMutation({ mutationFn: () => submitPurchaseOrder(id),               onSuccess: invalidateChange });
  const approve  = useMutation({ mutationFn: () => approvePurchaseOrder(id),              onSuccess: invalidateChange });
  const reject   = useMutation({ mutationFn: (reason) => rejectPurchaseOrder(id, reason), onSuccess: invalidateChange });
  const remove   = useMutation({ mutationFn: () => deletePurchaseOrder(id),               onSuccess: invalidateChange });

  return {
    detail,
    order: detail?.order ?? null,
    items: detail?.items ?? [],
    isLoading, error: error ?? null, refetch,
    receive, cancel, submit, approve, reject, remove,
  };
}
