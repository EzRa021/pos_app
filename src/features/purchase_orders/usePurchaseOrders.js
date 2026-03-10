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
  const qc = useQueryClient();

  const { data: detail, isLoading, error, refetch } = useQuery({
    queryKey: ["purchase-order", id],
    queryFn:  () => getPurchaseOrder(id),
    enabled:  !!id,
    staleTime: 30 * 1000,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["purchase-order",  id] });
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    // Receiving stock also changes item quantities — invalidate items
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
  }, [qc, id]);

  const receive  = useMutation({ mutationFn: ({ items, notes }) => receivePurchaseOrder(id, items, notes), onSuccess: invalidate });
  const cancel   = useMutation({ mutationFn: () => cancelPurchaseOrder(id),              onSuccess: invalidate });
  const submit   = useMutation({ mutationFn: () => submitPurchaseOrder(id),              onSuccess: invalidate });
  const approve  = useMutation({ mutationFn: () => approvePurchaseOrder(id),             onSuccess: invalidate });
  const reject   = useMutation({ mutationFn: (reason) => rejectPurchaseOrder(id, reason), onSuccess: invalidate });
  const remove   = useMutation({ mutationFn: () => deletePurchaseOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });

  return {
    detail,
    order: detail?.order ?? null,
    items: detail?.items ?? [],
    isLoading, error: error ?? null, refetch,
    receive, cancel, submit, approve, reject, remove,
  };
}
