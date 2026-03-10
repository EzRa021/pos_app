// ============================================================================
// useAuth — Hook
// Thin, ergonomic wrapper over the auth Zustand store.
//
// Usage:
//   const { user, token, login, logout, changePassword, isLoading } = useAuth()
// ============================================================================

import { useAuthStore } from "@/stores/auth.store";

export function useAuth() {
  const user          = useAuthStore(s => s.user);
  const token         = useAuthStore(s => s.token);
  const isLoading     = useAuthStore(s => s.isLoading);
  const error         = useAuthStore(s => s.error);
  const isInitialized = useAuthStore(s => s.isInitialized);

  const login          = useAuthStore(s => s.login);
  const logout         = useAuthStore(s => s.logout);
  const changePassword = useAuthStore(s => s.changePassword);
  const clearError     = useAuthStore(s => s.clearError);

  const isLoggedIn   = !!user && !!token;
  const isGlobal     = user?.is_global === true;
  const roleSlug     = user?.role_slug ?? null;

  // Convenience: display name
  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
    : null;

  return {
    // State
    user,
    token,
    isLoading,
    error,
    isInitialized,
    isLoggedIn,
    isGlobal,
    roleSlug,
    displayName,

    // Actions
    login,
    logout,
    changePassword,
    clearError,
  };
}
