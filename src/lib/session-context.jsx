// ============================================================================
// session-context — Compatibility shim
//
// The real state now lives in Zustand stores. Prefer using stores directly:
//   import { useAuthStore }   from "@/stores/auth.store"
//   import { useBranchStore } from "@/stores/branch.store"
//   import { useAuth }        from "@/hooks/use-auth"
//   import { useBranch }      from "@/hooks/use-branch"
// ============================================================================

import { createContext } from "react";
import { useAuthStore }   from "@/stores/auth.store";
import { useBranchStore } from "@/stores/branch.store";

/** @deprecated Kept for backward compat — no longer used as a Provider. */
export const SessionContext = createContext(null);

/** @deprecated Use useAuth() or useAuthStore() directly for new code. */
export function useSession() {
  const user        = useAuthStore(s => s.user);
  const token       = useAuthStore(s => s.token);
  const logout      = useAuthStore(s => s.logout);
  const activeStore = useBranchStore(s => s.activeStore);

  return {
    session:     user ? { user, token } : null,
    token,
    user,
    activeStore,
    onLogout:    logout,
  };
}
