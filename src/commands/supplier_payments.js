// commands/supplier_payments.js — Supplier payables & payment tracking
import { rpc } from "@/lib/apiClient";

// RecordSupplierPaymentDto: { supplier_id, store_id, po_id?, amount,
//   payment_method?, reference?, notes? }
export const recordSupplierPayment = (payload) =>
  rpc("record_supplier_payment", payload);

// SupplierPaymentFilters: { supplier_id?, store_id?, page?, limit? }
export const getSupplierPayments = (params = {}) =>
  rpc("get_supplier_payments", params);

// Returns: { supplier_id, supplier_name, current_balance, total_paid, total_po_value }
export const getSupplierBalance = (supplierId) =>
  rpc("get_supplier_balance", { supplier_id: supplierId });

// Returns all suppliers with current_balance > 0 for this store
export const getAllSupplierPayables = (storeId) =>
  rpc("get_all_supplier_payables", { store_id: storeId });
