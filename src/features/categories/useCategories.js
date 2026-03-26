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
import { toastSuccess, onMutationError } from "@/lib/toast";

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
    onSuccess: (c) => {
      toastSuccess("Category Created", `"${c.name}" has been added to your catalog.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Create Category", e),
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }) => updateCategory(id, payload),
    onSuccess: (c) => {
      toastSuccess("Category Updated", `Changes to "${c.name}" have been saved.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Update Category", e),
  });

  // Dedicated endpoints — no more update({ is_active }) workaround
  const activate = useMutation({
    mutationFn: (id) => activateCategory(id),
    onSuccess: (c) => {
      toastSuccess("Category Activated", `"${c.name}" is now active.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Activate Category", e),
  });

  const deactivate = useMutation({
    mutationFn: (id) => deactivateCategory(id),
    onSuccess: (c) => {
      toastSuccess("Category Deactivated", `"${c.name}" has been deactivated.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Deactivate Category", e),
  });

  const hardDelete = useMutation({
    mutationFn: (id) => hardDeleteCategory(id),
    onSuccess: () => {
      toastSuccess("Category Deleted", "The category has been permanently removed.");
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Delete Category", e),
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
