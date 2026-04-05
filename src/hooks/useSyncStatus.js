// hooks/useSyncStatus.js
// Polls the local sync_queue for pending/failed counts every 15 seconds.
// Used by SyncStatusBadge to show the current cloud sync health.

import { useQuery } from "@tanstack/react-query";
import { getSyncStatus } from "@/commands/cloud_sync";

export function useSyncStatus() {
  const { data } = useQuery({
    queryKey:      ["sync-status"],
    queryFn:       getSyncStatus,
    refetchInterval: 15_000,
    staleTime:     10_000,
    retry:         false, // Don't spam logs on failure
  });

  return {
    pending:            data?.pending            ?? 0,
    failed:             data?.failed             ?? 0,
    syncedToday:        data?.synced_today       ?? 0,
    isCloudConnected:   data?.is_cloud_connected ?? false,
    cloudSyncEnabled:   data?.cloud_sync_enabled ?? false,
  };
}
