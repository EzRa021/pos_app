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
export const getSyncConflicts     = ()         => rpc("get_sync_conflicts");

// Sync event log (migration 0105). `filters` accepts any of
// { direction, outcome, table_name, limit, offset } — omit a key to not filter
// on it. Returns { entries, total }.
export const getSyncLog           = (filters = {}) => rpc("get_sync_log", filters);
export const getSyncLogTables     = ()             => rpc("get_sync_log_tables");
