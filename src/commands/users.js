// commands/users.js — User management
import { rpc } from "@/lib/apiClient";

// params are passed FLAT directly — server does parse(params) into the DTO
export const getUsers = (filters = {}) =>
  rpc("get_users", filters);

export const getUser = (id) =>
  rpc("get_user", { id });

export const createUser = (payload) =>
  rpc("create_user", payload);

// update_user: server reads id from params then parses same params as UpdateUserDto
export const updateUser = (id, payload) =>
  rpc("update_user", { id, ...payload });

export const deleteUser = (id) =>
  rpc("delete_user", { id });

export const getRoles = () =>
  rpc("get_roles");

export const searchUsers = (query, limit = 10) =>
  rpc("search_users", { query, limit });

export const activateUser = (id) =>
  rpc("activate_user", { id });

export const deactivateUser = (id) =>
  rpc("deactivate_user", { id });

export const resetUserPassword = (id, newPassword) =>
  rpc("reset_user_password", { id, new_password: newPassword });

export const getPermissions = () =>
  rpc("get_permissions");

export const getRolePermissions = (roleId) =>
  rpc("get_role_permissions", { role_id: roleId });

export const setRolePermissions = (roleId, permissionIds) =>
  rpc("set_role_permissions", { role_id: roleId, permission_ids: permissionIds });
