// ============================================================================
// CLIENT SETUP — Connect to a remote Quantum POS server
// ============================================================================

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Monitor, CheckCircle2, Info,
  Loader2, AlertCircle, Wifi
} from "lucide-react";

const DEFAULT = { host: "", apiPort: "4000" };

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1.5">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function ClientSetup({ onConnected, onBack }) {
  const [form,   setForm]   = useState(DEFAULT);
  const [status, setStatus] = useState("idle");
  const [error,  setError]  = useState("");

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleConnect(e) {
    e.preventDefault();
    setStatus("connecting");
    setError("");
    const host    = form.host.trim();
    const apiPort = parseInt(form.apiPort, 10) || 4000;
    try {
      const res = await fetch(`http://${host}:${apiPort}/health`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setStatus("success");
    } catch (err) {
      setError(err?.message ?? "Could not reach the server. Check the IP and port.");
      setStatus("error");
    }
  }

  function handleContinue() {
    onConnected({
      mode:    "client",
      host:    form.host.trim(),
      apiPort: parseInt(form.apiPort, 10) || 4000,
    });
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (status === "success") {
    const apiPort = parseInt(form.apiPort, 10) || 4000;
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success/15 border border-success/20">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Connected!</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Server is reachable and responding</p>
          </div>
        </div>

        {/* Info card */}
        <div className="rounded-xl border border-border bg-background p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Server reached successfully</p>
            <span className="flex items-center gap-1.5 rounded-full bg-success/10 border border-success/20 px-2.5 py-0.5 text-[11px] font-semibold text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" style={{ animation: "pulse-dot 1.5s ease-in-out infinite" }} />
              Connected
            </span>
          </div>

          <Separator className="bg-border" />

          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">Connected To</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <Wifi className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-sm text-foreground">
                {form.host.trim()}<span className="text-muted-foreground">:{apiPort}</span>
              </span>
            </div>
          </div>

          <Separator className="bg-border" />

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Mode",   value: "Client Terminal" },
              { label: "Server", value: form.host.trim() },
              { label: "Port",   value: apiPort },
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted border border-border">
            <Monitor className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Client Setup</h2>
            <p className="text-[11px] text-muted-foreground">Connect to a Quantum POS server</p>
          </div>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-primary/90 leading-relaxed">
          The server terminal displays its IP address and port on the connection screen after setup.
        </p>
      </div>

      {/* Progress */}
      {status === "connecting" && (
        <div className="flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Testing connection to server…
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
          <Field label="Server IP Address" required>
            <Input
              value={form.host}
              onChange={e => set("host", e.target.value)}
              placeholder="192.168.1.100"
              required
              autoFocus
            />
          </Field>
          <Field label="API Port" required>
            <Input
              value={form.apiPort}
              onChange={e => set("apiPort", e.target.value)}
              placeholder="4000"
              type="number"
              min="1"
              max="65535"
              required
            />
          </Field>
        </div>

        <Button type="submit" className="w-full h-11 mt-1" disabled={status === "connecting"}>
          {status === "connecting"
            ? <><Loader2 className="h-4 w-4 animate-spin" />Testing connection…</>
            : <><Wifi className="h-4 w-4" />Connect to Server</>}
        </Button>
      </form>
    </div>
  );
}
