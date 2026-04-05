// ============================================================================
// SERVER SETUP — Configure local PostgreSQL and connect
// ============================================================================
//
// Flow:
//  1. On mount → silently auto-try DEFAULT credentials (detecting…)
//     • SUCCESS → show "Server Online" card (IP for clients) → auto-advance 3 s
//     • FAIL    → show manual DB form (no error shown for auto-detect failure)
//  2. Manual form submit → same SUCCESS/FAIL path, but errors ARE shown
//
// After onConnected() fires, App.jsx takes over: it runs the onboarding
// check and session restore in parallel, then navigates automatically to
// OnboardingFlow, LoginScreen, or Dashboard — no more manual button clicks.
// ============================================================================

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Server, CheckCircle2, Copy, Check,
  Database, Loader2, Eye, EyeOff, AlertCircle, SkipForward
} from "lucide-react";

const DEFAULT = {
  host:     "localhost",
  port:     "5432",
  username: "quantum_user",
  password: "quantum_password",
  database: "pos_app",
};

function Label({ children, required }) {
  return (
    <label className="block text-xs font-medium text-foreground mb-1.5">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

export default function ServerSetup({ onConnected, onBack }) {
  const [form,     setForm]    = useState(DEFAULT);
  // detecting → auto-trying defaults on mount
  // idle      → show manual form (auto-detect failed)
  // connecting → manual form submitted, waiting
  // success   → connected, showing server info card
  // error     → manual connect failed
  const [status,   setStatus]  = useState("detecting");
  const [error,    setError]   = useState("");
  const [localIp,  setLocalIp] = useState("");
  const [apiPort,  setApiPort] = useState(4000);
  const [showPass, setShowPass] = useState(false);
  const [copied,   setCopied]  = useState(false);
  const advanceTimer = useRef(null);
  const connectedPayload = useRef(null);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  // ── Attempt a DB connection with the given config ─────────────────────────
  async function attemptConnect(config, silent = false) {
    if (!silent) {
      setStatus("connecting");
      setError("");
    }
    try {
      await invoke("db_connect", { config });
      await new Promise(r => setTimeout(r, 200));
      const [ip, port] = await Promise.all([
        invoke("get_local_ip"),
        invoke("get_api_port"),
      ]);
      setLocalIp(ip);
      setApiPort(port);

      const payload = {
        mode:     "server",
        host:     config.host,
        port:     config.port,
        username: config.username,
        password: config.password,
        database: config.database,
        localIp:  ip,
        apiPort:  port,
      };
      connectedPayload.current = payload;
      setStatus("success");

      // Auto-advance after 3 s — user can still click "Continue now" immediately
      advanceTimer.current = setTimeout(() => onConnected(payload), 3000);
    } catch (err) {
      if (silent) {
        // Auto-detect failed silently → show the manual form
        setStatus("idle");
      } else {
        setError(typeof err === "string" ? err : (err?.message ?? "Connection failed"));
        setStatus("error");
      }
    }
  }

  // ── On mount: auto-try defaults ───────────────────────────────────────────
  useEffect(() => {
    // First check if db is already connected (app restart / WebView reload)
    invoke("db_status")
      .then(s => {
        if (s?.connected) {
          // Already connected — get the port and skip straight to success
          return invoke("get_api_port").then(port => {
            return Promise.all([invoke("get_local_ip"), Promise.resolve(port)]);
          }).then(([ip, port]) => {
            setLocalIp(ip);
            setApiPort(port);
            const payload = { mode: "server", ...DEFAULT, localIp: ip, apiPort: port };
            connectedPayload.current = payload;
            setStatus("success");
            advanceTimer.current = setTimeout(() => onConnected(payload), 3000);
          });
        } else {
          // Try connecting with defaults silently
          return attemptConnect({
            host:     DEFAULT.host,
            port:     parseInt(DEFAULT.port, 10),
            username: DEFAULT.username,
            password: DEFAULT.password,
            database: DEFAULT.database,
          }, true /* silent */);
        }
      })
      .catch(() => {
        // db_status itself failed — fall back to manual form
        setStatus("idle");
      });

    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleContinueNow() {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (connectedPayload.current) onConnected(connectedPayload.current);
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    await attemptConnect({
      host:     form.host,
      port:     parseInt(form.port, 10),
      username: form.username,
      password: form.password,
      database: form.database,
    }, false /* not silent — show errors */);
  }

  function handleCopy() {
    navigator.clipboard.writeText(`${localIp}:${apiPort}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Detecting (auto-try in progress) ─────────────────────────────────────
  if (status === "detecting") {
    return (
      <div className="flex flex-col items-center gap-6 py-4 animate-fade-in">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
          <Database className="h-7 w-7 text-primary animate-pulse" />
        </div>
        <div className="text-center">
          <h2 className="text-base font-bold text-foreground">Detecting Database</h2>
          <p className="text-xs text-muted-foreground mt-1">Looking for a local PostgreSQL instance…</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Connecting to localhost…
        </div>
      </div>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className="flex flex-col gap-5 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/10 border border-green-500/20">
            <CheckCircle2 className="h-7 w-7 text-green-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Server Online</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Database connected — HTTP API is running</p>
          </div>
        </div>

        {/* Info card */}
        <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-foreground">Share with client terminals</p>
            <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              Online
            </span>
          </div>

          <Separator />

          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">Server Address</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <span className="flex-1 font-mono text-sm text-foreground">
                {localIp}<span className="text-muted-foreground">:{apiPort}</span>
              </span>
              <Button size="xs" variant="outline" onClick={handleCopy} className="shrink-0 gap-1.5 h-7 text-xs px-2">
                {copied ? <><Check className="h-3 w-3" />Copied!</> : <><Copy className="h-3 w-3" />Copy</>}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Database", value: form.database || DEFAULT.database },
              { label: "User",     value: form.username || DEFAULT.username },
              { label: "Port",     value: apiPort },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">{label}</p>
                <p className="text-xs text-foreground font-medium mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Auto-advance feedback + manual skip */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            Continuing in a moment…
          </div>
          <Button size="sm" variant="outline" onClick={handleContinueNow} className="gap-1.5 shrink-0">
            <SkipForward className="h-3.5 w-3.5" />
            Continue now
          </Button>
        </div>
      </div>
    );
  }

  // ── Manual form (auto-detect failed or user editing) ──────────────────────
  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="self-start -ml-1 gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 border border-primary/20">
            <Server className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Server Setup</h2>
            <p className="text-[11px] text-muted-foreground">
              {status === "idle"
                ? "Auto-detect failed — enter your PostgreSQL details"
                : "Configure your PostgreSQL connection"}
            </p>
          </div>
        </div>
      </div>

      {/* Auto-detect failed notice */}
      {status === "idle" && (
        <div className="flex items-start gap-2.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3.5 py-2.5">
          <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-xs text-yellow-300/90 leading-relaxed">
            Could not connect using default credentials. Please enter your PostgreSQL details below.
          </p>
        </div>
      )}

      {/* Connecting progress */}
      {status === "connecting" && (
        <div className="flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Connecting to database…
        </div>
      )}

      {/* Error */}
      {(status === "error") && error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <form onSubmit={handleFormSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Host" required>
            <Input value={form.host} onChange={e => set("host", e.target.value)} placeholder="localhost" required />
          </Field>
          <Field label="Port" required>
            <Input value={form.port} onChange={e => set("port", e.target.value)} placeholder="5432" type="number" min="1" max="65535" required />
          </Field>
        </div>

        <Field label="Database Name" required>
          <Input value={form.database} onChange={e => set("database", e.target.value)} placeholder="pos_app" required />
        </Field>

        <Field label="Username" required>
          <Input value={form.username} onChange={e => set("username", e.target.value)} placeholder="quantum_user" required />
        </Field>

        <Field label="Password">
          <div className="relative">
            <Input
              type={showPass ? "text" : "password"}
              value={form.password}
              onChange={e => set("password", e.target.value)}
              placeholder="Database password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPass(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <Button type="submit" className="w-full h-11 mt-1" disabled={status === "connecting"}>
          {status === "connecting"
            ? <><Loader2 className="h-4 w-4 animate-spin" />Connecting…</>
            : <><Database className="h-4 w-4" />Connect & Start Server</>}
        </Button>
      </form>
    </div>
  );
}
