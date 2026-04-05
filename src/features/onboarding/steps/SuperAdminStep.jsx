// ============================================================================
// features/onboarding/steps/SuperAdminStep.jsx
// ============================================================================
// Full-page step rendered after business creation.
// Creates the owner / super-admin account via setup_super_admin RPC.
// This route is unauthenticated — the backend only allows it during onboarding.
// ============================================================================

import { useState, useEffect } from "react";
import {
  Eye, EyeOff, ShieldCheck, Check, Loader2, User,
  Mail, Lock, ChevronRight, AlertCircle, Sparkles,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn }   from "@/lib/utils";
import { rpc }  from "@/lib/apiClient";

// ─── Password strength ────────────────────────────────────────────────────────
function calcStrength(pw) {
  let score = 0;
  if (pw.length >= 8)           score++;
  if (/[A-Z]/.test(pw))         score++;
  if (/[a-z]/.test(pw))         score++;
  if (/[0-9]/.test(pw))         score++;
  if (/[^A-Za-z0-9]/.test(pw))  score++;
  return score;
}

const STRENGTH_LABEL = ["", "Very Weak", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLOR = ["", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-blue-500", "bg-emerald-500"];

function PasswordStrengthBar({ password }) {
  const score = calcStrength(password);
  if (!password) return null;
  return (
    <div className="space-y-1.5 mt-2">
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn("h-1 flex-1 rounded-full transition-all duration-300",
              i < score ? STRENGTH_COLOR[score] : "bg-muted")}
          />
        ))}
      </div>
      <p className={cn("text-[10px] font-medium",
        score >= 4 ? "text-emerald-400" : score >= 3 ? "text-yellow-400" : "text-muted-foreground/50")}>
        {STRENGTH_LABEL[score]}
      </p>
    </div>
  );
}

function Requirement({ met, label }) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-300",
        met ? "border-emerald-500 bg-emerald-500/15" : "border-border bg-muted/20",
      )}>
        {met && <Check className="h-2.5 w-2.5 text-emerald-400" strokeWidth={3} />}
      </div>
      <span className={cn("text-[11px] transition-colors duration-200",
        met ? "text-foreground" : "text-muted-foreground/50")}>
        {label}
      </span>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
        {required && <span className="text-violet-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Ambient background ───────────────────────────────────────────────────────
function AmbientBlobs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full opacity-[0.06]"
        style={{ background: "radial-gradient(circle, #8b5cf6 0%, transparent 70%)" }}
      />
      <div
        className="absolute -bottom-48 -right-16 h-[380px] w-[380px] rounded-full opacity-[0.05]"
        style={{ background: "radial-gradient(circle, #6366f1 0%, transparent 70%)" }}
      />
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `
            linear-gradient(#8b5cf6 1px, transparent 1px),
            linear-gradient(90deg, #8b5cf6 1px, transparent 1px)
          `,
          backgroundSize: "36px 36px",
        }}
      />
    </div>
  );
}

// ─── Success screen ────────────────────────────────────────────────────────────
function SuccessScreen({ username }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now(), dur = 1600;
    const raf = () => {
      const p = Math.min(100, ((Date.now() - start) / dur) * 100);
      setProgress(p);
      if (p < 100) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-8 py-12 animate-in fade-in zoom-in-95 duration-500">
      <div className="relative flex items-center justify-center">
        <div className="absolute h-28 w-28 rounded-full bg-violet-500/[0.07] animate-ping" style={{ animationDuration: "2.2s" }} />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-violet-500 bg-violet-500/10 shadow-2xl shadow-violet-500/20">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500/20 to-transparent" />
          <ShieldCheck className="relative h-9 w-9 text-violet-400" strokeWidth={1.5} />
        </div>
      </div>
      <div className="text-center space-y-2 max-w-xs">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3.5 py-1.5 text-[11px] font-bold text-violet-400">
          <Sparkles className="h-3 w-3" />
          Account Created
        </div>
        <h3 className="text-2xl font-bold text-foreground">Welcome, @{username}</h3>
        <p className="text-sm text-muted-foreground">Finishing setup…</p>
      </div>
      <div className="w-48">
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-75 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function SuperAdminStep({ businessName, onSuccess }) {
  const [form, setForm] = useState({
    first_name: "", last_name: "", username: "", email: "",
    password: "", confirm: "",
  });
  const [showPw,  setShowPw]  = useState(false);
  const [showCon, setShowCon] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: typeof e === "string" ? e : e.target.value }));

  const pwOk = {
    length: form.password.length >= 8,
    upper:  /[A-Z]/.test(form.password),
    lower:  /[a-z]/.test(form.password),
    number: /[0-9]/.test(form.password),
    match:  form.password === form.confirm && form.confirm.length > 0,
  };
  const allPwOk   = Object.values(pwOk).every(Boolean);
  const canSubmit = form.first_name.trim() && form.last_name.trim() &&
                    form.username.trim() && form.email.trim() && allPwOk && !loading;

  async function handleCreate() {
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const result = await rpc("setup_super_admin", {
        first_name: form.first_name.trim(),
        last_name:  form.last_name.trim(),
        username:   form.username.trim(),
        email:      form.email.trim(),
        password:   form.password,
      });
      setSuccess(result);
      setTimeout(() => onSuccess(form.username.trim()), 1700);
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to create account. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative h-full w-full overflow-auto bg-background">
      <style>{`
        @keyframes shimmer-admin {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%);  }
        }
      `}</style>

      <AmbientBlobs />

      <div className="relative z-10 mx-auto max-w-[560px] px-6 py-8">

        {/* ── Inline top row: logo + step badge ──────────────────────────── */}
        {!success && (
          <div
            className={cn(
              "flex items-center gap-3 mb-8 transition-all duration-500",
              mounted ? "opacity-100" : "opacity-0",
            )}
          >
            {/* Logo */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex h-6 w-6 items-center justify-center rounded-md bg-violet-600 shadow-sm shadow-violet-500/40">
                <span className="text-[11px] font-black leading-none text-white">Q</span>
                <div className="absolute inset-0 rounded-md bg-gradient-to-br from-white/20 to-transparent" />
              </div>
              <span className="text-[13px] font-bold text-foreground">Quantum POS</span>
            </div>

            <div className="flex-1" />

            {/* Step badge */}
            <div className="flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-violet-400">
              <ShieldCheck className="h-3 w-3" />
              Admin Setup · Step 2 of 2
            </div>
          </div>
        )}

        {/* ── Content ────────────────────────────────────────────────────── */}
        {success ? (
          <SuccessScreen username={success.username ?? form.username} />
        ) : (
          <div className="space-y-6">

            {/* Business context line */}
            {businessName && (
              <p
                className={cn(
                  "text-[12px] text-muted-foreground transition-all duration-500",
                  mounted ? "opacity-100" : "opacity-0",
                )}
              >
                Setting up owner account for{" "}
                <span className="font-semibold text-foreground">{businessName}</span>
              </p>
            )}

            {/* Form card */}
            <div
              className={cn(
                "rounded-2xl border border-violet-500/10 bg-card/40 p-6 space-y-5",
                "transition-all duration-500 ease-out hover:border-border/80",
                mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
              )}
              style={{ transitionDelay: "80ms" }}
            >
              {/* Name row */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="First Name" required>
                  <div className="relative group">
                    <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-violet-400/70 transition-colors" />
                    <Input
                      value={form.first_name}
                      onChange={set("first_name")}
                      placeholder="Emeka"
                      autoFocus
                      className="h-11 pl-9 text-sm bg-background/80 border-border/60 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                    />
                  </div>
                </Field>
                <Field label="Last Name" required>
                  <Input
                    value={form.last_name}
                    onChange={set("last_name")}
                    placeholder="Okafor"
                    className="h-11 text-sm bg-background/80 border-border/60 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                  />
                </Field>
              </div>

              {/* Username */}
              <Field label="Username" required>
                <div className="relative group">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-muted-foreground/40 group-focus-within:text-violet-400/70 transition-colors">@</span>
                  <Input
                    value={form.username}
                    onChange={set("username")}
                    placeholder="admin"
                    className="h-11 pl-8 text-sm bg-background/80 border-border/60 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                  />
                </div>
              </Field>

              {/* Email */}
              <Field label="Email" required>
                <div className="relative group">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-violet-400/70 transition-colors" />
                  <Input
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    placeholder="admin@yourbusiness.com"
                    className="h-11 pl-9 text-sm bg-background/80 border-border/60 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                  />
                </div>
              </Field>

              <div className="h-px bg-border/40" />

              {/* Password */}
              <Field label="Password" required>
                <div className="relative group">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-violet-400/70 transition-colors" />
                  <Input
                    type={showPw ? "text" : "password"}
                    value={form.password}
                    onChange={set("password")}
                    placeholder="Min. 8 characters"
                    className="h-11 pl-9 pr-11 text-sm bg-background/80 border-border/60 focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <PasswordStrengthBar password={form.password} />
              </Field>

              {/* Confirm */}
              <Field label="Confirm Password" required>
                <div className="relative group">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-violet-400/70 transition-colors" />
                  <Input
                    type={showCon ? "text" : "password"}
                    value={form.confirm}
                    onChange={set("confirm")}
                    placeholder="Repeat your password"
                    className={cn(
                      "h-11 pl-9 pr-11 text-sm bg-background/80 border-border/60",
                      "focus-visible:ring-violet-500/30 focus-visible:border-violet-500/40",
                      form.confirm && !pwOk.match && "border-destructive/50 focus-visible:ring-destructive/30",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCon((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showCon ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              {/* Password requirements */}
              {form.password && (
                <div className="rounded-xl border border-border/50 bg-muted/20 p-4 grid grid-cols-2 gap-2">
                  <Requirement met={pwOk.length} label="At least 8 characters" />
                  <Requirement met={pwOk.upper}  label="Uppercase letter"      />
                  <Requirement met={pwOk.lower}  label="Lowercase letter"      />
                  <Requirement met={pwOk.number} label="Number"                />
                  <Requirement met={pwOk.match}  label="Passwords match"       />
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Submit */}
            <div
              className={cn(
                "pb-8 transition-all duration-500 ease-out",
                mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
              )}
              style={{ transitionDelay: "200ms" }}
            >
              <button
                onClick={handleCreate}
                disabled={!canSubmit}
                className={cn(
                  "relative w-full flex items-center justify-center gap-2.5 rounded-xl h-12 text-sm font-bold overflow-hidden transition-all duration-200",
                  !canSubmit
                    ? "bg-violet-500/25 text-white/40 cursor-not-allowed"
                    : "bg-gradient-to-r from-violet-600 to-indigo-500 text-white shadow-lg shadow-violet-500/35 hover:shadow-violet-500/50 hover:scale-[1.01] active:scale-[0.99]",
                )}
              >
                {canSubmit && (
                  <div
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent"
                    style={{ animation: "shimmer-admin 2.8s ease-in-out infinite" }}
                  />
                )}
                {loading ? (
                  <><Loader2 className="relative h-4 w-4 animate-spin" /><span className="relative">Creating account…</span></>
                ) : (
                  <>
                    <ShieldCheck className="relative h-4 w-4" />
                    <span className="relative">Create Admin Account</span>
                    <ChevronRight className="relative h-4 w-4 ml-1 opacity-70" />
                  </>
                )}
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
