// features/settings/CloudSyncPanel.jsx
// Lets admins configure Supabase credentials for cloud sync.
// Shows live connection status, sync queue stats, failed-row details,
// and retry / force-resync controls.

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  clearSupabaseConfig,
  getSyncStatus,
  setCloudSyncEnabled,
  triggerBackfillSync,
  retryFailedSync,
  getFailedSyncRows,
} from "@/commands/cloud_sync";
import {
  initSupabaseClient,
  resetSupabaseClient,
  subscribeToSyncChanges,
  unsubscribeFromSyncChanges,
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import {
  Cloud, CloudOff, CheckCircle, AlertTriangle, Loader2,
  RefreshCw, Trash2, RotateCcw, ChevronDown, ChevronUp,
  Wifi, WifiOff, Database, Zap,
} from "lucide-react";

// ── Tables the frontend subscribes to for realtime invalidation ───────────────
const REALTIME_TABLES = [
  "items", "item_stock", "categories", "departments",
  "customers", "transactions", "shifts", "stores",
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="p-5">{children}</div>
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

// ── Main panel ─────────────────────────────────────────────────────────────────

export function CloudSyncPanel() {
  const qc = useQueryClient();

  const [form, setForm]   = useState({ url: "", anon_key: "", db_url: "" });
  const [saved, setSaved] = useState(false);
  /** Timestamp of the last realtime event received (for the live indicator). */
  const [lastRealtimeAt, setLastRealtimeAt] = useState(null);
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
      items:        [["items"], ["inventory"]],
      item_stock:   [["inventory"], ["item-stock"]],
      categories:   [["categories"]],
      departments:  [["departments"]],
      customers:    [["customers"]],
      transactions: [["transactions"], ["analytics"]],
      shifts:       [["shifts"]],
      stores:       [["stores"]],
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

  // ── Sync form with loaded config ──────────────────────────────────────────

  useEffect(() => {
    if (config) {
      setForm({
        url:      config.url      ?? "",
        anon_key: config.anon_key ?? "",
        db_url:   "",           // never round-trip the password
      });
    }
  }, [config]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: saveSupabaseConfig,
    onSuccess: async (result) => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["supabase-config"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      if (result?.is_connected) {
        await initSupabaseClient();
      }
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearSupabaseConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supabase-config"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      resetSupabaseClient();
      realtimeSetupRef.current = false;
      setForm({ url: "", anon_key: "", db_url: "" });
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
  const isConnected   = config?.is_connected  ?? false;
  const isEmbedded    = config?.is_embedded   ?? false;
  const pending       = status?.pending       ?? 0;
  const failed        = status?.failed        ?? 0;
  const syncedToday   = status?.synced_today  ?? 0;
  const cloudOnline   = status?.is_cloud_connected ?? false;
  const syncEnabled   = status?.cloud_sync_enabled ?? false;
  const lastSynced    = status?.last_synced_at;
  const hasFailed     = failed > 0;
  const hasPending    = pending > 0;

  const formatLastSynced = (isoStr) => {
    if (!isoStr) return null;
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return null;
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!form.url.trim() || !form.db_url.trim()) return;
    saveMutation.mutate({
      url:      form.url.trim(),
      anon_key: form.anon_key.trim(),
      db_url:   form.db_url.trim(),
    });
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Enable / disable background sync ─────────────────────────────── */}
      <Section title="Background Cloud Replication">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">
              Enable automatic background sync
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              When on, local writes are pushed to Supabase and remote changes
              are pulled every 5 seconds. The POS always works offline — this
              flag only controls background replication.
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
            cloudOnline && syncEnabled
              ? "text-success"
              : isConfigured && !cloudOnline
              ? "text-warning"
              : "text-foreground",
          )}>
            {!isConfigured
              ? "Cloud sync not configured"
              : !cloudOnline
              ? "Reconnecting to Supabase…"
              : !syncEnabled
              ? "Connected — sync paused"
              : "Syncing"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {!isConfigured
              ? "Enter your Supabase credentials below to enable multi-location sync."
              : !cloudOnline
              ? "The sync worker retries automatically every 5 s when the host is reachable."
              : !syncEnabled
              ? "Background push and pull are paused. Toggle the switch above to start."
              : lastSynced
              ? `Last synced today at ${formatLastSynced(lastSynced)}`
              : "Connected and ready — waiting for data to sync."}
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

        {isConfigured && !isEmbedded && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
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
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Pending"
              value={pending}
              accent={hasPending ? "warning" : "default"}
              sub={hasPending ? "Waiting to push" : "Queue empty"}
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
          </div>

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
        </div>
      )}

      {/* ── Credentials form ──────────────────────────────────────────────── */}
      {isEmbedded ? (
        <Section title="Supabase Configuration">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <Cloud className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-xs font-semibold text-foreground">Managed credentials</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Supabase credentials are embedded in this build. No manual configuration needed.
              </p>
            </div>
            {cloudOnline && (
              <CheckCircle className="h-4 w-4 text-success ml-auto shrink-0" />
            )}
          </div>
        </Section>
      ) : (
        <Section title="Supabase Configuration">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Project URL
              </label>
              <Input
                placeholder="https://xyzcompany.supabase.co"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
              <p className="text-[10px] text-muted-foreground">
                Found in Supabase Settings → API.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Anon / Public Key
              </label>
              <Input
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
                value={form.anon_key}
                onChange={(e) => setForm((f) => ({ ...f, anon_key: e.target.value }))}
              />
              <p className="text-[10px] text-muted-foreground">
                Public key — used only for Realtime subscriptions.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Database Connection URL
              </label>
              <Input
                type="password"
                placeholder="postgresql://postgres.xxx:password@aws-0-eu-west-2.pooler.supabase.com:6543/postgres"
                value={form.db_url}
                onChange={(e) => setForm((f) => ({ ...f, db_url: e.target.value }))}
              />
              <p className="text-[10px] text-muted-foreground">
                Use the <strong>Transaction pooler</strong> URL (port 6543) from
                Supabase Settings → Database. Stored server-side only — never
                returned to the frontend.
              </p>
            </div>

            {saveMutation.isError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.08] px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                <p className="text-[11px] text-destructive">
                  {String(saveMutation.error)}
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Button
                type="submit"
                disabled={saveMutation.isPending || !form.url || !form.db_url}
                className="gap-1.5"
              >
                {saveMutation.isPending ? (
                  <Loader2      className="h-3.5 w-3.5 animate-spin" />
                ) : saved ? (
                  <CheckCircle  className="h-3.5 w-3.5" />
                ) : (
                  <Cloud        className="h-3.5 w-3.5" />
                )}
                {saveMutation.isPending
                  ? "Connecting…"
                  : saved
                  ? "Connected!"
                  : "Save & Connect"}
              </Button>

              {isConnected && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => qc.invalidateQueries({ queryKey: ["sync-status"] })}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh Status
                </Button>
              )}
            </div>
          </form>
        </Section>
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
