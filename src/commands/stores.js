// commands/stores.js — Store / branch management
import { rpc } from "@/lib/apiClient";

// ── getMyStore ────────────────────────────────────────────────────────────────
// Fetches the store assigned to the currently logged-in user.
// Works for ALL roles — no stores.read permission required.
// Returns the full Store object, or null for global users who haven't
// selected a store yet.
// This is the correct call for non-global users on login/session restore.
export const getMyStore = () =>
  rpc("get_my_store");

// ── getStore ──────────────────────────────────────────────────────────────────
// Fetches any store by ID.
// Non-global users: allowed only for their own store_id (no permission needed).
// Global users / admins: requires stores.read permission to fetch other stores.
export const getStore = (id) =>
  rpc("get_store", { id });

// ── getStores ─────────────────────────────────────────────────────────────────
// Lists all stores (requires stores.read — admin / super_admin only).
export const getStores = (params = {}) =>
  rpc("get_stores", params);
// params: { is_active? }

// ── createStore / updateStore ─────────────────────────────────────────────────
// Requires stores.manage permission.
export const createStore = (payload) =>
  rpc("create_store", payload);
// payload: { store_name, address?, city?, state?, phone?, email?, currency?, timezone? }

export const updateStore = (id, payload) =>
  rpc("update_store", { id, ...payload });
