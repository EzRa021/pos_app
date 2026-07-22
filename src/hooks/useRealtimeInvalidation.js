// hooks/useRealtimeInvalidation.js
// Subscribes to Supabase Realtime postgres_changes for key tables and calls
// React Query invalidateQueries so all connected instances see updates live.
//
// Scoped to the active store_id to avoid receiving every tenant's changes.
// Gracefully no-ops if Supabase isn't configured.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";

// Map Supabase table names → React Query keys to invalidate.
// `storeScoped: false` means the table has no store_id column (global or
// reachable only through a parent FK) — subscribe without the store_id
// filter, since Postgres would reject filtering on a nonexistent column.
const TABLE_QUERY_MAP = {
  transactions:       { keys: ["transactions"] },
  transaction_items:  { keys: ["transactions"], storeScoped: false },
  item_stock:         { keys: ["inventory", "items", "pos-items"] },
  items:              { keys: ["items", "pos-items", "item"] },
  expenses:           { keys: ["expenses"] },
  shifts:             { keys: ["shifts", "active-shift"] },
  credit_sales:       { keys: ["credit-sales"] },
  customers:          { keys: ["customers", "customer"] },
  payments:           { keys: ["payments", "transactions"], storeScoped: false },
  returns:            { keys: ["returns"] },
  purchase_orders:    { keys: ["purchase-orders"] },
  notifications:      { keys: ["notifications", "unread-count"] },
  reorder_alerts:     { keys: ["reorder-alerts"] },
  categories:         { keys: ["categories"] },
  departments:        { keys: ["departments"] },
  suppliers:          { keys: ["suppliers"] },
  tax_categories:     { keys: ["tax-categories"], storeScoped: false },
  stores:             { keys: ["stores", "business-info"], storeScoped: false },
  supplier_payments:  { keys: ["supplier-payments", "supplier-payments-all"] },
  customer_wallet_transactions: { keys: ["wallet-balance", "wallet-history", "wallet-customers"] },
  loyalty_transactions: { keys: ["loyalty-balance", "loyalty-history"] },
};

export function useRealtimeInvalidation(storeId) {
  const qc          = useQueryClient();
  const channelsRef = useRef([]);

  useEffect(() => {
    if (!storeId) return;

    const client = getSupabaseClient();
    if (!client) return;

    // Clean up any existing channels from a previous store
    channelsRef.current.forEach((ch) => client.removeChannel(ch));
    channelsRef.current = [];

    const handleChange = (queryKeys) => () => {
      queryKeys.forEach((key) => {
        qc.invalidateQueries({ queryKey: [key, storeId] });
        qc.invalidateQueries({ queryKey: [key] });
      });
    };

    Object.entries(TABLE_QUERY_MAP).forEach(([table, { keys: queryKeys, storeScoped = true }]) => {
      const config = { event: "*", schema: "public", table };
      if (storeScoped) config.filter = `store_id=eq.${storeId}`;

      const channel = client
        .channel(`realtime:${table}:store:${storeId}`)
        .on("postgres_changes", config, handleChange(queryKeys))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // Connected
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // Will auto-retry
          }
        });

      channelsRef.current.push(channel);
    });

    return () => {
      channelsRef.current.forEach((ch) => client.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [storeId, qc]);
}
