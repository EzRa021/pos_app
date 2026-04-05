// ============================================================================
// pages/BusinessCreationPage.jsx — Immersive first-time business setup
// ============================================================================
// Used inside OnboardingFlow (before Router is active), so NO useNavigate.
// All navigation is prop-driven: onSuccess(name, id) | onBack()
// ============================================================================

import { useState, useEffect } from "react";
import {
  ArrowLeft, Briefcase, Check, ChevronRight,
  Loader2, Mail, Phone, Settings2, Sparkles, Tag, MapPin,
} from "lucide-react";

import { Input }  from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { cn }                                   from "@/lib/utils";
import { BUSINESS_TYPES, CURRENCIES, TIMEZONES } from "@/features/onboarding/constants";
import { rpc }                                  from "@/lib/apiClient";

const SECTIONS = [
  { id: "identity", label: "Business Info", icon: Briefcase },
  { id: "settings", label: "Settings",      icon: Settings2 },
];

const EMPTY = {
  name:          "",
  business_type: "retail",
  address:       "",
  email:         "",
  phone:         "",
  currency:      "NGN",
  timezone:      "Africa/Lagos",
};

// ─── helpers ──────────────────────────────────────────────────────────────────
function Field({ label, required, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
        {required && <span className="text-amber-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/40 leading-relaxed mt-1">{hint}</p>}
    </div>
  );
}

// ─── Ambient background ───────────────────────────────────────────────────────
function AmbientBlobs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full opacity-[0.07]"
        style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 70%)" }}
      />
      <div
        className="absolute -bottom-60 -left-20 h-[400px] w-[400px] rounded-full opacity-[0.05]"
        style={{ background: "radial-gradient(circle, #fbbf24 0%, transparent 70%)" }}
      />
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `
            linear-gradient(#f59e0b 1px, transparent 1px),
            linear-gradient(90deg, #f59e0b 1px, transparent 1px)
          `,
          backgroundSize: "32px 32px",
        }}
      />
    </div>
  );
}

// ─── Step dots (now inline in the content) ────────────────────────────────────
function StepDot({ label, index, active, done }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn(
        "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all duration-500",
        done  ? "border-amber-500 bg-amber-500"
              : active ? "border-amber-500/60 bg-amber-500/15"
              : "border-border/50 bg-muted/20",
      )}>
        {done ? (
          <Check className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
        ) : (
          <span className={cn(
            "text-[9px] font-bold tabular-nums",
            active ? "text-amber-400" : "text-muted-foreground/40",
          )}>{index + 1}</span>
        )}
      </div>
      <span className={cn(
        "text-[11px] font-medium transition-colors duration-300",
        active || done ? "text-foreground" : "text-muted-foreground/40",
      )}>{label}</span>
    </div>
  );
}

function StepLine({ done }) {
  return (
    <div className="h-px w-5 bg-border/40 relative overflow-hidden shrink-0">
      <div className={cn(
        "absolute inset-y-0 left-0 bg-amber-500/60 transition-all duration-700",
        done ? "w-full" : "w-0",
      )} />
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ number, label, icon: Icon }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
        <Icon className="h-4 w-4 text-amber-400" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Step {number}</p>
        <h3 className="text-[13px] font-bold text-foreground leading-tight">{label}</h3>
      </div>
      <div className="flex-1 h-px bg-gradient-to-r from-amber-500/20 to-transparent ml-1" />
    </div>
  );
}

// ─── Success screen ────────────────────────────────────────────────────────────
function SuccessScreen({ name }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const duration = 1400;
    const raf = () => {
      const p = Math.min(100, ((Date.now() - start) / duration) * 100);
      setProgress(p);
      if (p < 100) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-8 py-16 animate-in fade-in zoom-in-95 duration-500">
      <div className="relative flex items-center justify-center">
        <div className="absolute h-32 w-32 rounded-full bg-amber-500/[0.07] animate-ping" style={{ animationDuration: "2s" }} />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500/10 shadow-2xl shadow-amber-500/25">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-500/20 to-transparent" />
          <Check className="relative h-9 w-9 text-amber-400" strokeWidth={2.5} />
        </div>
      </div>
      <div className="text-center space-y-2 max-w-xs">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-[11px] font-bold text-amber-400">
          <Sparkles className="h-3 w-3" />
          Business Created
        </div>
        <h3 className="text-2xl font-bold text-foreground">{name}</h3>
        <p className="text-sm text-muted-foreground">Moving to account setup…</p>
      </div>
      <div className="w-48">
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-75 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function BusinessCreationPage({ onSuccess, onBack }) {
  const [form,          setForm]          = useState(EMPTY);
  const [activeSection, setActiveSection] = useState(0);
  const [touched,       setTouched]       = useState({ 0: true, 1: false });
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [success,       setSuccess]       = useState(null);
  const [mounted,       setMounted]       = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: typeof e === "string" ? e : e.target.value }));

  const touchSection = (i) => {
    setActiveSection(i);
    setTouched((p) => ({ ...p, [i]: true }));
  };

  const sectionDone = {
    0: form.name.trim().length > 0,
    1: true,
  };

  async function handleCreate() {
    const name = form.name.trim();
    if (!name) { setError("Business name is required."); return; }
    setLoading(true);
    setError("");
    try {
      const result = await rpc("create_business", {
        name,
        business_type: form.business_type,
        address:       form.address.trim()  || null,
        email:         form.email.trim()    || null,
        phone:         form.phone.trim()    || null,
        currency:      form.currency        || "NGN",
        timezone:      form.timezone        || "Africa/Lagos",
      });
      setSuccess(result);
      setTimeout(() => onSuccess(result.name, result.id), 1500);
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to create business. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const isDisabled = loading || !form.name.trim();

  return (
    <div className="relative h-full w-full overflow-auto bg-background">
      <style>{`
        @keyframes shimmer-biz {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%);  }
        }
      `}</style>

      <AmbientBlobs />

      <div className="relative z-10 mx-auto max-w-[660px] px-6 py-8">

        {/* ── Inline top row: back + logo + steps ────────────────────────── */}
        {!success && (
          <div
            className={cn(
              "flex items-center gap-3 mb-8 transition-all duration-500",
              mounted ? "opacity-100" : "opacity-0",
            )}
          >
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all duration-150 shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>

            <div className="h-4 w-px bg-border/50 shrink-0" />

            {/* Logo */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex h-6 w-6 items-center justify-center rounded-md bg-amber-500 shadow-sm shadow-amber-500/40">
                <span className="text-[11px] font-black leading-none text-white">Q</span>
                <div className="absolute inset-0 rounded-md bg-gradient-to-br from-white/20 to-transparent" />
              </div>
              <span className="text-[13px] font-bold text-foreground leading-none">Quantum POS</span>
            </div>

            <div className="flex-1" />

            {/* Step progress */}
            <div className="flex items-center gap-2 shrink-0">
              {SECTIONS.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  {i > 0 && <StepLine done={sectionDone[0] && touched[0]} />}
                  <StepDot
                    label={s.label}
                    index={i}
                    active={activeSection === i}
                    done={sectionDone[i] && touched[i] && activeSection > i}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Content ────────────────────────────────────────────────────── */}
        {success ? (
          <SuccessScreen name={success.name} />
        ) : (
          <div className="space-y-6">

            {/* Section 1 */}
            <div
              className={cn(
                "rounded-2xl border border-border/60 bg-card/40 p-6",
                "transition-all duration-500 ease-out hover:border-border/80 hover:bg-card/55",
                mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                activeSection === 0 && "border-amber-500/20 bg-amber-500/[0.02] shadow-sm shadow-amber-500/5",
              )}
              style={{ transitionDelay: "80ms" }}
              onFocus={() => touchSection(0)}
              onClick={() => touchSection(0)}
            >
              <SectionHeader number="1" label="Business Identity" icon={Briefcase} />
              <div className="space-y-4">
                <Field label="Business Name" required>
                  <div className="relative group">
                    <Tag className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-amber-400/70 transition-colors" />
                    <Input
                      value={form.name}
                      onChange={set("name")}
                      placeholder="e.g. Chidi's Superstore"
                      autoFocus
                      className="h-11 pl-10 text-sm bg-background/80 border-border/60 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/50 transition-all"
                    />
                  </div>
                </Field>

                <Field label="Business Type">
                  <Select value={form.business_type} onValueChange={(v) => setForm((f) => ({ ...f, business_type: v }))}>
                    <SelectTrigger className="h-11 text-sm bg-background/80 border-border/60 focus:ring-amber-500/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUSINESS_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Address" hint="Physical location of your primary office or store">
                  <div className="relative group">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-amber-400/70 transition-colors" />
                    <Input
                      value={form.address}
                      onChange={set("address")}
                      placeholder="123 Broad Street, Lagos Island"
                      className="h-11 pl-9 text-sm bg-background/80 border-border/60 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/50"
                    />
                  </div>
                </Field>
              </div>
            </div>

            {/* Section 2 */}
            <div
              className={cn(
                "rounded-2xl border border-border/60 bg-card/40 p-6",
                "transition-all duration-500 ease-out hover:border-border/80 hover:bg-card/55",
                mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                activeSection === 1 && "border-amber-500/20 bg-amber-500/[0.02] shadow-sm shadow-amber-500/5",
              )}
              style={{ transitionDelay: "160ms" }}
              onFocus={() => touchSection(1)}
              onClick={() => touchSection(1)}
            >
              <SectionHeader number="2" label="Settings & Contact" icon={Settings2} />
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Currency">
                    <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                      <SelectTrigger className="h-11 text-sm bg-background/80 border-border/60 focus:ring-amber-500/30">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Timezone">
                    <Select value={form.timezone} onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}>
                      <SelectTrigger className="h-11 text-sm bg-background/80 border-border/60 focus:ring-amber-500/30">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Email">
                    <div className="relative group">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-amber-400/70 transition-colors" />
                      <Input
                        type="email"
                        value={form.email}
                        onChange={set("email")}
                        placeholder="biz@example.com"
                        className="h-11 pl-9 text-sm bg-background/80 border-border/60 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/50"
                      />
                    </div>
                  </Field>

                  <Field label="Phone">
                    <div className="relative group">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-amber-400/70 transition-colors" />
                      <Input
                        type="tel"
                        value={form.phone}
                        onChange={set("phone")}
                        placeholder="+234 800 000 0000"
                        className="h-11 pl-9 text-sm bg-background/80 border-border/60 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/50"
                      />
                    </div>
                  </Field>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* CTA */}
            <div
              className={cn(
                "flex items-center gap-3 pb-8 transition-all duration-500 ease-out",
                mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
              )}
              style={{ transitionDelay: "240ms" }}
            >
              <button
                onClick={onBack}
                className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-5 h-12 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all duration-150"
              >
                Cancel
              </button>

              <button
                onClick={handleCreate}
                disabled={isDisabled}
                className={cn(
                  "relative flex-1 flex items-center justify-center gap-2.5 rounded-xl h-12 text-sm font-bold overflow-hidden transition-all duration-200",
                  isDisabled
                    ? "bg-amber-500/30 text-white/40 cursor-not-allowed"
                    : "bg-gradient-to-r from-amber-500 to-amber-400 text-white shadow-lg shadow-amber-500/35 hover:shadow-amber-500/50 hover:scale-[1.01] active:scale-[0.99]",
                )}
              >
                {!isDisabled && (
                  <div
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent"
                    style={{ animation: "shimmer-biz 2.8s ease-in-out infinite" }}
                  />
                )}
                {loading ? (
                  <><Loader2 className="relative h-4 w-4 animate-spin" /><span className="relative">Creating…</span></>
                ) : (
                  <>
                    <Briefcase className="relative h-4 w-4" />
                    <span className="relative">Create Business</span>
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
