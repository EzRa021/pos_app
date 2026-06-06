// features/price_management/usePriceManagement.js
import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getPriceLists, createPriceList, updatePriceList, deletePriceList,
  getPriceListItems, addPriceListItem, removePriceListItem,
  getPriceChanges, getPriceChangeStats, requestPriceChange,
  approvePriceChange, rejectPriceChange,
  getPendingScheduledChanges, schedulePriceChange,
  cancelScheduledPriceChange, applyScheduledPrices,
  getItemPriceHistory,
} from "@/commands/price_management";

import { toastSuccess, onMutationError } from "@/lib/toast";

// ── Shared error normalizer ───────────────────────────────────────────────────
// The Axios interceptor rejects with a plain string (not an Error object).
// This normalizes both cases so callers always get a readable message.
export function extractError(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err?.message ?? err?.error ?? JSON.stringify(err);
}

// ── Price Lists ───────────────────────────────────────────────────────────────
export function usePriceLists() {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const queryKey = useMemo(() => ["price-lists", storeId], [storeId]);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn:   () => getPriceLists({ store_id: storeId }),
    enabled:   !!storeId,
    staleTime: 2 * 60_000,
  });

  const lists = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data : (data?.data ?? []);
  }, [data]);

  // Always build invalidation around the live storeId value so stale closures
  // in mutations never bust the wrong cache key.
  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["price-lists", storeId] }),
    [qc, storeId],
  );

  const create = useMutation({
    mutationFn: (p) => {
      if (!storeId) return Promise.reject("No active store selected.");
      return createPriceList({ store_id: storeId, ...p });
    },
    onSuccess: (pl) => {
      // Fixed: was pl?.name — the model field is list_name
      toastSuccess("Price List Created", `"${pl?.list_name ?? "Price list"}" is ready to assign to customers.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Create Price List", e),
  });

  const update = useMutation({
    mutationFn: ({ id, ...p }) => updatePriceList(id, p),
    onSuccess: (pl) => {
      // Fixed: was pl?.name — the model field is list_name
      toastSuccess("Price List Updated", `"${pl?.list_name ?? "Price list"}" changes have been saved.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Update Price List", e),
  });

  const remove = useMutation({
    mutationFn: (id) => deletePriceList(id),
    onSuccess: () => {
      toastSuccess("Price List Deleted", "The price list has been permanently removed.");
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Delete Price List", e),
  });

  return { storeId, lists, isLoading, error: error ?? null, create, update, remove };
}

// ── Price List Items (for a single list) ─────────────────────────────────────
export function usePriceListItems(priceListId) {
  const qc       = useQueryClient();
  const queryKey = useMemo(() => ["price-list-items", priceListId], [priceListId]);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn:   () => getPriceListItems(priceListId),
    enabled:   !!priceListId,
    staleTime: 60_000,
  });

  const items = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data : (data?.data ?? []);
  }, [data]);

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["price-list-items", priceListId] }),
    [qc, priceListId],
  );

  const addItem = useMutation({
    mutationFn: (p) => {
      if (!priceListId) return Promise.reject("No price list selected.");
      return addPriceListItem({ price_list_id: priceListId, ...p });
    },
    onSuccess: () => {
      toastSuccess("Item Price Set", "The custom price has been added to this price list.");
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Set Item Price", e),
  });

  const removeItem = useMutation({
    mutationFn: (itemId) => {
      if (!priceListId) return Promise.reject("No price list selected.");
      return removePriceListItem(priceListId, itemId);
    },
    onSuccess: () => {
      toastSuccess("Item Removed", "The item has been removed from this price list.");
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Remove Item", e),
  });

  return { items, isLoading, addItem, removeItem };
}

// ── Price Change Stats (replaces 200-row JS counting) ────────────────────────
export function usePriceChangeStats() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading } = useQuery({
    queryKey:  ["price-change-stats", storeId],
    queryFn:   () => getPriceChangeStats(storeId),
    enabled:   !!storeId,
    staleTime: 30_000,
    placeholderData: { total_count: 0, pending_count: 0, applied_count: 0, rejected_count: 0 },
  });

  return {
    totalCount:    data?.total_count    ?? 0,
    pendingCount:  data?.pending_count  ?? 0,
    appliedCount:  data?.applied_count  ?? 0,
    rejectedCount: data?.rejected_count ?? 0,
    isLoading,
  };
}

// ── Price Change Requests ─────────────────────────────────────────────────────
export function usePriceChanges({ status, page = 1, limit = 20 } = {}) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const queryKey = useMemo(
    () => ["price-changes", storeId, { status, page, limit }],
    [storeId, status, page, limit],
  );

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => getPriceChanges({
      store_id: storeId,
      status:   status || undefined,
      page,
      limit,
    }),
    enabled:         !!storeId,
    staleTime:       30_000,
    placeholderData: (prev) => prev,
  });

  const records    = useMemo(() => data?.data ?? [], [data]);
  const total      = data?.total      ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const invalidateAll = useCallback(
    () => qc.invalidateQueries({ queryKey: ["price-changes", storeId] }),
    [qc, storeId],
  );

  // Bust item caches + stats after price is actually applied
  const invalidateWithItems = useCallback(() => {
    invalidateAll();
    qc.invalidateQueries({ queryKey: ["price-change-stats", storeId] });
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["item"] });
    qc.invalidateQueries({ queryKey: ["pos-items"] });
  }, [qc, storeId, invalidateAll]);

  const request = useMutation({
    mutationFn: (p) => {
      if (!storeId) return Promise.reject("No active store selected.");
      return requestPriceChange({ store_id: storeId, ...p });
    },
    onSuccess: () => {
      toastSuccess("Price Change Requested", "Your request has been submitted and is awaiting approval.");
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["price-change-stats", storeId] });
    },
    onError: (e) => onMutationError("Couldn't Request Price Change", e),
  });

  const approve = useMutation({
    mutationFn: (id) => approvePriceChange(id),
    onSuccess: () => {
      toastSuccess("Price Change Approved", "The new price is now live across the POS.");
      invalidateWithItems();
    },
    onError: (e) => onMutationError("Couldn't Approve Price Change", e),
  });

  const reject = useMutation({
    mutationFn: (id) => rejectPriceChange(id),
    onSuccess: () => {
      toastSuccess("Price Change Rejected", "The request has been declined.");
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["price-change-stats", storeId] });
    },
    onError: (e) => onMutationError("Couldn't Reject Price Change", e),
  });

  return {
    storeId, records, total, totalPages,
    isLoading, isFetching, error: error ?? null,
    request, approve, reject,
  };
}

// ── Scheduled Price Changes ───────────────────────────────────────────────────
export function useScheduledPriceChanges(includeApplied = false) {
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const queryKey = useMemo(
    () => ["scheduled-price-changes", storeId, includeApplied],
    [storeId, includeApplied],
  );

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn:   () => getPendingScheduledChanges(storeId, includeApplied),
    enabled:   !!storeId,
    staleTime: 30_000,
  });

  const records = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data : (data?.data ?? []);
  }, [data]);

  const invalidateAll = useCallback(
    () => qc.invalidateQueries({ queryKey: ["scheduled-price-changes", storeId] }),
    [qc, storeId],
  );

  const invalidateWithItems = useCallback(() => {
    invalidateAll();
    qc.invalidateQueries({ queryKey: ["price-change-stats", storeId] });
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["item"] });
    qc.invalidateQueries({ queryKey: ["pos-items"] });
  }, [qc, storeId, invalidateAll]);

  const schedule = useMutation({
    mutationFn: (p) => {
      if (!storeId) return Promise.reject("No active store selected.");
      return schedulePriceChange({ store_id: storeId, ...p });
    },
    onSuccess: () => {
      // Fixed copy: "automatically" was misleading — apply is manual
      toastSuccess("Price Change Scheduled", "The price update will apply on the set date when you click Apply.");
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Schedule Price Change", e),
  });

  const cancel = useMutation({
    mutationFn: (id) => cancelScheduledPriceChange(id),
    onSuccess: () => {
      toastSuccess("Scheduled Change Cancelled", "The upcoming price change has been removed.");
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Cancel Scheduled Change", e),
  });

  const applyDue = useMutation({
    mutationFn: () => applyScheduledPrices(),
    onSuccess: () => {
      toastSuccess("Scheduled Prices Applied", "All due price changes have been pushed live.");
      invalidateWithItems();
    },
    onError: (e) => onMutationError("Couldn't Apply Scheduled Prices", e),
  });

  return {
    storeId, records, isLoading, error: error ?? null,
    schedule, cancel, applyDue,
  };
}

// ── Item Price History ────────────────────────────────────────────────────────
export function useItemPriceHistory(itemId, storeId) {
  const { data, isLoading } = useQuery({
    queryKey:  ["price-history", itemId, storeId],
    queryFn:   () => getItemPriceHistory(itemId, storeId, 50),
    enabled:   !!itemId && !!storeId,
    staleTime: 5 * 60_000,
  });

  const history = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data : (data?.data ?? []);
  }, [data]);

  return { history, isLoading };
}
