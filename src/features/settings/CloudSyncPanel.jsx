// features/settings/CloudSyncPanel.jsx
// Lets admins configure Supabase credentials for cloud sync.
// Shows connection status and sync queue statistics.

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  clearSupabaseConfig,
  getSyncStatus,
  setCloudSyncEnabled,
} from "@/commands/cloud_sync";
import { initSupabaseClient, resetSupabaseClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Cloud, CloudOff, CheckCircle, AlertTriangle, Loader2,
  RefreshCw, Trash2,
} from "lucide-react";

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

function StatCard({ label, value, accent = "default" }) {
  const ring = {
    default: "border-border/60 bg-card",
    success: "border-success/25 bg-success/[0.06]",
    warning: "border-warning/25 bg-warning/[0.06]",
    destructive: "border-destructive/25 bg-destructive/[0.06]",
  }[accent];
  const val = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
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
    </div>
  );
}

export function CloudSyncPanel() {
  const qc = useQueryClient();

  const [form, setForm] = useState({ url: "", anon_key: "", db_url: "" });
  const [saved, setSaved] = useState(false);

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey:  ["supabase-config"],
    queryFn:   getSupabaseConfig,
    staleTime: 60_000,
  });

  const { data: status } = useQuery({
    queryKey:        ["sync-status"],
    queryFn:         getSyncStatus,
    refetchInterval: 10_000,
    staleTime:       8_000,
    retry:           false,
  });

  useEffect(() => {
    if (config) {
      setForm({
        url:      config.url      ?? "",
        anon_key: config.anon_key ?? "",
        db_url:   "",
      });
    }
  }, [config]);

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
      setForm({ url: "", anon_key: "", db_url: "" });
    },
  });

  const syncToggleMutation = useMutation({
    mutationFn: setCloudSyncEnabled,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync-status"] });
    },
  });

  const isConfigured = config?.is_configured ?? false;
  const isConnected  = config?.is_connected  ?? false;
  const isEmbedded   = config?.is_embedded   ?? false;
  const hasPending   = (status?.pending ?? 0) > 0;
  const hasFailed    = (status?.failed  ?? 0) > 0;
  const cloudOnline  = status?.is_cloud_connected ?? false;
  const syncEnabled  = status?.cloud_sync_enabled ?? false;

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
      {/* Opt-in: background replication (stored in app_config.cloud_sync_enabled) */}
      <Section title="Background Cloud Replication">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Enable automatic background sync</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Off by default. When enabled, the app pushes queued local writes to Supabase and
              pulls remote changes every few seconds. Credentials can be saved without enabling
              this — useful for onboarding restores or future use. Turning this off never affects
              fetching or restoring business data during initial setup.
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

      {/* Status banner */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3",
          cloudOnline && syncEnabled
            ? "border-success/25 bg-success/[0.06]"
            : "border-border/60 bg-muted/20",
        )}
      >
        {cloudOnline && syncEnabled ? (
          <CheckCircle className="h-5 w-5 text-success shrink-0" />
        ) : (
          <CloudOff className="h-5 w-5 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm font-semibold",
              cloudOnline && syncEnabled ? "text-success" : "text-foreground",
            )}
          >
            {!isConfigured
              ? "Cloud sync not configured"
              : !cloudOnline
              ? "Cloud sync configured — reconnecting…"
              : !syncEnabled
              ? "Cloud connected — sync paused"
              : "Cloud sync active"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {!isConfigured
              ? "Configure your Supabase project below for multi-location sync."
              : !cloudOnline
              ? "The sync worker will connect automatically when the host is reachable."
              : !syncEnabled
              ? "Background push and pull are off. Turn on “Allow background cloud sync” above to replicate data."
              : "Data is being replicated to Supabase in real time."}
          </p>
        </div>
        {isConfigured && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            {clearMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>

      {/* Stats */}
      {isConfigured && syncEnabled && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Pending"
            value={status?.pending ?? "—"}
            accent={hasPending ? "warning" : "default"}
          />
          <StatCard
            label="Failed"
            value={status?.failed ?? "—"}
            accent={hasFailed ? "destructive" : "default"}
          />
          <StatCard
            label="Synced Today"
            value={status?.synced_today ?? "—"}
            accent={cloudOnline ? "success" : "default"}
          />
        </div>
      )}

      {/* Config form — hidden when credentials are embedded at build time */}
      {isEmbedded ? (
        <Section title="Supabase Configuration">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <Cloud className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-xs font-semibold text-foreground">Managed credentials</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Supabase credentials are embedded in this build. No manual configuration is needed.
              </p>
            </div>
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
              Found in your Supabase project Settings → API.
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
              Public key — safe to expose. Used only for realtime subscriptions.
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
              Supabase Settings → Database → Connection string. Never shared
              with the frontend — stored server-side only.
            </p>
          </div>

          {saveMutation.isError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5">
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
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saved ? (
                <CheckCircle className="h-3.5 w-3.5" />
              ) : (
                <Cloud className="h-3.5 w-3.5" />
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
                onClick={() => {
                  qc.invalidateQueries({ queryKey: ["sync-status"] });
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh Status
              </Button>
            )}
          </div>
        </form>
      </Section>
      )}

      {/* How it works */}
      <Section title="How Cloud Sync Works">
        <div className="space-y-2 text-[12px] text-muted-foreground leading-relaxed">
          <p>
            <strong className="text-foreground">Offline-first:</strong> All
            sales, inventory, and records are saved locally first. The POS
            works even when the internet is down.
          </p>
          <p>
            <strong className="text-foreground">Background sync:</strong> Every
            5 seconds, the app replays queued writes to your Supabase database
            when a connection is available.
          </p>
          <p>
            <strong className="text-foreground">Real-time across locations:</strong> Once
            data reaches Supabase, all other connected branches receive the
            update in real time via Supabase Realtime (WebSocket).
          </p>
          <p>
            <strong className="text-foreground">Retry on failure:</strong> If a
            sync write fails, it is retried automatically up to 10 times before
            being marked as failed.
          </p>
        </div>
      </Section>
    </div>
  );
}
