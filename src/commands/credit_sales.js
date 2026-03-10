// commands/credit_sales.js — Credit sales and payments
import { rpc } from "@/lib/apiClient";

// ── List / Summary ────────────────────────────────────────────────────────────

// CreditSaleFilters: { store_id?, customer_id?, status?, date_from?, date_to?, page?, limit? }
export const getCreditSales = (params = {}) =>
  rpc("get_credit_sales", params);

export const getCreditSummary = (storeId) =>
  rpc("get_credit_summary", { store_id: storeId ?? null });

export const getOutstandingBalances = (storeId) =>
  rpc("get_outstanding_balances", { store_id: storeId ?? null });

export const getOverdueSales = (storeId) =>
  rpc("get_overdue_sales", { store_id: storeId ?? null });

// ── Single record ─────────────────────────────────────────────────────────────

export const getCreditSale = (id) =>
  rpc("get_credit_sale", { id });

export const getCreditPayments = (creditSaleId) =>
  rpc("get_credit_payments", { credit_sale_id: creditSaleId });

// ── Actions ───────────────────────────────────────────────────────────────────

// RecordCreditPaymentDto: { credit_sale_id, amount, payment_method, reference?, notes? }
export const recordCreditPayment = (creditSaleId, amount, paymentMethod, notes = "", reference = "") =>
  rpc("record_credit_payment", {
    credit_sale_id: creditSaleId,
    amount,
    payment_method: paymentMethod,
    reference:      reference || undefined,
    notes:          notes     || undefined,
  });

export const cancelCreditSale = (id, reason = "") =>
  rpc("cancel_credit_sale", { id, reason: reason || undefined });
