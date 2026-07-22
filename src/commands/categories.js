// commands/categories.js — Item categories
import { rpc } from "@/lib/apiClient";

// ── Queries ───────────────────────────────────────────────────────────────────

export const getCategories = (storeId, departmentId = null) =>
  rpc("get_categories", { store_id: storeId, department_id: departmentId });

// Active + POS-visible categories for the POS grid (filtered server-side).
export const getPosCategories = (storeId) =>
  rpc("get_pos_categories", { store_id: storeId });

// Command-palette search.
export const searchCategories = (query, storeId = null, limit = 10) =>
  rpc("search_categories", { query, store_id: storeId, limit });

// ── Mutations ─────────────────────────────────────────────────────────────────

export const createCategory = (payload) =>
  rpc("create_category", payload);
// payload: { store_id, department_id?, category_name, category_code?,
//            description?, display_order?, color?, icon?, image_url?,
//            is_visible_in_pos?, requires_weighing?, default_tax_rate?,
//            is_active? }

export const updateCategory = (id, payload) =>
  rpc("update_category", { id, ...payload });

// Dedicated activate / deactivate endpoints
export const activateCategory = (id) =>
  rpc("activate_category", { id });

export const deactivateCategory = (id) =>
  rpc("deactivate_category", { id });

// Hard-delete: permanent DELETE FROM categories
export const hardDeleteCategory = (id) =>
  rpc("hard_delete_category", { id });
