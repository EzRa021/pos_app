// ============================================================================
// pages/LoginPage.jsx — Production-ready login page
// ============================================================================
// Matches StoresPage design language exactly:
//   • Same color tokens  (bg-card, border-border, text-muted-foreground…)
//   • Same label style   (10px uppercase tracking-wider)
//   • Same card/border-radius conventions (rounded-xl, rounded-2xl)
//   • Same input heights (h-9), same button sizing, same stat-card accents
// Layout: two-column — left brand/feature panel · right form card
// ============================================================================

import { useState, useEffect } from "react";
import {
  AlertCircle, Eye, EyeOff, LogIn, Loader2,
  Zap, ShieldCheck, Layers, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

const CONFIG_KEY = "qpos_config";
function readConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); } catch { return null; }
}

// ─── Feature pill — mirrors StoresPage StatCard accent style ─────────────────
function FeaturePill({ icon: Icon, label, sub, accent = "primary" }) {
  const colorMap = {
    primary: "border-primary/20  bg-primary/[0.06]  text-primary",
    success: "border-success/20  bg-success/[0.06]  text-success",
    warning: "border-warning/20  bg-warning/[0.06]  text-warning",
  };
  const cls = colorMap[accent] ?? colorMap.primary;
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3.5", cls)}>
      <div className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
        cls,
      )}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div>
        <p className="text-[12px] font-semibold leading-snug">{label}</p>
        <p className="text-[11px] opacity-60 mt-0.5 leading-snug">{sub}</p>
      </div>
    </div>
  );
}

// ─── Field label — identical to StoresPage ────────────────────────────────────
function FieldLabel({ children, required }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

// ─── Mode badge — small pill in the left panel footer ────────────────────────
function ModeBadge({ label }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
      <Activity className="h-2.5 w-2.5 text-success" />
      {label}
    </span>
  );
}

// ─── Main LoginPage ───────────────────────────────────────────────────────────
export default function LoginPage() {
  const config = readConfig();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const login      = useAuthStore(s => s.login);
  const isLoading  = useAuthStore(s => s.isLoading);
  const error      = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);

  const modeLabel =
    config?.mode === "server"
      ? "Server Terminal"
      : config
      ? `Client · ${config.host}:${config.apiPort ?? 4000}`
      : "Point of Sale";

  // Login page shows before a store is selected. If the last-used store had
  // theme='light', index.html's inline script removes the 'dark' class and all
  // design tokens resolve to light-mode values. Force dark here so the login
  // screen always uses the canonical dark colour palette.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("dark");
    html.style.background = "#09090b";
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    clearError();
    try { await login(username, password); } catch { /* error lives in store */ }
  }

  return (
    <div className="h-full w-full bg-background flex overflow-hidden">

      {/* ── LEFT — Brand panel ─────────────────────────────────────────── */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between
                      border-r border-border bg-card/40 px-10 py-10
                      relative overflow-hidden">

        {/* Subtle background grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* Radial glow — top-right corner */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/[0.06] blur-3xl" />

        {/* Logo + wordmark */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl
                          border border-primary/30 bg-primary/[0.08] shadow-sm">
            <span className="text-[18px] font-black text-primary leading-none">Q</span>
          </div>
          <div>
            <p className="text-[15px] font-black text-foreground tracking-tight leading-none">
              Quantum POS
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
              Management System
            </p>
          </div>
        </div>

        {/* Hero copy + feature pills */}
        <div className="relative space-y-7">
          <div>
            {/* Accent bar — same motif as StoresPage card header */}
            <div className="flex items-center gap-1.5 mb-4">
              <span className="h-[3px] w-6 rounded-full bg-primary" />
              <span className="h-[3px] w-2.5 rounded-full bg-primary/30" />
              <span className="h-[3px] w-1 rounded-full bg-primary/15" />
            </div>
            <h2 className="text-[26px] font-black text-foreground leading-[1.2] tracking-tight">
              Your business,<br />
              <span className="text-primary">one dashboard.</span>
            </h2>
            <p className="text-[12px] text-muted-foreground mt-3 leading-relaxed max-w-[280px]">
              Real-time sales, inventory, staff, and analytics —
              everything your store needs, beautifully unified.
            </p>
          </div>

          <div className="space-y-2.5">
            <FeaturePill
              icon={Zap}
              label="Instant sync across terminals"
              sub="Multi-store, multi-user, always in sync"
              accent="primary"
            />
            <FeaturePill
              icon={ShieldCheck}
              label="Role-based access control"
              sub="Cashier, manager, admin — granular permissions"
              accent="success"
            />
            <FeaturePill
              icon={Layers}
              label="Offline-first architecture"
              sub="Works without internet, syncs when back online"
              accent="warning"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            © {new Date().getFullYear()} Quantum POS
          </p>
          <ModeBadge label={modeLabel} />
        </div>
      </div>

      {/* ── RIGHT — Form panel ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 overflow-auto">
        <div className="w-full max-w-[370px] space-y-5">

          {/* Mobile-only logo */}
          <div className="flex items-center justify-between mb-1 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl
                              border border-primary/25 bg-primary/[0.06]">
                <span className="text-[15px] font-black text-primary leading-none">Q</span>
              </div>
              <div>
                <p className="text-[13px] font-bold text-foreground tracking-tight leading-none">
                  Quantum POS
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
                  {modeLabel}
                </p>
              </div>
            </div>
          </div>

          {/* ── Card ─────────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">

            {/* Card header */}
            <div className="px-6 pt-6 pb-5 border-b border-border/60 bg-muted/[0.025]">
              <div className="flex items-center gap-1.5 mb-3">
                <span className="h-[3px] w-6 rounded-full bg-primary" />
                <span className="h-[3px] w-2.5 rounded-full bg-primary/30" />
                <span className="h-[3px] w-1 rounded-full bg-primary/15" />
              </div>
              <h1 className="text-[20px] font-black text-foreground tracking-tight leading-none">
                Welcome back
              </h1>
              <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug">
                Sign in to access your dashboard
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

              {/* Username */}
              <div>
                <FieldLabel required>Username</FieldLabel>
                <Input
                  value={username}
                  onChange={e => { setUsername(e.target.value); clearError(); }}
                  placeholder="Enter your username"
                  autoComplete="username"
                  autoFocus
                  required
                  className="h-9 text-[13px] bg-background"
                />
              </div>

              {/* Password */}
              <div>
                <FieldLabel required>Password</FieldLabel>
                <div className="relative">
                  <Input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={e => { setPassword(e.target.value); clearError(); }}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    className="h-9 text-[13px] bg-background pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    tabIndex={-1}
                    aria-label={showPass ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2
                               text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPass
                      ? <EyeOff className="h-3.5 w-3.5" />
                      : <Eye    className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Error banner */}
              {error && (
                <div className="flex items-start gap-2 rounded-lg border
                                border-destructive/30 bg-destructive/[0.07]
                                px-3 py-2.5">
                  <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                  <p className="text-[11px] text-destructive leading-snug">{error}</p>
                </div>
              )}

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-9 gap-2 text-[13px] font-semibold mt-1"
                disabled={isLoading || !username.trim() || !password}
              >
                {isLoading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Signing in…</>
                  : <><LogIn   className="h-3.5 w-3.5" />Sign In</>}
              </Button>
            </form>
          </div>

          {/* Divider + help text */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border/40" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Need access?
            </p>
            <div className="flex-1 h-px bg-border/40" />
          </div>

          <p className="text-center text-[11px] text-muted-foreground leading-relaxed">
            Contact your system administrator to create or reset your account credentials.
          </p>

          {/* Bottom copyright — mobile */}
          <p className="text-center text-[10px] font-semibold uppercase tracking-wider
                        text-muted-foreground/40 lg:hidden pt-1">
            © {new Date().getFullYear()} Quantum POS
          </p>
        </div>
      </div>
    </div>
  );
}
