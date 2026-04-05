// ============================================================================
// pages/StoreCreationPage.jsx — Immersive new-branch creation experience
// ============================================================================
// Route: /store/new  (full-page, no AppShell)
// Access: super_admin, admin, gm only
//
// Flow:
//   1. Opened from StoreSwitcher "Add New Store" or Settings → Stores
//   2. Fills out multi-section form → hits "Launch Branch"
//   3. On success: new store set as active branch → auto-redirect to dashboard
// ============================================================================

import { useState, useEffect, useRef } from "react";
import { useNavigate }                 from "react-router-dom";
import {
  ArrowLeft, Building2, Check, ChevronRight, Clock,
  DollarSign, Globe, Loader2, Mail, MapPin, Percent,
  Phone, Sparkles, Store, X, Zap,
} from "lucide-react";

import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { cn }               from "@/lib/utils";
import { CURRENCIES, TIMEZONES } from "@/features/onboarding/constants";
import { useStores }        from "@/features/stores/useStores";
import { useBranchStore }   from "@/stores/branch.store";

// ─── constants ────────────────────────────────────────────────────────────────
const EMPTY = {
  store_name: "", address: "", city: "", state: "",
  country: "Nigeria", phone: "", email: "",
  currency: "NGN", timezone: "Africa/Lagos",
  tax_rate: "7.5", receipt_footer: "",
};

const FEATURES = [
  { text: "Independent inventory & stock tracking",  delay: 400 },
  { text: "Dedicated staff assignment per branch",   delay: 490 },
  { text: "Branch-level receipts & configuration",   delay: 580 },
  { text: "Isolated sales data & analytics",         delay: 670 },
];

const SECTIONS = [
  { id: "identity",   label: "Identity",      icon: Store,      color: "from-primary/20 to-primary/5" },
  { id: "contact",    label: "Contact",       icon: Phone,      color: "from-blue-500/20 to-blue-500/5" },
  { id: "config",     label: "Configuration", icon: DollarSign, color: "from-violet-500/20 to-violet-500/5" },
];

// ─── helpers ──────────────────────────────────────────────────────────────────
function Field({ label, required, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {label}
        {required && <span className="text-primary ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/50 leading-relaxed mt-1">{hint}</p>}
    </div>
  );
}

// ─── Animated floating particles ──────────────────────────────────────────────
function Particles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-primary/20 blur-sm"
          style={{
            width:  `${8 + i * 4}px`,
            height: `${8 + i * 4}px`,
            left:   `${10 + i * 14}%`,
            top:    `${20 + (i % 3) * 20}%`,
            animation: `float-particle ${4 + i * 0.8}s ease-in-out infinite`,
            animationDelay: `${i * 0.6}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Section step indicator ────────────────────────────────────────────────────
function SectionStep({ section, index, active, completed }) {
  const Icon = section.icon;
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn(
        "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-all duration-500",
        completed
          ? "border-primary bg-primary shadow-sm shadow-primary/40"
          : active
          ? "border-primary/60 bg-primary/15"
          : "border-border/50 bg-muted/20",
      )}>
        {completed ? (
          <Check className="h-3 w-3 text-white" strokeWidth={2.5} />
        ) : (
          <span className={cn(
            "text-[9px] font-bold tabular-nums",
            active ? "text-primary" : "text-muted-foreground/40",
          )}>
            {index + 1}
          </span>
        )}
        {active && !completed && (
          <div className="absolute inset-0 rounded-full border border-primary/40 animate-ping opacity-60" />
        )}
      </div>
      <span className={cn(
        "text-[11px] font-semibold hidden sm:block transition-colors duration-300",
        active || completed ? "text-foreground" : "text-muted-foreground/40",
      )}>
        {section.label}
      </span>
    </div>
  );
}

// ─── Section connector ─────────────────────────────────────────────────────────
function SectionConnector({ completed }) {
  return (
    <div className="hidden sm:block h-px w-6 bg-border/40 relative overflow-hidden shrink-0">
      <div className={cn(
        "absolute inset-y-0 left-0 bg-primary/60 transition-all duration-700",
        completed ? "w-full" : "w-0",
      )} />
    </div>
  );
}

// ─── Left decorative panel ────────────────────────────────────────────────────
function BrandPanel({ mounted }) {
  return (
    <div
      className={cn(
        "relative hidden xl:flex w-[400px] shrink-0 flex-col overflow-hidden",
        "transition-all duration-700 ease-out",
        mounted ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-12",
      )}
    >
      {/* Multi-layer gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.18] via-primary/[0.07] to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_20%_10%,_hsl(var(--primary)/0.15),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_80%_90%,_hsl(var(--primary)/0.08),transparent)]" />

      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(var(--primary) 1px, transparent 1px),
            linear-gradient(90deg, var(--primary) 1px, transparent 1px)
          `,
          backgroundSize: "28px 28px",
        }}
      />

      {/* Floating particles */}
      <Particles />

      {/* Right separator */}
      <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border/50 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full p-10 gap-10">

        {/* Logo */}
        <div
          className={cn(
            "flex items-center gap-3 transition-all duration-700",
            mounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4",
          )}
          style={{ transitionDelay: "100ms" }}
        >
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-xl shadow-primary/40">
            <span className="select-none text-[15px] font-black leading-none text-white">Q</span>
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/20 to-transparent" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-foreground leading-none tracking-tight">Quantum POS</p>
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">Point of Sale System</p>
          </div>
        </div>

        {/* Hero area */}
        <div className="flex flex-col items-center flex-1 justify-center gap-8">

          {/* Animated store icon */}
          <div
            className={cn(
              "relative flex items-center justify-center transition-all duration-700",
              mounted ? "opacity-100 scale-100" : "opacity-0 scale-75",
            )}
            style={{ transitionDelay: "200ms" }}
          >
            {/* Layered rings */}
            <div className="absolute h-48 w-48 rounded-full border border-primary/[0.08] animate-[spin_30s_linear_infinite]" />
            <div className="absolute h-40 w-40 rounded-full border border-primary/[0.12]"
              style={{ animation: "spin 20s linear infinite reverse" }} />
            <div className="absolute h-32 w-32 rounded-full border border-dashed border-primary/[0.15]"
              style={{ animation: "spin 12s linear infinite" }} />

            {/* Glow */}
            <div className="absolute h-32 w-32 rounded-full bg-primary/[0.12] blur-2xl" />

            {/* Icon container */}
            <div className="relative flex h-28 w-28 items-center justify-center rounded-[32px] border border-primary/20 bg-card/70 backdrop-blur-sm shadow-2xl shadow-primary/[0.15]">
              <div className="absolute inset-0 rounded-[32px] bg-gradient-to-br from-primary/10 to-transparent" />
              <Building2 className="relative h-12 w-12 text-primary" strokeWidth={1.2} />

              {/* Corner accents */}
              <div className="absolute top-2 left-2 h-4 w-4 rounded-tl-[10px] border-t border-l border-primary/30" />
              <div className="absolute top-2 right-2 h-4 w-4 rounded-tr-[10px] border-t border-r border-primary/30" />
              <div className="absolute bottom-2 left-2 h-4 w-4 rounded-bl-[10px] border-b border-l border-primary/30" />
              <div className="absolute bottom-2 right-2 h-4 w-4 rounded-br-[10px] border-b border-r border-primary/30" />
            </div>
          </div>

          {/* Heading */}
          <div
            className={cn(
              "text-center space-y-3 transition-all duration-700",
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
            )}
            style={{ transitionDelay: "300ms" }}
          >
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              <Zap className="h-2.5 w-2.5" />
              New Branch
            </div>
            <h2 className="text-[26px] font-bold text-foreground leading-tight tracking-tight">
              Launch a new<br />
              <span className="text-primary relative">
                branch location
                <div className="absolute -bottom-1 left-0 right-0 h-px bg-gradient-to-r from-primary/60 via-primary/40 to-transparent" />
              </span>
            </h2>
            <p className="text-[12.5px] text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
              Configure your store details and start selling from this location immediately.
            </p>
          </div>

          {/* Feature list */}
          <div className="w-full max-w-[280px] space-y-3">
            {FEATURES.map((feat, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-3 transition-all duration-500 ease-out",
                  mounted ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-6",
                )}
                style={{ transitionDelay: `${feat.delay}ms` }}
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 border border-primary/25">
                  <Check className="h-2.5 w-2.5 text-primary" strokeWidth={3} />
                </div>
                <span className="text-[12px] text-muted-foreground leading-snug">{feat.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom note */}
        <p
          className={cn(
            "text-[10px] text-muted-foreground/30 text-center leading-relaxed transition-all duration-700",
            mounted ? "opacity-100" : "opacity-0",
          )}
          style={{ transitionDelay: "800ms" }}
        >
          The new store becomes your active branch<br />immediately after creation.
        </p>
      </div>
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ number, label, icon: Icon }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
          Step {number}
        </p>
        <h3 className="text-[14px] font-bold text-foreground leading-tight">{label}</h3>
      </div>
      <div className="flex-1 h-px bg-gradient-to-r from-border/60 to-transparent ml-2" />
    </div>
  );
}

// ─── Success screen ────────────────────────────────────────────────────────────
function SuccessScreen({ storeName }) {
  const [progress, setProgress] = useState(0);
  const [countDown, setCountDown] = useState(3);

  useEffect(() => {
    const duration = 3000;
    const start = Date.now();
    const rafLoop = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / duration) * 100);
      setProgress(pct);
      setCountDown(Math.max(1, Math.ceil((duration - elapsed) / 1000)));
      if (pct < 100) requestAnimationFrame(rafLoop);
    };
    requestAnimationFrame(rafLoop);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-10 py-16 px-8 animate-in fade-in zoom-in-95 duration-500">
      {/* Success ring */}
      <div className="relative flex items-center justify-center">
        {/* Outer pings */}
        <div className="absolute h-36 w-36 rounded-full bg-primary/[0.07] animate-ping" style={{ animationDuration: "2s" }} />
        <div className="absolute h-28 w-28 rounded-full bg-primary/[0.1]" />
        {/* Ring */}
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-primary bg-primary/10 shadow-2xl shadow-primary/30">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-transparent" />
          <Check className="relative h-11 w-11 text-primary" strokeWidth={2.5} />
        </div>
      </div>

      {/* Text */}
      <div className="text-center space-y-3 max-w-xs">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-[11px] font-bold text-primary">
          <Sparkles className="h-3 w-3" />
          Branch Created Successfully
        </div>
        <h3 className="text-3xl font-bold text-foreground tracking-tight">
          {storeName}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your new branch is live and set as your active store. Redirecting to dashboard in {countDown}s…
        </p>
      </div>

      {/* Progress */}
      <div className="w-56 space-y-2">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-100 ease-linear shadow-sm shadow-primary/40"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
          <span>Preparing dashboard…</span>
          <span className="tabular-nums">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function StoreCreationPage() {
  const navigate       = useNavigate();
  const { create }     = useStores();
  const setActiveStore = useBranchStore((s) => s.setActiveStore);
  const needsStoreCreation = useBranchStore((s) => s.needsStoreCreation);
  // First-time flow: user must create a store, so hide back/cancel navigation.

  const [form,          setForm]          = useState(EMPTY);
  const [success,       setSuccess]       = useState(null);
  const [mounted,       setMounted]       = useState(false);
  const [activeSection, setActiveSection] = useState(0);

  // Track which sections have been focused (for step completion)
  const [touched, setTouched] = useState({ 0: true, 1: false, 2: false });

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: typeof e === "string" ? e : e.target.value }));

  const touchSection = (idx) => {
    setActiveSection(idx);
    setTouched((prev) => ({ ...prev, [idx]: true }));
  };

  const handleCreate = async () => {
    if (!form.store_name.trim()) return;
    const payload = {
      store_name:     form.store_name.trim(),
      address:        form.address.trim()        || null,
      city:           form.city.trim()           || null,
      state:          form.state.trim()          || null,
      country:        form.country               || "Nigeria",
      phone:          form.phone.trim()          || null,
      email:          form.email.trim()          || null,
      currency:       form.currency              || "NGN",
      timezone:       form.timezone              || "Africa/Lagos",
      tax_rate:       form.tax_rate !== ""       ? parseFloat(form.tax_rate) : null,
      receipt_footer: form.receipt_footer.trim() || null,
    };

    try {
      const newStore = await create.mutateAsync(payload);
      if (newStore?.id) {
        setActiveStore(newStore);
        setSuccess(newStore);
        setTimeout(() => navigate("/analytics", { replace: true }), 3100);
      }
    } catch {
      /* error toast handled by mutation onError */
    }
  };

  const isSubmitDisabled = create.isPending || !form.store_name.trim();

  // Section completion hints (visual only)
  const sectionDone = {
    0: form.store_name.trim().length > 0,
    1: form.phone.trim().length > 0 || form.email.trim().length > 0,
    2: true, // always has defaults
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">

      {/* Keyframes injected via style tag */}
      <style>{`
        @keyframes float-particle {
          0%, 100% { transform: translateY(0px) scale(1); opacity: 0.4; }
          50%       { transform: translateY(-18px) scale(1.2); opacity: 0.15; }
        }
        @keyframes shimmer-slide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>

      {/* ── Left brand panel ──────────────────────────────────────────── */}
      <BrandPanel mounted={mounted} />

      {/* ── Right form area ───────────────────────────────────────────── */}
      <div
        className={cn(
          "flex flex-1 flex-col min-w-0 overflow-hidden",
          "transition-all duration-700 ease-out",
          mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
        )}
      >
        {/* ── Top bar ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-6 py-3.5 border-b border-border bg-card/60 backdrop-blur-sm shrink-0">
          <button
            onClick={() => navigate(-1)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-1.5",
              "text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40",
              "transition-all duration-150 shrink-0",
            )}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>

          <div className="h-4 w-px bg-border/60 shrink-0" />

          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-foreground leading-none">Create New Store</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Add a new branch to your network</p>
          </div>

          {/* Step progress — right aligned */}
          {!success && (
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              {SECTIONS.map((section, i) => (
                <div key={section.id} className="flex items-center gap-2">
                  {i > 0 && <SectionConnector completed={sectionDone[i - 1]} />}
                  <SectionStep
                    section={section}
                    index={i}
                    active={activeSection === i}
                    completed={sectionDone[i] && touched[i] && activeSection > i}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Scrollable form body ───────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-[700px] mx-auto px-6 py-8">

            {success ? (
              <SuccessScreen storeName={success.store_name} />
            ) : (
              <div className="space-y-10">

                {/* ════════════════════════════
                    Section 1 — Store Identity
                    ════════════════════════════ */}
                <div
                  className={cn(
                    "rounded-2xl border border-border/60 bg-card/40 p-6",
                    "transition-all duration-500 ease-out",
                    "hover:border-border/80 hover:bg-card/60",
                    mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                    activeSection === 0 && "border-primary/20 bg-primary/[0.02] shadow-sm shadow-primary/5",
                  )}
                  style={{ transitionDelay: "80ms" }}
                  onFocus={() => touchSection(0)}
                  onClick={() => touchSection(0)}
                >
                  <SectionHeader number="1" label="Store Identity" icon={Store} />

                  <div className="space-y-4">
                    <Field label="Store Name" required>
                      <div className="relative group">
                        <Store className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 transition-colors group-focus-within:text-primary/60" />
                        <Input
                          value={form.store_name}
                          onChange={set("store_name")}
                          placeholder="e.g. Ikeja Branch"
                          autoFocus
                          className="h-11 pl-10 text-sm bg-background/80 border-border/60 focus:border-primary/50 focus:ring-primary/20 transition-all"
                        />
                      </div>
                    </Field>

                    <div className="grid grid-cols-2 gap-4">
                      <Field label="City">
                        <div className="relative group">
                          <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-focus-within:text-primary/60" />
                          <Input value={form.city} onChange={set("city")} placeholder="Lagos" className="h-11 pl-9 text-sm bg-background/80" />
                        </div>
                      </Field>
                      <Field label="State">
                        <Input value={form.state} onChange={set("state")} placeholder="Lagos State" className="h-11 text-sm bg-background/80" />
                      </Field>
                    </div>

                    <Field label="Address">
                      <Input
                        value={form.address}
                        onChange={set("address")}
                        placeholder="123 Broad Street, Ikeja"
                        className="h-11 text-sm bg-background/80"
                      />
                    </Field>

                    <Field label="Country">
                      <div className="relative group">
                        <Globe className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-focus-within:text-primary/60" />
                        <Input value={form.country} onChange={set("country")} className="h-11 pl-9 text-sm bg-background/80" />
                      </div>
                    </Field>
                  </div>
                </div>

                {/* ════════════════════════════
                    Section 2 — Contact Details
                    ════════════════════════════ */}
                <div
                  className={cn(
                    "rounded-2xl border border-border/60 bg-card/40 p-6",
                    "transition-all duration-500 ease-out",
                    "hover:border-border/80 hover:bg-card/60",
                    mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                    activeSection === 1 && "border-blue-500/20 bg-blue-500/[0.02] shadow-sm shadow-blue-500/5",
                  )}
                  style={{ transitionDelay: "160ms" }}
                  onFocus={() => touchSection(1)}
                  onClick={() => touchSection(1)}
                >
                  <SectionHeader number="2" label="Contact Details" icon={Phone} />

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Phone">
                      <div className="relative group">
                        <Phone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-focus-within:text-primary/60" />
                        <Input
                          value={form.phone}
                          onChange={set("phone")}
                          placeholder="+234 800 000 0000"
                          className="h-11 pl-9 text-sm bg-background/80"
                        />
                      </div>
                    </Field>
                    <Field label="Email">
                      <div className="relative group">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-focus-within:text-primary/60" />
                        <Input
                          type="email"
                          value={form.email}
                          onChange={set("email")}
                          placeholder="store@example.com"
                          className="h-11 pl-9 text-sm bg-background/80"
                        />
                      </div>
                    </Field>
                  </div>
                </div>

                {/* ════════════════════════════
                    Section 3 — Configuration
                    ════════════════════════════ */}
                <div
                  className={cn(
                    "rounded-2xl border border-border/60 bg-card/40 p-6",
                    "transition-all duration-500 ease-out",
                    "hover:border-border/80 hover:bg-card/60",
                    mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                    activeSection === 2 && "border-violet-500/20 bg-violet-500/[0.02] shadow-sm shadow-violet-500/5",
                  )}
                  style={{ transitionDelay: "240ms" }}
                  onFocus={() => touchSection(2)}
                  onClick={() => touchSection(2)}
                >
                  <SectionHeader number="3" label="Store Configuration" icon={DollarSign} />

                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Currency">
                        <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                          <SelectTrigger className="h-11 text-sm bg-background/80">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CURRENCIES.map((c) => (
                              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>

                      <Field label="Tax Rate (%)">
                        <div className="relative group">
                          <Percent className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-focus-within:text-primary/60" />
                          <Input
                            type="number" min="0" max="100" step="0.01"
                            value={form.tax_rate} onChange={set("tax_rate")}
                            placeholder="7.5"
                            className="h-11 pl-9 text-sm bg-background/80"
                          />
                        </div>
                      </Field>

                      <Field label="Timezone">
                        <Select value={form.timezone} onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}>
                          <SelectTrigger className="h-11 text-sm bg-background/80">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Clock className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                              <SelectValue />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {TIMEZONES.map((tz) => (
                              <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>

                    <Field
                      label="Receipt Footer"
                      hint="Optional message printed at the bottom of every customer receipt"
                    >
                      <textarea
                        value={form.receipt_footer}
                        onChange={set("receipt_footer")}
                        placeholder="Thank you for shopping with us! Visit us again."
                        rows={2}
                        className={cn(
                          "w-full rounded-lg border border-input bg-background/80 px-3 py-2.5 text-sm resize-none",
                          "placeholder:text-muted-foreground/40",
                          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                          "transition-all duration-150",
                        )}
                      />
                    </Field>
                  </div>
                </div>

                {/* ── Action bar ─────────────────────────────────────── */}
                <div
                  className={cn(
                    "flex items-center gap-3 pb-8",
                    "transition-all duration-500 ease-out",
                    mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
                  )}
                  style={{ transitionDelay: "340ms" }}
                >
                  <button
                    onClick={() => navigate(-1)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-5 h-12",
                      "text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40",
                      "transition-all duration-150",
                    )}
                  >
                    Cancel
                  </button>

                  <button
                    onClick={handleCreate}
                    disabled={isSubmitDisabled}
                    className={cn(
                      "relative flex-1 flex items-center justify-center gap-2.5 rounded-xl h-12",
                      "text-sm font-bold text-primary-foreground overflow-hidden",
                      "transition-all duration-200",
                      isSubmitDisabled
                        ? "bg-primary/40 cursor-not-allowed"
                        : "bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30 hover:shadow-primary/40 hover:scale-[1.01] active:scale-[0.99]",
                    )}
                  >
                    {/* Shimmer effect when enabled */}
                    {!isSubmitDisabled && (
                      <div
                        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent"
                        style={{ animation: "shimmer-slide 2.5s ease-in-out infinite" }}
                      />
                    )}

                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/[0.06] pointer-events-none" />

                    {create.isPending ? (
                      <>
                        <Loader2 className="relative h-4 w-4 animate-spin" />
                        <span className="relative">Creating branch…</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="relative h-4 w-4" />
                        <span className="relative">Launch Branch</span>
                        <ChevronRight className="relative h-4 w-4 ml-1 opacity-70" />
                      </>
                    )}
                  </button>
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
