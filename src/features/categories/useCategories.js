// ============================================================================
// features/categories/useCategories.js
// ============================================================================

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getCategories,
  createCategory,
  updateCategory,
  activateCategory,
  deactivateCategory,
  hardDeleteCategory,
} from "@/commands/categories";

export const categoriesQueryKey = (storeId) => ["categories", storeId];

export function useCategories(storeIdOverride) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;
  const queryKey      = categoriesQueryKey(storeId);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn:   () => getCategories(storeId),
    enabled:   !!storeId,
    staleTime: 5 * 60 * 1000,
  });

  const categories = useMemo(() => data ?? [], [data]);

  const invalidate    = useCallback(() => qc.invalidateQueries({ queryKey }),                     [qc, queryKey]);
  const invalidateAll = useCallback(() => qc.invalidateQueries({ queryKey: ["categories"] }),     [qc]);

  const create = useMutation({
    mutationFn: (payload) => createCategory({ store_id: storeId, ...payload }),
    onSuccess:  invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }) => updateCategory(id, payload),
    onSuccess:  invalidate,
  });

  // Dedicated endpoints — no more update({ is_active }) workaround
  const activate = useMutation({
    mutationFn: (id) => activateCategory(id),
    onSuccess:  invalidateAll,
  });

  const deactivate = useMutation({
    mutationFn: (id) => deactivateCategory(id),
    onSuccess:  invalidateAll,
  });

  const hardDelete = useMutation({
    mutationFn: (id) => hardDeleteCategory(id),
    onSuccess:  invalidateAll,
  });

  const getCategoryById = useCallback(
    (id) => categories.find((c) => c.id === id),
    [categories],
  );

  return {
    storeId,
    categories,
    isLoading,
    error:      error ?? null,
    refetch,
    create,
    update,
    activate,
    deactivate,
    hardDelete,
    getCategoryById,
  };
}
