// features/purchase_orders/usePurchaseOrders.js
import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getPurchaseOrders, getPurchaseOrder, getPoStats,
  createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder,
  submitPurchaseOrder, approvePurchaseOrder, rejectPurchaseOrder,
  deletePurchaseOrder,
} from "@/commands/purchase_orders";
import { invalidateAfterPOReceive, invalidateAfterPOChange } from "@/lib/invalidations";
import { toastSuccess, onMutationError } from "@/lib/toast";

// ── PO list hook ──────────────────────────────────────────────────────────────
export function usePurchaseOrders({
  storeIdOverride, supplierId, status, dateFrom, dateTo,
  search, page = 1, limit = 20,
} = {}) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  const queryKey = ["purchase-orders", storeId, { supplierId, status, dateFrom, dateTo, search, page, limit }];

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getPurchaseOrders({
      store_id:    storeId,
      supplier_id: supplierId  || undefined,
      status:      status      || undefined,
      date_from:   dateFrom    || undefined,
      date_to:     dateTo      || undefined,
      search:      search      || undefined,
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
    onSuccess: (po) => {
      toastSuccess("Purchase Order Created", `PO #${po?.id ?? ""} has been drafted and is ready to submit.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Create Purchase Order", e),
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

  const receive  = useMutation({
    mutationFn: ({ items, notes }) => receivePurchaseOrder(id, items, notes),
    onSuccess: () => {
      toastSuccess("Stock Received", "Items have been added to inventory and stock levels updated.");
      invalidateReceive();
    },
    onError: (e) => onMutationError("Couldn't Receive Stock", e),
  });
  const cancel   = useMutation({
    mutationFn: () => cancelPurchaseOrder(id),
    onSuccess: () => {
      toastSuccess("PO Cancelled", "The purchase order has been cancelled.");
      invalidateChange();
    },
    onError: (e) => onMutationError("Couldn't Cancel PO", e),
  });
  const submit   = useMutation({
    mutationFn: () => submitPurchaseOrder(id),
    onSuccess: () => {
      toastSuccess("PO Submitted", "The purchase order has been sent for approval.");
      invalidateChange();
    },
    onError: (e) => onMutationError("Couldn't Submit PO", e),
  });
  const approve  = useMutation({
    mutationFn: () => approvePurchaseOrder(id),
    onSuccess: () => {
      toastSuccess("PO Approved", "The purchase order is now approved and ready to receive.");
      invalidateChange();
    },
    onError: (e) => onMutationError("Couldn't Approve PO", e),
  });
  const reject   = useMutation({
    mutationFn: (reason) => rejectPurchaseOrder(id, reason),
    onSuccess: () => {
      toastSuccess("PO Rejected", "The purchase order has been rejected.");
      invalidateChange();
    },
    onError: (e) => onMutationError("Couldn't Reject PO", e),
  });
  const remove   = useMutation({
    mutationFn: () => deletePurchaseOrder(id),
    onSuccess: () => {
      toastSuccess("PO Deleted", "The purchase order has been permanently removed.");
      invalidateChange();
    },
    onError: (e) => onMutationError("Couldn't Delete PO", e),
  });

  const items = useMemo(() => detail?.items ?? [], [detail]);

  return {
    detail,
    order: detail?.order ?? null,
    items,
    isLoading, error: error ?? null, refetch,
    receive, cancel, submit, approve, reject, remove,
  };
}

// ── PO stats hook (single aggregate query) ────────────────────────────────────
export function usePoStats(storeIdOverride) {
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;

  const { data } = useQuery({
    queryKey:  ["po-stats", storeId],
    queryFn:   () => getPoStats(storeId),
    enabled:   !!storeId,
    staleTime: 60 * 1000,
  });

  return {
    total:     data?.total     ?? 0,
    draft:     data?.draft     ?? 0,
    pending:   data?.pending   ?? 0,
    approved:  data?.approved  ?? 0,
    received:  data?.received  ?? 0,
    cancelled: data?.cancelled ?? 0,
    rejected:  data?.rejected  ?? 0,
  };
}
