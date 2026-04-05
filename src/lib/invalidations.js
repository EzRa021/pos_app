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
//   ["inventory_item"]           — single inventory item detail panels
//   ["inv_summary", storeId]     — inventory KPI stats
//   ["low_stock", storeId]       — low-stock alert list
//   ["inventory_for_count", storeId] — StockCountRunner full item list (no pagination)
//   ["transactions"]           — transaction list, detail, stats
//   ["shift-summary", shiftId] — shift KPI cards (total sales, cash, etc.)
//   ["payments"]               — payments list
//   ["returns"]                — returns list and detail
//   ["purchase-orders"]        — PO list
//   ["purchase-order", id]     — single PO detail
//   ["analytics-*"]            — analytics hooks (each has its own prefix)
//   ["dash-recent-txns", storeId] — dashboard recent transactions panel (CashierView)
//   ["dash-low-stock-cashier", storeId] — dashboard low-stock notice (CashierView)
//   ["dash-low-stock-sk", storeId]      — dashboard low-stock panel (StockKeeperView)
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
    inv(["inv_summary",        storeId]);  // Inventory KPI stat cards
    inv(["low_stock",          storeId]);  // Low-stock alert banner
    inv(["inventory_for_count",storeId]);  // StockCountRunner full item list
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

  // Dashboard panels — private query keys used directly in AnalyticsDashboardPage
  inv(["dash-recent-txns"]);        // CashierView: recent transactions list
  inv(["dash-low-stock-cashier"]);  // CashierView: low stock notice
  inv(["dash-low-stock-sk"]);       // StockKeeperView: low stock panel

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

  // Loyalty: invalidate whenever a customer is attached so balance + history
  // panels refresh after the charge() earn call and any redemption.
  if (customerId) {
    inv(["loyalty-balance", customerId]);
    inv(["loyalty-history", customerId]);
  }

  // NOTE: reorder alert check is NOT fired here.
  // usePos.js fires it after charge() and also invalidates the notification
  // bell cache keys — keeping both calls in one place avoids the duplicate
  // DB query that previously ran on every sale.
}

// ─────────────────────────────────────────────────────────────────────────────
// After a transaction is voided or fully refunded
// Stock is restocked, transaction status changes, analytics are affected.
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterVoid(storeId) {
  inv(["transactions"]);
  inv(["dash-recent-txns"]);
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
  inv(["dash-recent-txns"]);
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

// ─────────────────────────────────────────────────────────────────────────────
// After a stock transfer is created, approved, or completed
// Stock changes in both source and destination stores.
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterStockTransfer(storeId) {
  inv(["stock-transfers"]);
  inv(["stock-transfer"]);
  invalidateStock(storeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// After an expense is created or approved
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterExpense() {
  inv(["expenses"]);
  inv(["analytics-profit"]);
  inv(["analytics-profit-loss"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// After a price change is requested, approved, or rejected
// Item prices may change — invalidate catalog and POS item grid.
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterPriceChange() {
  inv(["price-changes"]);
  inv(["price-lists"]);
  inv(["price-list-items"]);
  inv(["items"]);
  inv(["pos-items"]);
  inv(["item"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// After a reorder alert is acknowledged
// ─────────────────────────────────────────────────────────────────────────────
export function invalidateAfterReorderAlert(storeId) {
  inv(["reorder-alerts"]);
  inv(["notifications"]);
  if (storeId) {
    inv(["low_stock",         storeId]);
    inv(["dash-low-stock-sk", storeId]);
  }
}
