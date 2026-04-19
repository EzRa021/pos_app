// commands/store_hours.js — Store opening hours
import { rpc } from "@/lib/apiClient";

export const getStoreHours = (storeId) =>
  rpc("get_store_hours", { store_id: storeId });

export const upsertStoreHours = (storeId, hours) =>
  rpc("upsert_store_hours", { store_id: storeId, hours });
// hours: Array of { store_id, day_of_week (0-6), is_open, open_time?, close_time? }
// day_of_week: 0=Sun, 1=Mon … 6=Sat
