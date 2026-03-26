// commands/stores.js — Store / branch management
import { rpc } from "@/lib/apiClient";

// ── getMyStore ────────────────────────────────────────────────────────────────
export const getMyStore = () =>
  rpc("get_my_store");

// ── getStore ──────────────────────────────────────────────────────────────────
export const getStore = (id) =>
  rpc("get_store", { id });

// ── getStores ─────────────────────────────────────────────────────────────────
export const getStores = (params = {}) =>
  rpc("get_stores", params);

// ── createStore ───────────────────────────────────────────────────────────────
export const createStore = (payload) =>
  rpc("create_store", payload);

// ── updateStore ───────────────────────────────────────────────────────────────
export const updateStore = (id, payload) =>
  rpc("update_store", { id, ...payload });

// ── activateStore / deactivateStore ──────────────────────────────────────────
// Sugar over updateStore so call-sites are explicit about intent.
export const activateStore = (id) =>
  rpc("update_store", { id, is_active: true });

export const deactivateStore = (id) =>
  rpc("update_store", { id, is_active: false });

// ── getStoreUsers ─────────────────────────────────────────────────────────────
// Returns all users whose store_id matches the given store.
// Requires stores.read permission (admin / super_admin only).
export const getStoreUsers = (storeId) =>
  rpc("get_store_users", { store_id: storeId });
