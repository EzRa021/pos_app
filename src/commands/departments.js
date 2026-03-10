// commands/departments.js — Departments
import { rpc } from "@/lib/apiClient";

// ── Queries ───────────────────────────────────────────────────────────────────

export const getDepartments = (storeId) =>
  rpc("get_departments", { store_id: storeId });

export const getDepartment = (id) =>
  rpc("get_department", { id });

export const getDepartmentsByStore = (storeId, isActive = null, includeGlobal = true) =>
  rpc("get_departments_by_store", {
    store_id:       storeId,
    is_active:      isActive,
    include_global: includeGlobal,
  });

export const getGlobalDepartments = (isActive = null) =>
  rpc("get_global_departments", { is_active: isActive });

export const getDepartmentByCode = (code) =>
  rpc("get_department_by_code", { code });

export const getDepartmentCategories = (departmentId, isActive = null) =>
  rpc("get_department_categories", { department_id: departmentId, is_active: isActive });

export const searchDepartments = (query, limit = 10) =>
  rpc("search_departments", { query, limit });

export const countDepartments = (storeId = null, isActive = null) =>
  rpc("count_departments", { store_id: storeId, is_active: isActive });

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

// Soft-delete alias kept for backwards compatibility
export const deleteDepartment = (id) =>
  rpc("delete_department", { id });

// Hard-delete: permanently removes the row from the database
export const hardDeleteDepartment = (id) =>
  rpc("hard_delete_department", { id });
