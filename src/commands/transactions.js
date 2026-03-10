// commands/transactions.js — POS transactions
import { rpc } from "@/lib/apiClient";

export const createTransaction = (payload) =>
  rpc("create_transaction", payload);

export const getTransactions = (params = {}) =>
  rpc("get_transactions", params);

export const getTransaction = (id) =>
  rpc("get_transaction", { id });

export const voidTransaction = (id, payload) =>
  rpc("void_transaction", { id, ...payload });
// payload: { reason: string, notes?: string }

export const partialRefund = (id, payload) =>
  rpc("partial_refund", { id, ...payload });
// payload: { items: [{ item_id, quantity, reason? }], notes?: string }

export const fullRefund = (id, payload) =>
  rpc("full_refund", { id, ...payload });
// payload: { reason: string, notes?: string }

export const holdTransaction = (payload) =>
  rpc("hold_transaction", payload);

export const getHeldTransactions = (storeId) =>
  rpc("get_held_transactions", { store_id: storeId });

export const deleteHeldTransaction = (id) =>
  rpc("delete_held_transaction", { id });
