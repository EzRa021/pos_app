// hooks/useRealtimeInvalidation.js
// Subscribes to Supabase Realtime postgres_changes for key tables and calls
// React Query invalidateQueries so all connected instances see updates live.
//
// Scoped to the active store_id to avoid receiving every tenant's changes.
// Gracefully no-ops if Supabase isn't configured.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";

// Map Supabase table names → React Query keys to invalidate
const TABLE_QUERY_MAP = {
  transactions:       ["transactions"],
  transaction_items:  ["transactions"],
  item_stock:         ["inventory", "items", "pos-items"],
  items:              ["items", "pos-items", "item"],
  expenses:           ["expenses"],
  shifts:             ["shifts", "active-shift"],
  credit_sales:       ["credit-sales"],
  customers:          ["customers", "customer"],
  payments:           ["payments"],
  returns:            ["returns"],
  purchase_orders:    ["purchase-orders"],
  notifications:      ["notifications", "unread-count"],
  reorder_alerts:     ["reorder-alerts"],
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

    Object.entries(TABLE_QUERY_MAP).forEach(([table, queryKeys]) => {
      const channel = client
        .channel(`realtime:${table}:store:${storeId}`)
        .on(
          "postgres_changes",
          {
            event:  "*",
            schema: "public",
            table,
            filter: `store_id=eq.${storeId}`,
          },
          handleChange(queryKeys),
        )
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
