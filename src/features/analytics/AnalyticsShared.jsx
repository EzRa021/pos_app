// features/analytics/AnalyticsShared.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives used by every analytics page.
// Import from here — never duplicate these in individual pages.
// ─────────────────────────────────────────────────────────────────────────────
import { AlertTriangle, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { EmptyState } from "@/components/shared/EmptyState";

// ── TopN selector ─────────────────────────────────────────────────────────────
export const TOPN_OPTIONS = [
  { value: 3,    label: "Top 3"  },
  { value: 5,    label: "Top 5"  },
  { value: 10,   label: "Top 10" },
  { value: 15,   label: "Top 15" },
  { value: 20,   label: "Top 20" },
  { value: 9999, label: "All"    },
];

export function TopNSelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5 border border-border/50">
      {TOPN_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-2 py-1 rounded-md text-[10px] font-semibold transition-all whitespace-nowrap",
            value === opt.value
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Period selector ───────────────────────────────────────────────────────────
export function PeriodSelector({ value, onChange }) {
  const opts = [
    { v: "day",   l: "Daily"   },
    { v: "week",  l: "Weekly"  },
    { v: "month", l: "Monthly" },
  ];
  return (
    <div className="flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5 border border-border/50">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all",
            value === o.v
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
export function CardShell({ label, value, sub, icon: Icon, trend, trendValue, accent = "default" }) {
  const accents = {
    default:     { bg: "bg-card border-border/60",               val: "text-foreground",   icon: "text-muted-foreground" },
    primary:     { bg: "bg-primary/5 border-primary/20",         val: "text-primary",      icon: "text-primary/60"       },
    success:     { bg: "bg-success/5 border-success/20",         val: "text-success",      icon: "text-success/60"       },
    warning:     { bg: "bg-warning/5 border-warning/20",         val: "text-warning",      icon: "text-warning/60"       },
    destructive: { bg: "bg-destructive/5 border-destructive/20", val: "text-destructive",  icon: "text-destructive/60"   },
  };
  const a = accents[accent] ?? accents.default;
  const trendUp   = parseFloat(trendValue ?? 0) >= 0;
  const TrendIcon = trendUp ? ArrowUpRight : ArrowDownRight;

  return (
    <div className={cn("rounded-xl border px-4 py-3.5 flex flex-col gap-2", a.bg)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground leading-none">
          {label}
        </span>
        {Icon && <Icon className={cn("h-3.5 w-3.5", a.icon)} />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className={cn("text-xl font-bold tabular-nums leading-none", a.val)}>{value}</p>
        {trend !== undefined && (
          <span className={cn(
            "flex items-center gap-0.5 text-[10px] font-bold tabular-nums mb-0.5",
            trendUp ? "text-success" : "text-destructive",
          )}>
            <TrendIcon className="h-3 w-3" />
            {Math.abs(parseFloat(trendValue ?? 0)).toFixed(1)}%
          </span>
        )}
      </div>
      {sub && <p className="text-[11px] text-muted-foreground leading-none">{sub}</p>}
    </div>
  );
}

// ── Chart wrapper card ────────────────────────────────────────────────────────
export function ChartCard({ title, loading, error, children, action, minH = "h-48", className }) {
  return (
    <div className={cn("rounded-xl border border-border/60 bg-background/40 overflow-hidden", className)}>
      {title && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {title}
          </span>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-4">
        {error   ? <ErrorCard />      :
         loading ? <SkeletonBlock h={minH} /> :
         children}
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
export function SkeletonBlock({ h = "h-48" }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted/30 w-full", h)} />;
}

// ── Error card ────────────────────────────────────────────────────────────────
export function ErrorCard({ message }) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 flex items-center gap-2 text-[11px] text-destructive">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {message ?? "Failed to load data. Try refreshing."}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
export function SectionHeader({ icon: Icon, title, description, children }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-foreground tracking-tight">{title}</h1>
          {description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed max-w-xl">
              {description}
            </p>
          )}
        </div>
      </div>
      {children && <div className="shrink-0 ml-4">{children}</div>}
    </div>
  );
}

// ── Payment method meta ───────────────────────────────────────────────────────
import { Banknote, ArrowLeftRight, Clock, Wallet, CreditCard } from "lucide-react";

export const PAYMENT_META = {
  cash:          { label: "Cash",          icon: Banknote,       color: "var(--chart-1)" },
  card:          { label: "POS / Card",    icon: CreditCard,     color: "var(--chart-2)" },
  transfer:      { label: "Bank Transfer", icon: ArrowLeftRight, color: "var(--chart-3)" },
  bank_transfer: { label: "Bank Transfer", icon: ArrowLeftRight, color: "var(--chart-3)" },
  credit:        { label: "Credit Sale",   icon: Clock,          color: "var(--chart-4)" },
  wallet:        { label: "Store Wallet",  icon: Wallet,         color: "var(--chart-5)" },
};

export function getPaymentMeta(method) {
  const key = (method ?? "").toLowerCase().replace(/\s/g, "_");
  return PAYMENT_META[key] ?? { label: method ?? "Other", icon: CreditCard, color: "var(--chart-6)" };
}

// ── Custom recharts tooltip ───────────────────────────────────────────────────
export function CurrencyFmtTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl text-[11px] min-w-[140px]">
      <p className="text-muted-foreground mb-1.5 font-semibold">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground flex-1">{p.name}:</span>
          <span className="font-bold text-foreground tabular-nums">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function CountFmtTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl text-[11px]">
      <p className="text-muted-foreground mb-1 font-semibold">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-bold text-foreground tabular-nums">{Number(p.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
