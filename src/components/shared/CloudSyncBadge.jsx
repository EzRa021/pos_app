// components/shared/CloudSyncBadge.jsx
// Shows cloud sync health as a small indicator in the sidebar / header.
// Green = connected & all synced
// Yellow = pending rows (syncing in progress)
// Red    = failed rows (need attention)
// Grey   = cloud not configured

import { useSyncStatus } from "@/hooks/useSyncStatus";
import { cn } from "@/lib/utils";
import { Cloud, CloudOff } from "lucide-react";

export function CloudSyncBadge({ className }) {
  const { pending, failed, isCloudConnected, cloudSyncEnabled } = useSyncStatus();

  if (!isCloudConnected) {
    return (
      <div
        className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
          "bg-muted/50 text-muted-foreground border border-border/60",
          className,
        )}
        title="Cloud sync not configured"
      >
        <CloudOff className="h-3 w-3" />
        <span className="hidden sm:inline">Offline</span>
      </div>
    );
  }

  if (!cloudSyncEnabled) {
    return (
      <div
        className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
          "bg-muted/50 text-muted-foreground border border-border/60",
          className,
        )}
        title="Background cloud sync is off — enable in Settings → Cloud Sync"
      >
        <CloudOff className="h-3 w-3" />
        <span className="hidden sm:inline">Sync off</span>
      </div>
    );
  }

  if (failed > 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
          "bg-destructive/10 text-destructive border border-destructive/25",
          className,
        )}
        title={`${failed} sync failure(s) — check Cloud Sync settings`}
      >
        <span className="h-2 w-2 rounded-full bg-destructive shrink-0" />
        <Cloud className="h-3 w-3 shrink-0" />
        <span className="hidden sm:inline">{failed} failed</span>
      </div>
    );
  }

  if (pending > 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
          "bg-warning/10 text-warning border border-warning/25",
          className,
        )}
        title={`${pending} row(s) waiting to sync`}
      >
        <span className="h-2 w-2 rounded-full bg-warning animate-pulse shrink-0" />
        <Cloud className="h-3 w-3 shrink-0" />
        <span className="hidden sm:inline">Syncing…</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        "bg-success/10 text-success border border-success/25",
        className,
      )}
      title="All data synced to cloud"
    >
      <span className="h-2 w-2 rounded-full bg-success shrink-0" />
      <Cloud className="h-3 w-3 shrink-0" />
      <span className="hidden sm:inline">Synced</span>
    </div>
  );
}
