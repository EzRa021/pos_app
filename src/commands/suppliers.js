// commands/suppliers.js — Supplier management
import { rpc } from "@/lib/apiClient";

export const getSuppliers = (params = {}) =>
  rpc("get_suppliers", params);
// params: { store_id?, search?, is_active?, page?, limit? }

export const getSupplier = (id) =>
  rpc("get_supplier", { id });

export const getSupplierStats = (id) =>
  rpc("get_supplier_stats", { id });

export const getSupplierSpendTimeline = (id) =>
  rpc("get_supplier_spend_timeline", { id });

export const searchSuppliers = (query, storeId, limit = 10) =>
  rpc("search_suppliers", { query, store_id: storeId, limit });

export const createSupplier = (payload) =>
  rpc("create_supplier", payload);
// payload: { store_id, supplier_name, contact_name?, phone?, email?,
//            address?, city?, tax_id?, payment_terms?, credit_limit? }

export const updateSupplier = (id, payload) =>
  rpc("update_supplier", { id, ...payload });

export const activateSupplier = (id) =>
  rpc("activate_supplier", { id });

export const deactivateSupplier = (id) =>
  rpc("deactivate_supplier", { id });

export const deleteSupplier = (id) =>
  rpc("delete_supplier", { id });
