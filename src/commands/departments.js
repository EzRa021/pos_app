// commands/departments.js — Departments
import { rpc } from "@/lib/apiClient";

// ── Queries ───────────────────────────────────────────────────────────────────

export const getDepartments = (storeId) =>
  rpc("get_departments", { store_id: storeId });

export const getDepartmentsByStore = (storeId, isActive = null, includeGlobal = true) =>
  rpc("get_departments_by_store", {
    store_id:       storeId,
    is_active:      isActive,
    include_global: includeGlobal,
  });

// Command-palette search.
export const searchDepartments = (query, limit = 10) =>
  rpc("search_departments", { query, limit });

// ── Mutations ─────────────────────────────────────────────────────────────────

export const createDepartment = (payload) =>
  rpc("create_department", payload);
// payload: { store_id?, department_name, department_code?, description?,
//            display_order?, color?, icon?, is_active? }

export const updateDepartment = (id, payload) =>
  rpc("update_department", { id, ...payload });

// Dedicated activate / deactivate (preferred over update with is_active flag)
export const activateDepartment = (id) =>
  rpc("activate_department", { id });

export const deactivateDepartment = (id) =>
  rpc("deactivate_department", { id });

// Hard-delete: permanently removes the row from the database
export const hardDeleteDepartment = (id) =>
  rpc("hard_delete_department", { id });
