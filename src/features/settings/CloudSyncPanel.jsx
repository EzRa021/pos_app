// features/settings/CloudSyncPanel.jsx
// Lets admins configure Supabase credentials for cloud sync.
// Shows live connection status, sync queue stats, failed-row details,
// and retry / force-resync controls.

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSupabaseConfig,
  clearSupabaseConfig,
  getSyncStatus,
  setCloudSyncEnabled,
  triggerBackfillSync,
  retryFailedSync,
  getFailedSyncRows,
  getSyncConflicts,
} from "@/commands/cloud_sync";
import {
  initSupabaseClient,
  resetSupabaseClient,
  subscribeToSyncChanges,
  unsubscribeFromSyncChanges,
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { SyncLogPanel } from "@/features/settings/SyncLogPanel";
import { cn }     from "@/lib/utils";
import {
  CloudOff, AlertTriangle, Loader2,
  RefreshCw, Trash2, RotateCcw, ChevronDown, ChevronUp,
  Wifi, WifiOff, Database, Zap, Upload, Download, GitMerge,
} from "lucide-react";

// ── Tables the frontend subscribes to for realtime invalidation ───────────────
const REALTIME_TABLES = [
  "items", "item_stock", "categories", "departments", "suppliers",
  "tax_categories", "customers", "transactions", "transaction_items",
  "payments", "credit_sales", "returns", "purchase_orders", "expenses",
  "shifts", "stores", "reorder_alerts", "notifications",
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center px-4 py-2.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent = "default" }) {
  const ring = {
    default:     "border-border/60 bg-card",
    success:     "border-success/25 bg-success/[0.06]",
    warning:     "border-warning/25 bg-warning/[0.06]",
    destructive: "border-destructive/25 bg-destructive/[0.06]",
  }[accent];
  const val = {
    default:     "text-foreground",
    success:     "text-success",
    warning:     "text-warning",
    destructive: "text-destructive",
  }[accent];

  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>
        {value}
      </span>
      {sub && (
        <span className="text-[10px] text-muted-foreground leading-snug truncate">
          {sub}
        </span>
      )}
    </div>
  );
}

function FailedRowsPanel({ onRetry }) {
  const [open, setOpen] = useState(false);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey:  ["failed-sync-rows"],
    queryFn:   getFailedSyncRows,
    enabled:   open,
    staleTime: 10_000,
  });

  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/[0.04] overflow-hidden">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open) refetch(); }}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-destructive/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
          <span className="text-[11px] font-semibold text-destructive">
            Show failed rows
          </span>
        </div>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-destructive/60" />
          : <ChevronDown className="h-3.5 w-3.5 text-destructive/60" />}
      </button>

      {open && (
        <div className="border-t border-destructive/15 px-4 pb-4 pt-3 space-y-2">
          {isLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Loading…</span>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-1">
              No failed rows found.
            </p>
          ) : (
            <>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-destructive/15 bg-card px-3 py-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-foreground">
                        {row.table_name}
                        <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                          {row.operation} · row {row.row_id}
                        </span>
                      </span>
                      <span className="text-[10px] text-destructive shrink-0">
                        {row.retries} retries
                      </span>
                    </div>
                    {row.error && (
                      <p className="text-[10px] text-muted-foreground font-mono leading-relaxed break-all line-clamp-2">
                        {row.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="mt-1 gap-1.5 h-8 text-[11px]"
                onClick={onRetry}
              >
                <RotateCcw className="h-3 w-3" />
                Retry All Failed
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConflictsPanel() {
  const [open, setOpen] = useState(false);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey:  ["sync-conflicts"],
    queryFn:   getSyncConflicts,
    enabled:   open,
    staleTime: 10_000,
  });

  return (
    <div className="rounded-xl border border-warning/25 bg-warning/[0.04] overflow-hidden">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open) refetch(); }}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-warning/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          <GitMerge className="h-3.5 w-3.5 text-warning shrink-0" />
          <span className="text-[11px] font-semibold text-warning">
            Show resolved conflicts
          </span>
        </div>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-warning/60" />
          : <ChevronDown className="h-3.5 w-3.5 text-warning/60" />}
      </button>

      {open && (
        <div className="border-t border-warning/15 px-4 pb-4 pt-3 space-y-1.5 max-h-52 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Loading…</span>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-1">No conflicts recorded.</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-warning/15 bg-card px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-foreground">
                    {row.table_name}
                    <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                      row {row.row_id} · {row.direction}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {row.resolved_at ? new Date(row.resolved_at).toLocaleString() : ""}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Newer copy kept (v{row.current_version ?? "?"}); incoming write
                  (v{row.incoming_version ?? "?"}) was discarded and logged.
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function CloudSyncPanel() {
  const qc = useQueryClient();

  /** Timestamp of the last realtime event received (for the live indicator). */
  const [lastRealtimeAt, setLastRealtimeAt] = useState(null);
  /**
   * Live worker activity from Tauri `sync:cycle` events (server device only).
   * Push and pull are tracked SEPARATELY: they are independent workers, and
   * the old single-slot state let a pull finishing mid-push overwrite the push
   * status with "idle" while the push was still running.
   */
  const [livePush, setLivePush] = useState(null);
  const [livePull, setLivePull] = useState(null);
  /** Ticks every few seconds purely so the staleness check below re-evaluates. */
  const [, setNow] = useState(0);
  const realtimeSetupRef = useRef(false);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey:  ["supabase-config"],
    queryFn:   getSupabaseConfig,
    staleTime: 60_000,
  });

  const { data: status } = useQuery({
    queryKey:        ["sync-status"],
    queryFn:         getSyncStatus,
    refetchInterval: 8_000,
    staleTime:       6_000,
    retry:           false,
  });

  // ── Realtime subscription ─────────────────────────────────────────────────
  // Sets up Supabase Realtime once the client is ready and sync is enabled.
  // On each incoming event we invalidate the relevant React Query caches so
  // the UI refreshes instantly without waiting for the 5s pull cycle.

  const handleRealtimeEvent = useCallback(({ table, eventType }) => {
    setLastRealtimeAt(new Date());
    // Invalidate whichever query cache matches the table that just changed
    const keyMap = {
      items:            [["items"], ["inventory"], ["pos-items"]],
      item_stock:       [["inventory"], ["item-stock"], ["pos-items"]],
      categories:       [["categories"]],
      departments:      [["departments"]],
      suppliers:        [["suppliers"]],
      tax_categories:   [["tax-categories"]],
      customers:        [["customers"]],
      transactions:     [["transactions"], ["analytics"]],
      transaction_items:[["transactions"], ["analytics"]],
      payments:         [["payments"], ["transactions"]],
      credit_sales:     [["credit-sales"], ["customers"]],
      returns:          [["returns"]],
      purchase_orders:  [["purchase-orders"]],
      expenses:         [["expenses"]],
      shifts:           [["shifts"]],
      stores:           [["stores"]],
      reorder_alerts:   [["reorder-alerts"]],
      notifications:    [["notifications"]],
    };
    const keys = keyMap[table] ?? [[table]];
    keys.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    // Always refresh sync status when a remote event arrives
    qc.invalidateQueries({ queryKey: ["sync-status"] });
  }, [qc]);

  useEffect(() => {
    const syncEnabled = status?.cloud_sync_enabled ?? false;
    const isConn      = config?.is_connected ?? false;

    if (syncEnabled && isConn && !realtimeSetupRef.current) {
      realtimeSetupRef.current = true;
      initSupabaseClient().then((client) => {
        if (client) {
          subscribeToSyncChanges(REALTIME_TABLES, handleRealtimeEvent);
        }
      });
    }
    if (!syncEnabled || !isConn) {
      if (realtimeSetupRef.current) {
        unsubscribeFromSyncChanges();
        realtimeSetupRef.current = false;
      }
    }
  }, [status?.cloud_sync_enabled, config?.is_connected, handleRealtimeEvent]);

  // Cleanup on unmount
  useEffect(() => () => { unsubscribeFromSyncChanges(); }, []);

  // ── Live sync worker events (Tauri, server device only) ──────────────────
  // The workers emit `sync:cycle` at cycle start/progress/end, and `sync:applied`
  // after pulled rows land. Every cycle event carries a cycle_id and a direction,
  // so push and pull are routed to separate state slots and can no longer
  // clobber each other. Client-mode devices simply keep the polling path.
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return undefined;
    let mounted = true;
    let unsubs = [];

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unCycle = await listen("sync:cycle", (e) => {
        if (!mounted) return;
        const payload = { ...e.payload, at: Date.now() };
        if (payload.direction === "pull") setLivePull(payload);
        else                              setLivePush(payload);

        // Keep the polled counters in step immediately.
        qc.setQueryData(["sync-status"], (old) =>
          old
            ? { ...old, pending: payload.pending, failed: payload.failed_total }
            : old,
        );
        // A finished cycle means new log rows and settled counters.
        if (payload.phase === "end") {
          qc.invalidateQueries({ queryKey: ["sync-status"] });
          qc.invalidateQueries({ queryKey: ["sync-log"] });
          qc.invalidateQueries({ queryKey: ["sync-log-tables"] });
        }
      });
      const unApplied = await listen("sync:applied", (e) => {
        if (!mounted) return;
        (e.payload?.tables ?? []).forEach((t) =>
          handleRealtimeEvent({ table: t, eventType: "pull" })
        );
      });
      unsubs = [unCycle, unApplied];
      if (!mounted) unsubs.forEach((u) => u());
    })();

    return () => {
      mounted = false;
      unsubs.forEach((u) => u());
    };
  }, [qc, handleRealtimeEvent]);

  // Re-render every 5s so LIVE_TTL_MS below is actually evaluated. Without this
  // a stuck "Pushing…" would never clear: the old code stamped `at` on each
  // event and then never read it, so a worker that died mid-cycle left the
  // panel claiming a push was in flight indefinitely.
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const clearMutation = useMutation({
    mutationFn: clearSupabaseConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supabase-config"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      resetSupabaseClient();
      realtimeSetupRef.current = false;
    },
  });

  const syncToggleMutation = useMutation({
    mutationFn: setCloudSyncEnabled,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["sync-status"] }),
  });

  const backfillMutation = useMutation({
    mutationFn: triggerBackfillSync,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["sync-status"] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: retryFailedSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      qc.invalidateQueries({ queryKey: ["failed-sync-rows"] });
    },
  });

  // ── Derived state ─────────────────────────────────────────────────────────

  const isConfigured  = config?.is_configured ?? false;
  const isEmbedded    = config?.is_embedded   ?? false;
  const isOverride    = config?.is_override   ?? false;

  // ── Live-state staleness ────────────────────────────────────────────────
  // A cycle event is only trusted for a short window. If the worker dies, the
  // machine sleeps, or the app is backgrounded, the last event would otherwise
  // stay on screen forever — which is exactly how the old panel ended up
  // showing "Pushing 12 changes…" long after nothing was running.
  const LIVE_TTL_MS = 15_000;
  const fresh = (l) => (l && Date.now() - l.at < LIVE_TTL_MS ? l : null);
  const push  = fresh(livePush);
  const pull  = fresh(livePull);
  // Whichever side reported most recently wins for the headline pill.
  const live  = (push && pull) ? (push.at > pull.at ? push : pull) : (push ?? pull);

  const pending       = live?.pending      ?? status?.pending ?? 0;
  const failed        = live?.failed_total ?? status?.failed  ?? 0;
  const syncedToday   = status?.synced_today  ?? 0;
  const conflicts     = status?.conflicts     ?? 0;
  const cloudOnline   = status?.is_cloud_connected ?? false;
  const syncEnabled   = status?.cloud_sync_enabled ?? false;
  const lastSynced    = status?.last_synced_at;
  const hasFailed     = failed > 0;
  const hasPending    = pending > 0;

  // A cycle is in flight when it has started but not yet reported its end.
  const isPushing     = push?.phase === "start" || push?.phase === "progress";
  const isPulling     = pull?.phase === "start" || pull?.phase === "progress";
  const isBusy        = isPushing || isPulling;
  // Errors come from the LAST COMPLETED cycle's real failure count, not from a
  // hardcoded sentence emitted whenever any tier failed.
  const liveError     = live?.phase === "end" && (live?.failed ?? 0) > 0;
  const liveOffline   = live?.phase === "offline";

  /** Human summary of the current/most recent cycle — built from real counts. */
  const liveDetail = (() => {
    if (!live) return null;
    if (live.phase === "offline") return "Cloud unreachable";
    const verb   = live.direction === "pull" ? "Pulling" : "Pushing";
    const tables = live.tables?.length ? ` — ${live.tables.join(", ")}` : "";
    if (isBusy) {
      return live.attempted > 0
        ? `${verb} ${live.attempted} row(s)${tables}`
        : `${verb}${tables}`;
    }
    if (live.phase === "end") {
      const bits = [];
      if (live.succeeded) bits.push(`${live.succeeded} applied`);
      if (live.failed)    bits.push(`${live.failed} failed`);
      if (live.skipped)   bits.push(`${live.skipped} deferred`);
      if (live.noop)      bits.push(`${live.noop} no-op`);
      if (!bits.length)   return null;
      return `${bits.join(" · ")} in ${live.duration_ms}ms`;
    }
    return null;
  })();

  const formatLastSynced = (isoStr) => {
    if (!isoStr) return null;
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return null;
    }
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* ── Enable / disable background sync ─────────────────────────────── */}
      <Section title="Background Cloud Replication">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">
              Enable automatic background sync
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              When on, local writes push to Supabase the moment they happen and
              remote changes stream in near-realtime (with a 5-second fallback
              poll). The POS always works offline — this flag only controls
              background replication.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={syncEnabled}
            disabled={syncToggleMutation.isPending}
            onClick={() => syncToggleMutation.mutate(!syncEnabled)}
            className={cn(
              "relative h-7 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              syncEnabled ? "bg-primary" : "bg-muted-foreground/25",
              syncToggleMutation.isPending && "opacity-60 pointer-events-none",
            )}
          >
            <span
              className={cn(
                "pointer-events-none absolute top-1 left-1 h-5 w-5 rounded-full bg-background shadow-sm ring-1 ring-border transition-transform duration-200",
                syncEnabled && "translate-x-4",
              )}
            />
          </button>
        </div>
      </Section>

      {/* ── Status banner ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3",
          cloudOnline && syncEnabled
            ? "border-success/25 bg-success/[0.06]"
            : isConfigured
            ? "border-warning/20 bg-warning/[0.04]"
            : "border-border/60 bg-muted/20",
        )}
      >
        {cloudOnline && syncEnabled ? (
          <Wifi className="h-5 w-5 text-success shrink-0" />
        ) : isConfigured && !cloudOnline ? (
          <WifiOff className="h-5 w-5 text-warning shrink-0" />
        ) : (
          <CloudOff className="h-5 w-5 text-muted-foreground shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-semibold",
            liveError
              ? "text-destructive"
              : cloudOnline && syncEnabled
              ? "text-success"
              : isConfigured && !cloudOnline
              ? "text-warning"
              : "text-foreground",
          )}>
            {!isConfigured
              ? "Cloud sync not configured"
              : liveOffline || !cloudOnline
              ? "Reconnecting to Supabase…"
              : !syncEnabled
              ? "Connected — sync paused"
              : liveError
              ? "Sync issue — retrying automatically"
              : isBusy
              ? (isPushing && isPulling
                  ? "Pushing and pulling…"
                  : isPushing ? "Pushing changes…" : "Pulling changes…")
              : "Synced & live"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            {isBusy    && <Loader2  className="h-3 w-3 animate-spin shrink-0" />}
            {isPushing && <Upload   className="h-3 w-3 shrink-0 text-primary" />}
            {isPulling && <Download className="h-3 w-3 shrink-0 text-primary" />}
            <span className="truncate">
              {!isConfigured
                ? "Enter your Supabase credentials below to enable multi-location sync."
                : liveOffline || !cloudOnline
                ? "The sync worker retries automatically when the host is reachable."
                : !syncEnabled
                ? "Background push and pull are paused. Toggle the switch above to start."
                : liveDetail
                ? liveDetail
                : lastSynced
                ? `Changes push instantly · last synced at ${formatLastSynced(lastSynced)}`
                : "Connected and ready — local changes push the moment they happen."}
            </span>
          </p>
        </div>

        {/* Realtime live indicator */}
        {cloudOnline && syncEnabled && lastRealtimeAt && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
            <span className="text-[10px] text-success font-medium">Live</span>
          </div>
        )}

        {isConfigured && (isOverride || !isEmbedded) && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            title={isEmbedded ? "Remove override — revert to built-in credentials" : "Clear credentials"}
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            {clearMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Trash2  className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>

      {/* ── Stats + actions ───────────────────────────────────────────────── */}
      {isConfigured && syncEnabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Pending"
              value={pending}
              accent={hasPending ? "warning" : "default"}
              sub={hasPending ? (isBusy ? "Syncing now…" : "Waiting to push") : "Queue empty"}
            />
            <StatCard
              label="Failed"
              value={failed}
              accent={hasFailed ? "destructive" : "default"}
              sub={hasFailed ? "Click to retry" : "All clear"}
            />
            <StatCard
              label="Synced Today"
              value={syncedToday}
              accent={syncedToday > 0 ? "success" : "default"}
              sub={formatLastSynced(lastSynced) ? `Last: ${formatLastSynced(lastSynced)}` : "None yet today"}
            />
            <StatCard
              label="Conflicts"
              value={conflicts}
              accent={conflicts > 0 ? "warning" : "default"}
              sub={conflicts > 0 ? "Auto-resolved — see below" : "None recorded"}
            />
          </div>

          {/* Sync event log — both directions, real errors, filterable.
              Replaces the old push-only "Recently synced" list. */}
          <SyncLogPanel />

          {/* Action row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-[11px]"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["sync-status"] });
                qc.invalidateQueries({ queryKey: ["failed-sync-rows"] });
              }}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-[11px]"
              disabled={backfillMutation.isPending}
              onClick={() => backfillMutation.mutate()}
            >
              {backfillMutation.isPending
                ? <Loader2  className="h-3 w-3 animate-spin" />
                : <Database className="h-3 w-3" />}
              {backfillMutation.isPending
                ? "Queueing…"
                : backfillMutation.isSuccess
                ? `Queued ${backfillMutation.data?.queued ?? 0} rows`
                : "Force Full Resync"}
            </Button>

            {hasFailed && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 text-[11px] border-destructive/30 text-destructive hover:bg-destructive/10"
                disabled={retryMutation.isPending}
                onClick={() => retryMutation.mutate()}
              >
                {retryMutation.isPending
                  ? <Loader2   className="h-3 w-3 animate-spin" />
                  : <RotateCcw className="h-3 w-3" />}
                {retryMutation.isPending
                  ? "Retrying…"
                  : `Retry ${failed} Failed`}
              </Button>
            )}

            {cloudOnline && syncEnabled && (
              <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Zap className="h-3 w-3 text-primary" />
                Realtime {lastRealtimeAt ? "active" : "ready"}
              </div>
            )}
          </div>

          {/* Failed rows detail (collapsible) */}
          {hasFailed && (
            <FailedRowsPanel
              onRetry={() => retryMutation.mutate()}
            />
          )}

          {/* Resolved conflicts audit (collapsible) */}
          {conflicts > 0 && <ConflictsPanel />}
        </div>
      )}


      {/* ── How it works ──────────────────────────────────────────────────── */}
      <Section title="How Cloud Sync Works">
        <div className="space-y-2 text-[12px] text-muted-foreground leading-relaxed">
          <p>
            <strong className="text-foreground">Offline-first:</strong> All
            sales, inventory, and records are saved locally first. The POS
            works even when the internet is down.
          </p>
          <p>
            <strong className="text-foreground">Queue-based push:</strong> Every
            local write is placed in a sync queue and replayed to Supabase in
            FK-dependency order — parent tables (stores, items) always arrive
            before their children (transactions, stock).
          </p>
          <p>
            <strong className="text-foreground">Cursor-based pull:</strong> The
            pull worker fetches rows from Supabase that are newer than the last
            cursor and UPSERTs them locally. The cursor advances to the actual
            max row timestamp — not the wall clock — so no rows are ever skipped.
          </p>
          <p>
            <strong className="text-foreground">Realtime across locations:</strong> When
            a remote change arrives via Supabase Realtime (WebSocket), the
            relevant screens refresh instantly without waiting for the next
            5-second pull cycle.
          </p>
          <p>
            <strong className="text-foreground">Retry on failure:</strong> Stuck
            or failed rows are automatically reset on startup and can be manually
            retried from this panel.
          </p>
        </div>
      </Section>
    </div>
  );
}
