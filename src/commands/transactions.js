// commands/transactions.js — POS transactions
import { rpc } from "@/lib/apiClient";

export const createTransaction = (payload) =>
  rpc("create_transaction", payload);

export const getTransactions = (params = {}) =>
  rpc("get_transactions", params);

export const getTransaction = (id) =>
  rpc("get_transaction", { id });

// Single-query replacement for the previous 5-round-trip stats approach.
// Returns: { total, completed, voided, refunded, today_count, today_revenue }
export const getTransactionStats = (storeId) =>
  rpc("get_transaction_stats", { store_id: storeId });

export const voidTransaction = (id, payload) =>
  rpc("void_transaction", { id, ...payload });
// payload: { reason: string, notes?: string }

export const partialRefund = (id, payload) =>
  rpc("partial_refund", { id, ...payload });
// payload: { items: [{ item_id, quantity, reason? }], notes?: string }

export const fullRefund = (id, payload) =>
  rpc("full_refund", { id, ...payload });
// payload: { reason: string, notes?: string }

export const searchTransactions = (query, storeId, limit = 8) =>
  rpc("search_transactions", { query, store_id: storeId, limit });

export const holdTransaction = (payload) =>
  rpc("hold_transaction", payload);

export const getHeldTransactions = (storeId) =>
  rpc("get_held_transactions", { store_id: storeId });

export const deleteHeldTransaction = (id) =>
  rpc("delete_held_transaction", { id });
