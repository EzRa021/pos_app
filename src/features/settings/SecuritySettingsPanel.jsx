// ============================================================================
// features/settings/SecuritySettingsPanel.jsx — PIN lock & session management
// ============================================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Shield, Monitor, LogOut, KeyRound,
  CheckCircle2, AlertCircle, RefreshCw, Timer,
} from "lucide-react";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn }     from "@/lib/utils";
import { setPosPin, getActiveSessions, revokeSession } from "@/commands/security";
import { AUTO_LOCK_KEY, getAutoLockMinutes } from "./security-utils";
import { useBranchStore } from "@/stores/branch.store";
import { useAuthStore }   from "@/stores/auth.store";
import { formatDateTime } from "@/lib/format";

function SectionCard({ title, icon: Icon, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── PIN setter ─────────────────────────────────────────────────────────────────
function PinSetterPanel() {
  const [pin,    setPin]    = useState("");
  const [pinB,   setPinB]   = useState("");
  const [done,   setDone]   = useState(false);
  const [error,  setError]  = useState("");

  const save = useMutation({
    mutationFn: () => setPosPin(pin),
    onSuccess: () => { setDone(true); setPin(""); setPinB(""); setTimeout(() => setDone(false), 3000); },
    onError:   (e) => setError(String(e)),
  });

  const handleSet = () => {
    setError("");
    if (!/^\d{4}$/.test(pin))  { setError("PIN must be exactly 4 digits."); return; }
    if (pin !== pinB)           { setError("PINs do not match."); return; }
    save.mutate();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Set a 4-digit PIN to quickly unlock the POS screen without full login.
        This is required before using the PIN lock feature.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">New PIN</label>
          <Input type="password" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="4 digits" className="h-8 text-sm tracking-widest" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Confirm PIN</label>
          <Input type="password" maxLength={4} value={pinB} onChange={(e) => setPinB(e.target.value.replace(/\D/g, ""))}
            placeholder="4 digits" className="h-8 text-sm tracking-widest" />
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />{error}
        </div>
      )}
      {done && (
        <div className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />PIN updated successfully.
        </div>
      )}
      <Button size="sm" onClick={handleSet} disabled={save.isPending || pin.length !== 4 || pinB.length !== 4} className="gap-1.5">
        {save.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Setting…</> : <><KeyRound className="h-3.5 w-3.5" />Set PIN</>}
      </Button>
    </div>
  );
}

// ── Auto-lock timeout ────────────────────────────────────────────────────────

const TIMEOUT_OPTIONS = [
  { value: "0",  label: "Never"      },
  { value: "1",  label: "1 minute"   },
  { value: "2",  label: "2 minutes"  },
  { value: "5",  label: "5 minutes"  },
  { value: "10", label: "10 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
];

function AutoLockPanel() {
  // Read from localStorage, seeding the default on first call
  const [timeoutVal, setTimeoutVal] = useState(
    () => String(getAutoLockMinutes()),
  );

  const handleChange = (val) => {
    localStorage.setItem(AUTO_LOCK_KEY, val);
    setTimeoutVal(val);
    const label = TIMEOUT_OPTIONS.find((o) => o.value === val)?.label;
    if (val === "0") {
      toastSuccess("Auto-lock Disabled", "The POS screen will stay open until manually locked.");
    } else {
      toastSuccess("Auto-lock Updated", `Screen will lock after ${label} of inactivity.`);
    }
  };

  const selectedLabel = TIMEOUT_OPTIONS.find((o) => o.value === timeoutVal)?.label;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Automatically lock the POS screen after a period of inactivity.
        Set to <strong className="text-foreground">Never</strong> to disable.
      </p>
      <div className="flex items-center gap-3">
        <Select value={timeoutVal} onValueChange={handleChange}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEOUT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">of inactivity</span>
      </div>
      {timeoutVal !== "0" && (
        <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
          <Timer className="h-3 w-3 shrink-0" />
          Locks after <strong className="text-foreground">{selectedLabel}</strong> of no mouse, keyboard, or touch activity.
        </p>
      )}
    </div>
  );
}

// ── Active sessions ────────────────────────────────────────────────────────────
function ActiveSessionsPanel() {
  const storeId  = useBranchStore((s) => s.activeStore?.id);
  const selfId   = useAuthStore((s) => s.user?.id);
  const qc       = useQueryClient();

  const { data: sessions = [], isLoading, refetch } = useQuery({
    queryKey: ["active-sessions", storeId],
    queryFn:  () => getActiveSessions(storeId),
    enabled:  !!storeId,
    staleTime: 30_000,
  });

  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active-sessions"] });
      toastSuccess("Session Revoked", "The user has been signed out and their access removed.");
    },
    onError: (e) => onMutationError("Couldn't Revoke Session", e),
  });

  if (isLoading) return (
    <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm justify-center">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
    </div>
  );

  if (sessions.length === 0) return (
    <div className="py-6 text-center text-sm text-muted-foreground">No active sessions.</div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">{sessions.length} active session{sessions.length !== 1 ? "s" : ""}</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 text-[11px] gap-1">
          <RefreshCw className="h-3 w-3" />Refresh
        </Button>
      </div>
      {sessions.map((s) => (
        <div key={s.id} className={cn(
          "flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3",
          s.user_id === selfId ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20",
        )}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
              <Monitor className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                {s.username}
                {s.user_id === selfId && (
                  <span className="rounded-full bg-primary/15 text-primary px-1.5 py-0 text-[9px] font-bold">YOU</span>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Last seen {formatDateTime(s.last_seen_at)} · Expires {formatDateTime(s.expires_at)}
              </p>
              {s.device_info && <p className="text-[10px] text-muted-foreground/60 truncate">{s.device_info}</p>}
            </div>
          </div>
          {s.user_id !== selfId && (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
              title="Revoke session"
              onClick={() => revoke.mutate(s.id)}
              disabled={revoke.isPending}>
              <LogOut className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function SecuritySettingsPanel() {
  return (
    <div className="space-y-5">
      <SectionCard title="POS PIN (Quick Lock)" icon={KeyRound}>
        <PinSetterPanel />
      </SectionCard>
      <SectionCard title="Auto-Lock Timeout" icon={Timer}>
        <AutoLockPanel />
      </SectionCard>
      <SectionCard title="Active Sessions" icon={Shield}>
        <ActiveSessionsPanel />
      </SectionCard>
    </div>
  );
}
