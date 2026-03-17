// ============================================================================
// features/items/useItems.js
// ============================================================================
// Data hooks for the product catalog feature.
//
// useItems(filters)   — paginated list + all mutations
// useItem(id)         — single item detail + per-item mutations
// useItemHistory(id)  — paginated history log for one item
//
// All mutations call their onSuccess to invalidate the list cache so every
// table / stat card refreshes automatically after a write.
// ============================================================================

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getItems, getItem, getItemHistory,
  createItem, updateItem,
  activateItem, deactivateItem, archiveItem, adjustStock, removeItemImage,
} from "@/commands/items";
import { getInventorySummary } from "@/commands/inventory";
import { invalidateStock } from "@/lib/invalidations";

// ── Query key factories ────────────────────────────────────────────────────────
export const itemListKey    = (filters) => ["items",        filters];
export const itemKey        = (id)      => ["item",         id];
export const itemHistoryKey = (id, pg)  => ["item_history", id, pg];
export const invSummaryKey  = (storeId) => ["inv_summary",  storeId];

// ── useItems — paginated list ──────────────────────────────────────────────────
export function useItems({
  page              = 1,
  limit             = 25,
  search,
  categoryId,
  departmentId,
  isActive,         // true | false | undefined (= no filter)
  availableForPos,
  lowStock,
} = {}) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);

  // Stable filter object. Building this inline in useQuery creates a new object
  // every render → infinite refetch loop.
  const filters = useMemo(() => ({
    store_id:          branchStoreId ?? null,
    page,
    limit,
    search:            search           || null,
    category_id:       categoryId       ?? null,
    department_id:     departmentId     ?? null,
    is_active:         isActive         ?? null,
    available_for_pos: availableForPos  ?? null,
    low_stock:         lowStock         ?? null,
  }), [branchStoreId, page, limit, search, categoryId, departmentId, isActive, availableForPos, lowStock]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey:        itemListKey(filters),
    queryFn:         () => getItems(filters),
    enabled:         !!branchStoreId,
    staleTime:       2 * 60 * 1000,
    placeholderData: (prev) => prev, // smooth pagination
  });

  // Inventory summary — separate cache key so list filters don't bust stats
  const { data: summary } = useQuery({
    queryKey:  invSummaryKey(branchStoreId),
    queryFn:   () => getInventorySummary(branchStoreId),
    enabled:   !!branchStoreId,
    staleTime: 5 * 60 * 1000,
  });

  const invalidateAll = useCallback(() => {
    invalidateStock(branchStoreId);
  }, [branchStoreId]);

  const create = useMutation({
    mutationFn: (payload) => createItem({ store_id: branchStoreId, ...payload }),
    onSuccess:  invalidateAll,
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }) => updateItem(id, payload),
    onSuccess: (updated) => {
      qc.setQueryData(itemKey(updated.id), updated);
      invalidateAll();
    },
  });

  const activate = useMutation({
    mutationFn: (id) => activateItem(id),
    onSuccess: (updated) => { qc.setQueryData(itemKey(updated.id), updated); invalidateAll(); },
  });

  const deactivate = useMutation({
    mutationFn: (id) => deactivateItem(id),
    onSuccess: (updated) => { qc.setQueryData(itemKey(updated.id), updated); invalidateAll(); },
  });

  const archive = useMutation({
    mutationFn: (id) => archiveItem(id),
    onSuccess:  invalidateAll,
  });

  const stockAdjust = useMutation({
    mutationFn: (payload) => adjustStock({ store_id: branchStoreId, ...payload }),
    onSuccess: (updated) => {
      qc.setQueryData(itemKey(updated.id), updated);
      invalidateAll();
    },
  });

  const removeImage = useMutation({
    mutationFn: (id) => removeItemImage(id),
    onSuccess: (updated) => {
      qc.setQueryData(itemKey(updated.id), updated);
      invalidateAll();
    },
  });

  return {
    storeId:     branchStoreId,
    items:       useMemo(() => data?.data        ?? [], [data]),
    total:       data?.total       ?? 0,
    totalPages:  data?.total_pages ?? 1,
    currentPage: data?.page        ?? page,
    isLoading,
    isFetching,
    error:       error ?? null,
    summary:     summary ?? null,
    create,
    update,
    activate,
    deactivate,
    archive,
    adjustStock: stockAdjust,
    removeImage,
    invalidateAll,
  };
}

// ── useItem — single item ─────────────────────────────────────────────────────
export function useItem(id) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);

  const { data: item, isLoading, error } = useQuery({
    queryKey:  itemKey(id),
    queryFn:   () => getItem(id),
    enabled:   !!id,
    staleTime: 2 * 60 * 1000,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: itemKey(id) });
    invalidateStock(branchStoreId);
  }, [qc, id, branchStoreId]);

  const update = useMutation({
    mutationFn: (payload) => updateItem(id, payload),
    onSuccess: (updated) => { qc.setQueryData(itemKey(id), updated); invalidate(); },
  });

  const activate = useMutation({
    mutationFn: () => activateItem(id),
    onSuccess: (updated) => { qc.setQueryData(itemKey(id), updated); invalidate(); },
  });

  const deactivate = useMutation({
    mutationFn: () => deactivateItem(id),
    onSuccess: (updated) => { qc.setQueryData(itemKey(id), updated); invalidate(); },
  });

  const archive = useMutation({
    mutationFn: () => archiveItem(id),
    onSuccess:  invalidate,
  });

  const stockAdjust = useMutation({
    mutationFn: (payload) => adjustStock({ store_id: branchStoreId, ...payload }),
    onSuccess: (updated) => {
      qc.setQueryData(itemKey(id), updated);
      qc.invalidateQueries({ queryKey: ["item_history", id] });
      invalidate();
    },
  });

  const removeImage = useMutation({
    mutationFn: () => removeItemImage(id),
    onSuccess: (updated) => {
      qc.setQueryData(itemKey(id), updated);
      invalidate();
    },
  });

  return {
    item:        item ?? null,
    isLoading,
    error:       error ?? null,
    storeId:     branchStoreId,
    update,
    activate,
    deactivate,
    archive,
    adjustStock: stockAdjust,
    removeImage,
  };
}

// ── useItemHistory ────────────────────────────────────────────────────────────
export function useItemHistory(itemId, { page = 1, limit = 20, dateFrom, dateTo, eventType } = {}) {
  const filters = useMemo(() => ({
    page,
    limit,
    date_from:  dateFrom  || null,
    date_to:    dateTo    || null,
    event_type: eventType || null,
  }), [page, limit, dateFrom, dateTo, eventType]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  ["item_history", itemId, filters],
    queryFn:   () => getItemHistory(itemId, filters),
    enabled:   !!itemId,
    staleTime: 60 * 1000,
  });

  return {
    history:    useMemo(() => data?.data ?? [], [data]),
    total:      data?.total       ?? 0,
    totalPages: data?.total_pages ?? 1,
    isLoading,
    error:      error ?? null,
    refetch,
  };
}
