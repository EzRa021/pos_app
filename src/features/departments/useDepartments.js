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
import { toastSuccess, onMutationError } from "@/lib/toast";

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
    onSuccess: (d) => {
      toastSuccess("Department Created", `"${d.name}" is ready to organise your products.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Create Department", e),
  });

  // ── Update ────────────────────────────────────────────────────────────────
  const update = useMutation({
    mutationFn: ({ id, ...payload }) => updateDepartment(id, payload),
    onSuccess: (d) => {
      toastSuccess("Department Updated", `Changes to "${d.name}" have been saved.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Update Department", e),
  });

  // ── Dedicated activate / deactivate ───────────────────────────────────────
  const activate = useMutation({
    mutationFn: (id) => activateDepartment(id),
    onSuccess: (d) => {
      toastSuccess("Department Activated", `"${d.name}" is now active.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Activate Department", e),
  });

  const deactivate = useMutation({
    mutationFn: (id) => deactivateDepartment(id),
    onSuccess: (d) => {
      toastSuccess("Department Deactivated", `"${d.name}" has been deactivated.`);
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Deactivate Department", e),
  });

  // ── Hard delete ───────────────────────────────────────────────────────────
  const hardDelete = useMutation({
    mutationFn: (id) => hardDeleteDepartment(id),
    onSuccess: () => {
      toastSuccess("Department Deleted", "The department has been permanently removed.");
      invalidateAll();
    },
    onError: (e) => onMutationError("Couldn't Delete Department", e),
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
