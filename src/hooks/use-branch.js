// ============================================================================
// useBranch — Hook
// Thin, ergonomic wrapper over the branch Zustand store.
//
// Usage:
//   const { activeStore, canSwitch, switchStore } = useBranch()
//
// canSwitch is true for global users (admin/super_admin) who can freely
// move between branches. Store-bound users cannot switch branches.
// ============================================================================

import { useBranchStore } from "@/stores/branch.store";
import { useAuthStore }   from "@/stores/auth.store";

export function useBranch() {
  const activeStore          = useBranchStore(s => s.activeStore);
  const stores               = useBranchStore(s => s.stores);
  const isLoading            = useBranchStore(s => s.isLoading);
  const needsPicker          = useBranchStore(s => s.needsPicker);
  const isBranchInitialized  = useBranchStore(s => s.isBranchInitialized);

  const setActiveStore = useBranchStore(s => s.setActiveStore);
  const switchStore    = useBranchStore(s => s.switchStore);
  const reloadStores   = useBranchStore(s => s.reloadStores);

  const token    = useAuthStore(s => s.token);
  const isGlobal = useAuthStore(s => s.user?.is_global === true);

  // Only global-role users can switch branches
  const canSwitch = isGlobal;

  // Convenience: ID and display name
  const storeId   = activeStore?.id   ?? null;
  const storeName = activeStore?.store_name ?? null;

  return {
    // State
    activeStore,
    stores,       // all stores (populated for global users)
    isLoading,
    needsPicker,
    isBranchInitialized,
    canSwitch,
    storeId,
    storeName,

    // Actions
    setActiveStore,
    switchStore: (id) => switchStore(id, token),
    reloadStores: ()  => reloadStores(token),
  };
}
