// commands/reorder_alerts.js — Reorder alert engine
import { rpc } from "@/lib/apiClient";

// Scans stock levels and inserts new reorder alerts for any item below min_stock_level.
// Returns { new_alerts: number, total_pending: number }
export const checkReorderAlerts = (storeId) =>
  rpc("check_reorder_alerts", { store_id: storeId });

// ReorderAlertFilters: { store_id, status?, item_id?, limit? }
export const getReorderAlerts = (filters = {}) =>
  rpc("get_reorder_alerts", filters);

export const acknowledgeReorderAlert = (id) =>
  rpc("acknowledge_reorder_alert", { id });

export const resolveReorderAlert = (id) =>
  rpc("acknowledge_reorder_alert", { id });
