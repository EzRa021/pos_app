// commands/reorder_alerts.js — Reorder alert engine
import { rpc } from "@/lib/apiClient";

// Scans stock levels and inserts new reorder alerts for any item below min_stock_level.
// Returns { new_alerts: number, total_pending: number }
export const checkReorderAlerts = (storeId) =>
  rpc("check_reorder_alerts", { store_id: storeId });

// ReorderAlertFilters: { store_id, status?, item_id?, limit? }
// Alerts are auto-resolved by check_reorder_alerts once stock recovers above the
// reorder point, so there is no manual acknowledge/resolve call from the client.
export const getReorderAlerts = (filters = {}) =>
  rpc("get_reorder_alerts", filters);
