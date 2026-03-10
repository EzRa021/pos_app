// ============================================================================
// features/departments/useDepartments.js
// ============================================================================

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  activateDepartment,
  deactivateDepartment,
  deleteDepartment,
  hardDeleteDepartment,
} from "@/commands/departments";

export const departmentsQueryKey = (storeId) => ["departments", storeId];

export function useDepartments(storeIdOverride) {
  const qc            = useQueryClient();
  const branchStoreId = useBranchStore((s) => s.activeStore?.id);
  const storeId       = storeIdOverride ?? branchStoreId;
  const queryKey      = departmentsQueryKey(storeId);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn:   () => getDepartments(storeId),
    enabled:   !!storeId,
    staleTime: 5 * 60 * 1000,
  });

  const departments = useMemo(() => data ?? [], [data]);
  const activeDepartments = useMemo(
    () => departments.filter((d) => d.is_active),
    [departments],
  );

  const invalidate    = useCallback(() => qc.invalidateQueries({ queryKey }),                      [qc, queryKey]);
  const invalidateAll = useCallback(() => qc.invalidateQueries({ queryKey: ["departments"] }),     [qc]);

  // ── Create ────────────────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: (payload) => createDepartment({ store_id: storeId, ...payload }),
    onSuccess:  invalidate,
  });

  // ── Update ────────────────────────────────────────────────────────────────
  const update = useMutation({
    mutationFn: ({ id, ...payload }) => updateDepartment(id, payload),
    onSuccess:  invalidate,
  });

  // ── Dedicated activate / deactivate ───────────────────────────────────────
  const activate = useMutation({
    mutationFn: (id) => activateDepartment(id),
    onSuccess:  invalidateAll,
  });

  const deactivate = useMutation({
    mutationFn: (id) => deactivateDepartment(id),
    onSuccess:  invalidateAll,
  });

  // ── Hard delete ───────────────────────────────────────────────────────────
  const hardDelete = useMutation({
    mutationFn: (id) => hardDeleteDepartment(id),
    onSuccess:  invalidateAll,
  });

  const getDeptById = useCallback(
    (id) => departments.find((d) => d.id === id),
    [departments],
  );

  return {
    storeId,
    departments,
    activeDepartments,
    isLoading,
    error:      error ?? null,
    refetch,
    create,
    update,
    activate,
    deactivate,
    hardDelete,
    getDeptById,
  };
}
