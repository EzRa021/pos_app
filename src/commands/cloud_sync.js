// commands/cloud_sync.js
import { rpc } from "@/lib/apiClient";

export const saveSupabaseConfig = (payload) =>
  rpc("save_supabase_config", payload);

export const clearSupabaseConfig = () =>
  rpc("clear_supabase_config");

export const getSupabaseConfig = () =>
  rpc("get_supabase_config");

export const getSyncStatus = () =>
  rpc("get_sync_status");

/** Persist `app_config.cloud_sync_enabled` — gates background push/pull (default off). */
export const setCloudSyncEnabled = (enabled) =>
  rpc("set_cloud_sync_enabled", { enabled });
