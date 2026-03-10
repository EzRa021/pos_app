// commands/categories.js — Item categories
import { rpc } from "@/lib/apiClient";

// ── Queries ───────────────────────────────────────────────────────────────────

export const getCategories = (storeId, departmentId = null) =>
  rpc("get_categories", { store_id: storeId, department_id: departmentId });

export const getCategory = (id) =>
  rpc("get_category", { id });

export const getCategoryByCode = (code, storeId = null) =>
  rpc("get_category_by_code", { code, store_id: storeId });

export const getPosCategories = (storeId) =>
  rpc("get_pos_categories", { store_id: storeId });

export const getSubcategories = (parentId, isActive = null) =>
  rpc("get_subcategories", { parent_id: parentId, is_active: isActive });

export const getCategoryItems = (categoryId, isActive = null) =>
  rpc("get_category_items", { category_id: categoryId, is_active: isActive });

export const searchCategories = (query, storeId = null, limit = 10) =>
  rpc("search_categories", { query, store_id: storeId, limit });

export const countCategories = (storeId = null, departmentId = null, isActive = null) =>
  rpc("count_categories", { store_id: storeId, department_id: departmentId, is_active: isActive });

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

export const assignCategoryDepartment = (categoryId, departmentId = null) =>
  rpc("assign_category_department", { category_id: categoryId, department_id: departmentId });

// Soft-delete alias kept for backwards compatibility
export const deleteCategory = (id) =>
  rpc("delete_category", { id });

// Hard-delete: permanent DELETE FROM categories
export const hardDeleteCategory = (id) =>
  rpc("hard_delete_category", { id });
