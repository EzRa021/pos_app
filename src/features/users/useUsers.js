// features/users/useUsers.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toastSuccess, onMutationError } from "@/lib/toast";
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
    onSuccess: (user) => {
      toastSuccess("User Created", `${user.first_name} ${user.last_name} can now sign in to Quantum POS.`);
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Create User", e),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }) => updateUser(id, payload),
    onSuccess: (user) => {
      toastSuccess("User Updated", `Profile changes for ${user.first_name} ${user.last_name} have been saved.`);
      invalidate();
      qc.setQueryData(["user", user.id], user);
    },
    onError: (e) => onMutationError("Couldn't Update User", e),
  });

  const remove = useMutation({
    mutationFn: (id) => deleteUser(id),
    onSuccess: () => {
      toastSuccess("User Deactivated", "The user's account has been deactivated.");
      invalidate();
    },
    onError: (e) => onMutationError("Couldn't Deactivate User", e),
  });

  const activate = useMutation({
    mutationFn: (id) => activateUser(id),
    onSuccess: (user) => {
      toastSuccess("User Activated", `${user.first_name} ${user.last_name} can now sign in again.`);
      invalidate();
      qc.setQueryData(["user", user.id], user);
    },
    onError: (e) => onMutationError("Couldn't Activate User", e),
  });

  const deactivate = useMutation({
    mutationFn: (id) => deactivateUser(id),
    onSuccess: (user) => {
      toastSuccess("User Deactivated", `${user.first_name}'s access to the system has been suspended.`);
      invalidate();
      qc.setQueryData(["user", user.id], user);
    },
    onError: (e) => onMutationError("Couldn't Deactivate User", e),
  });

  const resetPassword = useMutation({
    mutationFn: ({ id, newPassword }) => resetUserPassword(id, newPassword),
    onSuccess: (_, vars) => {
      toastSuccess("Password Reset", "The user's password has been updated. They can sign in with the new credentials.");
    },
    onError: (e) => onMutationError("Password Reset Failed", e),
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
      toastSuccess("Permissions Updated", "The role's access rights have been saved.");
    },
    onError: (e) => onMutationError("Couldn't Update Permissions", e),
  });
}
