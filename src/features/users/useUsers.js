// features/users/useUsers.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getUsers, getUser, createUser, updateUser,
  deleteUser, getRoles, activateUser, deactivateUser, resetUserPassword,
  getPermissions, getRolePermissions, setRolePermissions,
} from "@/commands/users";

// ── List ──────────────────────────────────────────────────────────────────────
export function useUsers(filters = {}) {
  return useQuery({
    queryKey:  ["users", filters],
    queryFn:   () => getUsers(filters),
    staleTime: 30_000,
    placeholderData: (prev) => prev,   // TanStack Query v5 equivalent of keepPreviousData
  });
}

// ── Single ────────────────────────────────────────────────────────────────────
export function useUser(id) {
  return useQuery({
    queryKey: ["user", id],
    queryFn:  () => getUser(id),
    enabled:  !!id,
    staleTime: 60_000,
  });
}

// ── Roles ─────────────────────────────────────────────────────────────────────
export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn:  getRoles,
    staleTime: Infinity,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────
export function useUserActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  const create = useMutation({
    mutationFn: (payload) => createUser(payload),
    onSuccess: () => { toast.success("User created successfully"); invalidate(); },
    onError: (e) => toast.error(typeof e === "string" ? e : (e?.message ?? "Failed to create user")),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }) => updateUser(id, payload),
    onSuccess: (user) => {
      toast.success("User updated");
      invalidate();
      qc.setQueryData(["user", user.id], user);
    },
    onError: (e) => toast.error(typeof e === "string" ? e : (e?.message ?? "Failed to update user")),
  });

  const remove = useMutation({
    mutationFn: (id) => deleteUser(id),
    onSuccess: () => { toast.success("User deactivated"); invalidate(); },
    onError: (e) => toast.error(typeof e === "string" ? e : (e?.message ?? "Failed to delete user")),
  });

  const activate = useMutation({
    mutationFn: (id) => activateUser(id),
    onSuccess: (user) => {
      toast.success(`${user.first_name} activated`);
      invalidate();
      qc.setQueryData(["user", user.id], user);
    },
    onError: (e) => toast.error(typeof e === "string" ? e : (e?.message ?? "Failed to activate")),
  });

  const deactivate = useMutation({
    mutationFn: (id) => deactivateUser(id),
    onSuccess: (user) => {
      toast.success(`${user.first_name} deactivated`);
      invalidate();
      qc.setQueryData(["user", user.id], user);
    },
    onError: (e) => toast.error(typeof e === "string" ? e : (e?.message ?? "Failed to deactivate")),
  });

  const resetPassword = useMutation({
    mutationFn: ({ id, newPassword }) => resetUserPassword(id, newPassword),
    onSuccess: () => toast.success("Password reset successfully"),
    onError: (e) => toast.error(typeof e === "string" ? e : (e?.message ?? "Failed to reset password")),
  });

  return { create, update, remove, activate, deactivate, resetPassword };
}

// ── All permissions (catalog) ──────────────────────────────────────────────────
export function usePermissions() {
  return useQuery({
    queryKey: ["permissions"],
    queryFn:  getPermissions,
    staleTime: Infinity,
  });
}

// ── Permissions granted to a specific role ─────────────────────────────────────
export function useRolePermissions(roleId) {
  return useQuery({
    queryKey: ["role_permissions", roleId],
    queryFn:  () => getRolePermissions(roleId),
    enabled:  !!roleId,
    staleTime: 30_000,
  });
}

// ── Mutation to replace a role's permissions ───────────────────────────────────
export function useSetRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, permissionIds }) => setRolePermissions(roleId, permissionIds),
    onSuccess: (_, { roleId }) => {
      qc.invalidateQueries({ queryKey: ["role_permissions", roleId] });
      toast.success("Permissions updated");
    },
    onError: (e) => toast.error(typeof e === "string" ? e : (e?.message ?? "Failed to update permissions")),
  });
}
