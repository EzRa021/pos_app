// commands/eod.js — End-of-Day reports
import { rpc } from "@/lib/apiClient";

// date: "YYYY-MM-DD" string, or null for today
export const generateEodReport = (storeId, date = null) =>
  rpc("generate_eod_report", { store_id: storeId, date });

export const lockEodReport = (id) =>
  rpc("lock_eod_report", { id });

export const getEodReport = (storeId, date) =>
  rpc("get_eod_report", { store_id: storeId, date });

// EodHistoryFilters: { store_id, date_from?, date_to?, limit? }
export const getEodHistory = (params = {}) =>
  rpc("get_eod_history", params);
