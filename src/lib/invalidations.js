// ============================================================================
// src/lib/invalidations.js
// ============================================================================
// Centralized React Query cache invalidation.
//
// WHY THIS FILE EXISTS
// --------------------
// After any mutation (sale, adjustment, return, etc.) the app's cached pages
// must update immediately without a browser refresh.  React Query only does
// this automatically when the cache entry is explicitly invalidated.
//
// Scattering individual invalidateQueries() calls inside every hook means:
//   • Easy to miss a related key (the classic "Products page not updating" bug)
//   • Duplicate/inconsistent logic across features
//   • Hard to trace "what refreshes after a sale?"
//
// HOW TO USE
// ----------
// Import the relevant function inside a mutation's onSuccess and call it.
// Each function accepts an optional context object ({storeId, ...}) so it can
// also clear store-scoped keys like inv_summary and low_stock.
//
//   import { invalidateAfterSale } from "@/lib/invalidations";
//   const result = await charge(...);
//   invalidateAfterSale({ storeId, shiftId: activeShift?.id, ... });
//
// QUERY KEY CONVENTIONS (match the keys used in each useXxx.js hook)
// ------------------------------------------------------------------
//   ["items"]                  — product list (all filter variants)
//   ["pos-items"]              — POS item grid
//   ["item", id]               — single item detail
//   ["inventory"]              — inventory list
//   ["inventory_item"]         — single inventory item detail panels
//   ["inv_summary", storeId]   — inventory KPI stats
//   ["low_stock", storeId]     — low-stock alert list
//   ["transactions"]           — transaction list, detail, stats
//   ["shift-summary", shiftId] — shift KPI cards (total sales, cash, etc.)
//   ["payments"]               — payments list
//   ["returns"]                — returns list and detail
//   ["purchase-orders"]        — PO list
//   ["purchase-order", id]     — single PO detail
//   ["analytics-*"]            — analytics hooks (each has its own prefix)
//   ["credit-sales"]           — credit sales list
//   ["customers"]              — customer list
//   ["customer", id]           — single customer detail
//   ["wallet-*", customerId]   — wallet balance / history
//   ["loyalty-*", customerId]  — loyalty balance / history
// ============================================================================

import { queryClient } from "./queryClient";

/** Shorthand — invalidate all queries whose key starts with `queryKey`. */
function inv(queryKey) {
  queryClient.invalidateQueries({ queryKey });
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitive: stock changed
// Used internally by higher-level event functions and directly by stock-only
// mutations (inventory adjust, stock count apply, item stock-adjust).
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateStock(storeId) {
  inv(["items"]);          // Products page + ItemsTable
  inv(["pos-items"]);      // POS item grid (separate key in usePos)
  inv(["item"]);           // single item detail panels
  inv(["inventory"]);      // Inventory page list + counts
  inv(["inventory_item"]); // inventory detail panels
  if (storeId) {
    inv(["inv_summary", storeId]);  // Inventory KPI stat cards
    inv(["low_stock",   storeId]);  // Low-stock alert banner
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// After a completed sale (create_transaction)
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterSale({
  storeId,
  shiftId,
  customerId,
  paymentMethod,
  walletUsed    = false,
  loyaltyUsed   = false,
} = {}) {
  // Stock levels change because items were sold
  invalidateStock(storeId);

  // A new transaction was created
  inv(["transactions"]);

  // Shift KPI cards (Total Sales, Expected Cash, Transactions)
  if (shiftId) inv(["shift-summary", shiftId]);

  // Payments record created
  inv(["payments"]);

  // Analytics — revenue, top items, category breakdown, cashier stats
  inv(["analytics-sales-summary"]);
  inv(["analytics-revenue-period"]);
  inv(["analytics-items"]);
  inv(["analytics-categories"]);
  inv(["analytics-departments"]);
  inv(["analytics-payment-methods"]);
  inv(["analytics-cashiers"]);
  inv(["analytics-peak-hours"]);

  // Credit sale: customer balance and credit-sales list change
  if (paymentMethod === "credit" && customerId) {
    inv(["credit-sales"]);
    inv(["credit-summary"]);
    inv(["customer",       customerId]);
    inv(["customer-stats", customerId]);
    inv(["customers"]);
  }

  // Wallet payment: customer wallet balance + history change
  if (walletUsed && customerId) {
    inv(["wallet-balance", customerId]);
    inv(["wallet-history", customerId]);
  }

  // Loyalty redemption: points balance + history change
  if (loyaltyUsed && customerId) {
    inv(["loyalty-balance", customerId]);
    inv(["loyalty-history", customerId]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// After a transaction is voided or fully refunded
// Stock is restocked, transaction status changes, analytics are affected.
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterVoid(storeId) {
  inv(["transactions"]);
  invalidateStock(storeId);
  inv(["payments"]);
  inv(["analytics-sales-summary"]);
  inv(["analytics-revenue-period"]);
  inv(["analytics-payment-methods"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// After a return is created
// Stock may be restocked, transaction status changes, return list changes.
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterReturn(storeId) {
  inv(["returns"]);
  inv(["transactions"]);
  invalidateStock(storeId);
  inv(["analytics-returns"]);
  inv(["analytics-sales-summary"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// After a purchase order is received
// Stock is increased for received items.
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterPOReceive(storeId, poId) {
  if (poId) inv(["purchase-order", poId]);
  inv(["purchase-orders"]);
  invalidateStock(storeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// After any PO status change (create, cancel, submit, approve, reject)
// Stock does NOT change — only the PO list/detail.
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterPOChange(poId) {
  if (poId) inv(["purchase-order", poId]);
  inv(["purchase-orders"]);
}
