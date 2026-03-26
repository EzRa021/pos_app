// ============================================================================
// features/stores/useStores.js
// ============================================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getStores, getStore, createStore, updateStore,
  activateStore, deactivateStore, getStoreUsers,
} from "@/commands/stores";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { useBranchStore } from "@/stores/branch.store";

// ── Query key factories ────────────────────────────────────────────────────────
export const storeListKey  = (params) => ["stores", params];
export const storeKey      = (id)     => ["store", id];
export const storeUsersKey = (id)     => ["store-users", id];

// ── useStores — full list (admin / super_admin) ───────────────────────────────
export function useStores({ isActive } = {}) {
  const qc = useQueryClient();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey:        storeListKey({ isActive }),
    queryFn:         () => getStores({ is_active: isActive }),
    staleTime:       2 * 60_000,
    placeholderData: (prev) => prev,
  });

  const stores = Array.isArray(data) ? data : (data?.data ?? []);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["stores"] });

  const create = useMutation({
    mutationFn: (payload) => createStore(payload),
    onSuccess: (s) => {
      toastSuccess("Store Created", `"${s.store_name}" is ready to use.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Create Store", e),
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }) => updateStore(id, payload),
    onSuccess: (s) => {
      toastSuccess("Store Updated", `Changes to "${s.store_name}" have been saved.`);
      qc.setQueryData(storeKey(s.id), s);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Update Store", e),
  });

  const activate = useMutation({
    mutationFn: (id) => activateStore(id),
    onSuccess: (s) => {
      toastSuccess("Store Activated", `"${s.store_name}" is now active.`);
      qc.setQueryData(storeKey(s.id), s);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Activate Store", e),
  });

  const deactivate = useMutation({
    mutationFn: (id) => deactivateStore(id),
    onSuccess: (s) => {
      toastSuccess("Store Deactivated", `"${s.store_name}" has been deactivated.`);
      qc.setQueryData(storeKey(s.id), s);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Deactivate Store", e),
  });

  return {
    stores,
    total:      stores.length,
    isLoading,
    isFetching,
    error:      error ?? null,
    refetch,
    create,
    update,
    activate,
    deactivate,
  };
}

// ── useStore — single store ────────────────────────────────────────────────────
export function useStore(id) {
  const qc = useQueryClient();

  const { data: store, isLoading, error, refetch } = useQuery({
    queryKey:  storeKey(id),
    queryFn:   () => getStore(id),
    enabled:   !!id,
    staleTime: 2 * 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: storeKey(id) });
    qc.invalidateQueries({ queryKey: ["stores"] });
  };

  const update = useMutation({
    mutationFn: (payload) => updateStore(id, payload),
    onSuccess: (s) => {
      toastSuccess("Store Updated", `Changes to "${s.store_name}" have been saved.`);
      qc.setQueryData(storeKey(id), s);
      invalidate();
      // If this is the active store, patch it in branchStore too
      const activeStore = useBranchStore.getState().activeStore;
      if (activeStore?.id === id) {
        useBranchStore.getState().setActiveStore(s);
      }
    },
    onError: (e) => onMutationError("Couldn't Update Store", e),
  });

  const activate = useMutation({
    mutationFn: () => activateStore(id),
    onSuccess: (s) => {
      toastSuccess("Store Activated", `"${s.store_name}" is now active.`);
      qc.setQueryData(storeKey(id), s);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Activate Store", e),
  });

  const deactivate = useMutation({
    mutationFn: () => deactivateStore(id),
    onSuccess: (s) => {
      toastSuccess("Store Deactivated", `"${s.store_name}" has been deactivated.`);
      qc.setQueryData(storeKey(id), s);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Deactivate Store", e),
  });

  return {
    store:     store ?? null,
    isLoading,
    error:     error ?? null,
    refetch,
    update,
    activate,
    deactivate,
  };
}

// ── useStoreUsers — users assigned to a store ─────────────────────────────────
export function useStoreUsers(storeId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey:  storeUsersKey(storeId),
    queryFn:   () => getStoreUsers(storeId),
    enabled:   !!storeId,
    staleTime: 60_000,
  });

  return {
    users:     data ?? [],
    isLoading,
    error:     error ?? null,
    refetch,
  };
}
