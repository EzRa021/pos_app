// ============================================================================
// hooks/usePermission.js — Role permission check
// ============================================================================
// Returns true if the current user's role has the given permission slug.
//
// Global users (is_global = true) bypass all permission checks — always true.
// The backend enforces the same logic in guard_permission().
//
// Usage:
//   const canVoid     = usePermission("transactions.void");
//   const canApprove  = usePermission("expenses.approve");
//   const canManage   = useAnyPermission(["departments.create", "departments.update"]);
//
// Permission slugs are defined in lib/constants.js → PERMISSIONS map.
//
// ── INFINITE LOOP FIX ────────────────────────────────────────────────────────
// The previous implementation used:
//
//     const permissions = useAuthStore((s) => s.user?.permissions ?? []);
//
// `?? []` creates a NEW empty array reference on every render when the value
// is undefined/null. Zustand compares selector return values by reference
// (Object.is), so every render it sees a "different" value → schedules a
// re-render → infinite loop ("Maximum update depth exceeded").
//
// Fix: read the raw value from the store (may be undefined), then derive
// booleans outside the selector using stable primitives or a cached ref.
// ============================================================================

import { useAuthStore } from "@/stores/auth.store";

// ── Single permission ─────────────────────────────────────────────────────────
export function usePermission(permissionSlug) {
  const isGlobal    = useAuthStore((s) => s.user?.is_global ?? false);
  const hasUser     = useAuthStore((s) => !!s.user);
  // Return the raw array from the store — never use `?? []` inside a selector.
  // When undefined, `includes()` below is never reached (early returns fire first).
  const permissions = useAuthStore((s) => s.user?.permissions);

  if (!hasUser)   return false;
  if (isGlobal)   return true;
  if (!Array.isArray(permissions) || permissions.length === 0) return false;

  return permissions.includes(permissionSlug);
}

// ── All permissions (user must have EVERY slug) ───────────────────────────────
export function usePermissions(slugs = []) {
  const isGlobal    = useAuthStore((s) => s.user?.is_global ?? false);
  const hasUser     = useAuthStore((s) => !!s.user);
  const permissions = useAuthStore((s) => s.user?.permissions);

  if (!hasUser)   return false;
  if (isGlobal)   return true;
  if (!Array.isArray(permissions) || permissions.length === 0) return false;

  return slugs.every((slug) => permissions.includes(slug));
}

// ── Any permission (user must have AT LEAST ONE slug) ─────────────────────────
export function useAnyPermission(slugs = []) {
  const isGlobal    = useAuthStore((s) => s.user?.is_global ?? false);
  const hasUser     = useAuthStore((s) => !!s.user);
  const permissions = useAuthStore((s) => s.user?.permissions);

  if (!hasUser)   return false;
  if (isGlobal)   return true;
  if (!Array.isArray(permissions) || permissions.length === 0) return false;

  return slugs.some((slug) => permissions.includes(slug));
}
