// ============================================================================
// features/settings/ConnectionSettingsPanel.jsx
// ============================================================================
// Shows this terminal's full connection details (Server or Client mode) and
// lets an admin change the terminal's mode. Changing mode is destructive by
// design — it wipes the local session/auth, the saved connection config, and
// every cached UI preference tied to the old setup, then restarts the app
// straight into the Setup Wizard (Mode Selector).
//
// Read-only "live" fields (local IP, resolved API port, reachability) are
// re-checked on demand via the same Tauri commands ServerSetup/ClientSetup use,
// so the numbers shown here can never drift from what the app is actually using.
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";
import { CONFIG_KEY } from "@/features/setup/SetupWizard";
import { useAuthStore } from "@/stores/auth.store";

import {
  Server, Monitor, Wifi, Database, Copy, Check,
  Loader2, RefreshCw, ShieldAlert, CheckCircle2, XCircle,
  KeyRound, Network, HardDrive,
} from "lucide-react";

const ONBOARDING_CACHE_KEY = "qpos_onboarding_done";

// ── Layout helpers (match CloudSyncPanel's visual language) ──────────────────

function Section({ title, icon: Icon, children, right }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </h2>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, mono = true, copyable = false, icon: Icon }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!value) return;
    navigator.clipboard.writeText(String(value)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn(
          "text-[13px] text-foreground truncate max-w-[220px]",
          mono && "font-mono",
        )}>
          {value ?? <span className="text-muted-foreground/50 italic">—</span>}
        </span>
        {copyable && value && (
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            title="Copy"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function ConnectionSettingsPanel() {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState(null);
  const [live, setLive] = useState({ localIp: null, apiPort: null, dbConnected: null });
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState(null); // "online" | "offline" | null
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changing, setChanging] = useState(false);

  // ── Load saved config ────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      setConfig(raw ? JSON.parse(raw) : null);
    } catch {
      setConfig(null);
    }
  }, []);

  // ── Refresh live details ─────────────────────────────────────────────────
  const refreshLive = useCallback(async () => {
    if (!config) return;
    setChecking(true);
    setHealth(null);
    try {
      if (config.mode === "server") {
        const [status, ip, port] = await Promise.all([
          invoke("db_status").catch(() => ({ connected: false })),
          invoke("get_local_ip").catch(() => null),
          invoke("get_api_port").catch(() => null),
        ]);
        setLive({ localIp: ip, apiPort: port, dbConnected: !!status?.connected });

        if (port) {
          try {
            const res = await fetch(`http://localhost:${port}/health`, {
              signal: AbortSignal.timeout(3000),
            });
            setHealth(res.ok ? "online" : "offline");
          } catch {
            setHealth("offline");
          }
        } else {
          setHealth("offline");
        }
      } else {
        const host = config.host;
        const port = config.apiPort ?? 4000;
        setLive({ localIp: null, apiPort: port, dbConnected: null });
        try {
          const res = await fetch(`http://${host}:${port}/health`, {
            signal: AbortSignal.timeout(4000),
          });
          setHealth(res.ok ? "online" : "offline");
        } catch {
          setHealth("offline");
        }
      }
    } finally {
      setChecking(false);
    }
  }, [config]);

  useEffect(() => { refreshLive(); }, [refreshLive]);

  const isServer = config?.mode === "server";

  // ── Change mode: full reset, then restart into Setup Wizard ─────────────
  async function handleChangeMode() {
    setChanging(true);
    try {
      // Best-effort server-side logout + local auth teardown.
      try { await useAuthStore.getState().logout(); } catch { /* ignore */ }

      // React Query cache — no stale data should survive into the new setup.
      queryClient.clear();

      // Everything persisted by this app that ties the terminal to its
      // current identity/config. Deliberately explicit rather than a blanket
      // localStorage.clear() so unrelated browser/OS-level storage is untouched.
      const keysToRemove = [
        CONFIG_KEY,            // server/client connection config
        ONBOARDING_CACHE_KEY,  // cached onboarding-complete flag
        "qpos_refresh",        // auth refresh token
        "qpos_user",           // cached user object
        "qpos_active_store",   // last active branch/store
      ];
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      sessionStorage.removeItem("qpos_locked");

      // Reload so App.jsx re-evaluates from a clean slate and shows the
      // Setup Wizard (ModeSelector) exactly like a first-ever launch.
      window.location.reload();
    } catch {
      setChanging(false);
    }
  }

  if (!config) {
    return (
      <Section title="Connection" icon={Network}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <ShieldAlert className="h-4 w-4" />
          No connection configuration found on this terminal.
        </div>
      </Section>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Mode banner ───────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3.5",
          isServer
            ? "border-primary/25 bg-primary/[0.05]"
            : "border-border/60 bg-muted/20",
        )}
      >
        <div className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl border shrink-0",
          isServer ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted/40 text-muted-foreground",
        )}>
          {isServer ? <Server className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground">
            {isServer ? "Server Mode" : "Client Mode"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {isServer
              ? "This terminal hosts the database and API for other terminals."
              : "This terminal connects to a server running elsewhere on the network."}
          </p>
        </div>

        {/* Live health */}
        <div className="flex items-center gap-2 shrink-0">
          {checking ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
            </span>
          ) : health === "online" ? (
            <span className="flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Online
            </span>
          ) : health === "offline" ? (
            <span className="flex items-center gap-1.5 rounded-full border border-destructive/25 bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive">
              <XCircle className="h-3.5 w-3.5" /> Unreachable
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[11px] px-2"
            onClick={refreshLive}
            disabled={checking}
          >
            <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Full server details ──────────────────────────────────────────── */}
      <Section title="Server Details" icon={Database}>
        <div>
          {isServer ? (
            <>
              <DetailRow label="Role" value="Server (Host)" mono={false} icon={Server} />
              <DetailRow
                label="Reachable address"
                value={live.localIp ? `${live.localIp}:${live.apiPort ?? config.apiPort ?? "—"}` : (config.localIp ? `${config.localIp}:${config.apiPort ?? "—"}` : null)}
                copyable
                icon={Wifi}
              />
              <DetailRow label="API port" value={live.apiPort ?? config.apiPort} icon={Network} />
              <DetailRow label="Database host" value={config.host} icon={HardDrive} />
              <DetailRow label="Database port" value={config.port} />
              <DetailRow label="Database name" value={config.database} icon={Database} />
              <DetailRow label="Database user" value={config.username} icon={KeyRound} />
              <DetailRow
                label="DB connection"
                value={live.dbConnected === null ? null : live.dbConnected ? "Connected" : "Disconnected"}
                mono={false}
              />
            </>
          ) : (
            <>
              <DetailRow label="Role" value="Client (Terminal)" mono={false} icon={Monitor} />
              <DetailRow
                label="Connected to"
                value={config.host ? `${config.host}:${live.apiPort ?? config.apiPort ?? 4000}` : null}
                copyable
                icon={Wifi}
              />
              <DetailRow label="Server host / IP" value={config.host} icon={HardDrive} />
              <DetailRow label="API port" value={live.apiPort ?? config.apiPort ?? 4000} icon={Network} />
            </>
          )}
        </div>
      </Section>

      {/* ── Danger zone: change mode ──────────────────────────────────────── */}
      <Section title="Danger Zone" icon={ShieldAlert}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Change terminal mode</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed max-w-md">
              Switches this terminal between Server and Client mode. This will
              sign you out, clear the saved connection config, cached session,
              and active store — then restart into the setup wizard. This
              cannot be undone from within the app.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setConfirmOpen(true)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Change Mode
          </Button>
        </div>
      </Section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Change terminal mode?"
        description="This will log you out and permanently clear this terminal's saved server config, session, and active store selection. The app will restart into the setup wizard so you can choose Server or Client mode again."
        confirmLabel="Yes, change mode"
        cancelLabel="Cancel"
        variant="destructive"
        isLoading={changing}
        onConfirm={handleChangeMode}
      />
    </div>
  );
}
