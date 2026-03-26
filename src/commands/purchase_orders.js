// commands/purchase_orders.js — Purchase order management
import { rpc } from "@/lib/apiClient";

export const getPurchaseOrders = (params = {}) =>
  rpc("get_purchase_orders", params);
// params: { store_id?, supplier_id?, status?, date_from?, date_to?, page?, limit? }

export const getPurchaseOrder = (id) =>
  rpc("get_purchase_order", { id });
// returns PurchaseOrderDetail { order: PurchaseOrder, items: PurchaseOrderItem[] }

export const getPoStats = (storeId) =>
  rpc("get_po_stats", { store_id: storeId ?? null });
// returns { total, draft, pending, approved, received, cancelled, rejected }

export const createPurchaseOrder = (payload) =>
  rpc("create_purchase_order", payload);
// payload: { store_id, supplier_id, notes?, items: [{ item_id, quantity, unit_cost }] }

export const receivePurchaseOrder = (id, items, notes) =>
  rpc("receive_purchase_order", { id, items, notes: notes || undefined });
// items: [{ po_item_id, quantity_received }]

export const cancelPurchaseOrder = (id) =>
  rpc("cancel_purchase_order", { id });

export const submitPurchaseOrder = (id) =>
  rpc("submit_purchase_order", { id });

export const approvePurchaseOrder = (id) =>
  rpc("approve_purchase_order", { id });

export const rejectPurchaseOrder = (id, reason) =>
  rpc("reject_purchase_order", { id, reason: reason || undefined });

export const deletePurchaseOrder = (id) =>
  rpc("delete_purchase_order", { id });

export const searchPurchaseOrders = (query, storeId, limit = 8) =>
  rpc("search_purchase_orders", { query, store_id: storeId ?? null, limit });
