// commands/users.js — User management
import { rpc } from "@/lib/apiClient";

export const getUsers = (params = {}) =>
  rpc("get_users", params);
// params: { store_id?, role_id?, is_active?, search?, page?, page_size? }

export const getUser = (id) =>
  rpc("get_user", { id });

export const createUser = (payload) =>
  rpc("create_user", payload);
// payload: { username, password, first_name, last_name, email?, role_id, store_id?, is_global? }

export const updateUser = (id, payload) =>
  rpc("update_user", { id, ...payload });

export const deleteUser = (id) =>
  rpc("delete_user", { id });

export const getRoles = () =>
  rpc("get_roles");
