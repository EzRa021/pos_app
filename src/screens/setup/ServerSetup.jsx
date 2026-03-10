// ============================================================================
// SERVER SETUP — Configure local PostgreSQL and connect
// ============================================================================

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Server, CheckCircle2, Copy, Check,
  Database, Loader2, Eye, EyeOff, AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [form,     setForm]     = useState(DEFAULT);
  const [status,   setStatus]   = useState("idle");
  const [error,    setError]    = useState("");
  const [localIp,  setLocalIp]  = useState("");
  const [apiPort,  setApiPort]  = useState(4000);
  const [showPass, setShowPass] = useState(false);
  const [copied,   setCopied]   = useState(false);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleConnect(e) {
    e.preventDefault();
    setStatus("connecting");
    setError("");
    try {
      await invoke("db_connect", {
        config: {
          host:     form.host,
          port:     parseInt(form.port, 10),
          username: form.username,
          password: form.password,
          database: form.database,
        },
      });
      await new Promise(r => setTimeout(r, 300));
      const [ip, port] = await Promise.all([
        invoke("get_local_ip"),
        invoke("get_api_port"),
      ]);
      setLocalIp(ip);
      setApiPort(port);
      setStatus("success");
    } catch (err) {
      setError(typeof err === "string" ? err : (err?.message ?? "Connection failed"));
      setStatus("error");
    }
  }

  function handleContinue() {
    onConnected({
      mode:     "server",
      host:     form.host,
      port:     parseInt(form.port, 10),
      username: form.username,
      password: form.password,
      database: form.database,
      localIp,
      apiPort,
    });
  }

  function handleCopy() {
    navigator.clipboard.writeText(`${localIp}:${apiPort}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success/15 border border-success/20">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Server Online</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Database connected — HTTP API is running</p>
          </div>
        </div>

        {/* Info card */}
        <div className="rounded-xl border border-border bg-background p-5 space-y-4">
          {/* Status row */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Share with client terminals</p>
            <span className="flex items-center gap-1.5 rounded-full bg-success/10 border border-success/20 px-2.5 py-0.5 text-[11px] font-semibold text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" style={{ animation: "pulse-dot 1.5s ease-in-out infinite" }} />
              Online
            </span>
          </div>

          <Separator className="bg-border" />

          {/* Copyable address */}
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">Server Address</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <span className="flex-1 font-mono text-sm text-foreground">
                {localIp}<span className="text-muted-foreground">:{apiPort}</span>
              </span>
              <Button size="xs" variant="outline" onClick={handleCopy} className="shrink-0 gap-1.5">
                {copied ? <><Check className="h-3 w-3" />Copied!</> : <><Copy className="h-3 w-3" />Copy</>}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">Enter this on each client terminal during setup.</p>
          </div>

          <Separator className="bg-border" />

          {/* DB summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Database", value: `${form.database}@${form.host}` },
              { label: "User",     value: form.username },
              { label: "API Port", value: apiPort },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">{label}</p>
                <p className="text-xs text-foreground font-medium mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <Button onClick={handleContinue} className="w-full h-11" size="lg">
          Continue to Login
          <ArrowLeft className="h-4 w-4 rotate-180" />
        </Button>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4">
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
            <p className="text-[11px] text-muted-foreground">Configure your PostgreSQL connection</p>
          </div>
        </div>
      </div>

      {/* Progress */}
      {status === "connecting" && (
        <div className="flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Connecting to database and starting API server…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <form onSubmit={handleConnect} className="flex flex-col gap-4">
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
