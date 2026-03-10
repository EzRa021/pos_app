// commands/customers.js — Customer management
import { rpc } from "@/lib/apiClient";

// ── List / Search ─────────────────────────────────────────────────────────────

// CustomerFilters: { store_id?, search?, is_active?, customer_type?, page?, limit? }
export const getCustomers = (params = {}) =>
  rpc("get_customers", params);

export const searchCustomers = (query, storeId, limit = 10) =>
  rpc("search_customers", { query, store_id: storeId, limit });

// ── Single record ─────────────────────────────────────────────────────────────

export const getCustomer = (id) =>
  rpc("get_customer", { id });

export const getCustomerStats = (id) =>
  rpc("get_customer_stats", { id });

// CustomerTransactionFilters: { id, page?, limit?, date_from?, date_to? }
export const getCustomerTransactions = (id, params = {}) =>
  rpc("get_customer_transactions", { id, ...params });

// ── Create / Update ───────────────────────────────────────────────────────────

// CreateCustomerDto: { store_id, first_name, last_name, email?, phone?,
//                      address?, city?, credit_limit?, customer_type?, credit_enabled? }
export const createCustomer = (payload) =>
  rpc("create_customer", payload);

export const updateCustomer = (id, payload) =>
  rpc("update_customer", { id, ...payload });

// ── Activate / Deactivate / Delete ───────────────────────────────────────────

export const activateCustomer = (id) =>
  rpc("activate_customer", { id });

export const deactivateCustomer = (id) =>
  rpc("deactivate_customer", { id });

export const deleteCustomer = (id) =>
  rpc("delete_customer", { id });
