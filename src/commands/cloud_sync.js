// commands/cloud_sync.js
import { rpc } from "@/lib/apiClient";

export const saveSupabaseConfig   = (payload) => rpc("save_supabase_config", payload);
export const clearSupabaseConfig  = ()         => rpc("clear_supabase_config");
export const getSupabaseConfig    = ()         => rpc("get_supabase_config");
export const getSyncStatus        = ()         => rpc("get_sync_status");
export const setCloudSyncEnabled  = (enabled)  => rpc("set_cloud_sync_enabled", { enabled });
export const triggerBackfillSync  = ()         => rpc("trigger_backfill_sync");
export const retryFailedSync      = ()         => rpc("retry_failed_sync");
export const getFailedSyncRows    = ()         => rpc("get_failed_sync_rows");
