// lib/syncEvents.js
// App-wide bridge from the Rust sync workers to React Query.
//
// The pull worker emits a Tauri `sync:applied` event listing the tables it
// just landed locally. Invalidating the matching query caches here means a
// change made on another device (or directly in Supabase) appears on screen
// within a second of the pull — no manual refresh, and no dependency on the
// Settings → Sync panel being open.
//
// Only active in the Tauri (server-mode) window; client-mode browsers rely on
// the Supabase Realtime websocket + normal refetch intervals.

const TABLE_QUERY_KEYS = {
  stores:          [["stores"], ["business-info"]],
  users:           [["users"]],
  departments:     [["departments"]],
  categories:      [["categories"]],
  suppliers:       [["suppliers"]],
  items:           [["items"], ["inventory"], ["pos-items"]],
  item_stock:      [["inventory"], ["item-stock"], ["items"], ["pos-items"]],
  stock_movements: [["inventory"], ["item-stock"]],
  customers:       [["customers"]],
  shifts:          [["shifts"]],
  transactions:    [["transactions"], ["analytics"]],
  transaction_items: [["transactions"], ["analytics"]],
  payments:        [["transactions"], ["payments"]],
  credit_sales:    [["credit-sales"], ["customers"]],
  returns:         [["returns"]],
  purchase_orders: [["purchase-orders"]],
  expenses:        [["expenses"]],
  reorder_alerts:  [["reorder-alerts"]],
  notifications:   [["notifications"]],
  tax_categories:  [["tax-categories"]],
  supplier_payments:            [["supplier-payments"], ["supplier-payments-all"]],
  customer_wallet_transactions: [["wallet-balance"], ["wallet-history"], ["wallet-customers"]],
  loyalty_transactions:         [["loyalty-balance"], ["loyalty-history"]],
};

let started = false;

/** Call once at startup (App.jsx). Safe to call when not running in Tauri. */
export async function initSyncEventBridge(queryClient) {
  if (started || !window.__TAURI_INTERNALS__) return;
  started = true;

  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("sync:applied", (e) => {
      const tables = e.payload?.tables ?? [];
      for (const table of tables) {
        const keys = TABLE_QUERY_KEYS[table] ?? [[table]];
        keys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      }
      if (tables.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      }
    });
  } catch (err) {
    console.warn("sync event bridge unavailable:", err);
    started = false;
  }
}
