// commands/payment_methods.js — Payment method settings per store
import { rpc } from "@/lib/apiClient";

export const getPaymentMethods = (storeId) =>
  rpc("get_payment_methods", { store_id: storeId });

export const upsertPaymentMethod = (payload) =>
  rpc("upsert_payment_method", payload);
// payload: { store_id, method_key, display_name, is_enabled,
//            require_reference, reference_label?, sort_order }

export const reorderPaymentMethods = (storeId, order) =>
  rpc("reorder_payment_methods", { store_id: storeId, order });
// order: string[] of method_key in desired display order
