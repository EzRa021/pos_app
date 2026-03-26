// pages/SalesAnalyticsPage.jsx — Dedicated Sales Analytics page at /analytics/sales
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  TrendingUp, TrendingDown, ArrowLeft, ShoppingCart,
  DollarSign, BarChart3, CreditCard,
} from "lucide-react";
import {
  ComposedChart, Area, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";

import { PageHeader }       from "@/components/shared/PageHeader";
import { DateRangePicker }  from "@/components/shared/DateRangePicker";
import { DataTable }        from "@/components/shared/DataTable";
import { EmptyState }       from "@/components/shared/EmptyState";
import { Button }           from "@/components/ui/button";
import { cn }               from "@/lib/utils";
import {
  useSalesSummary, useRevenueByPeriod, usePaymentMethodSummary,
  usePeakHoursAnalysis, useComparisonReport,
} from "@/features/analytics/useAnalytics";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { ChartContainer, ChartTooltip, CurrencyTooltipContent, CHART_COLORS } from "@/components/ui/chart";

const REVENUE_CHART_CONFIG = {
  gross: { label: "Revenue",      color: "var(--chart-1)" },
  txns:  { label: "Transactions", color: "var(--chart-3)" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, description, action, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-muted/20 flex items-center justify-between">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
          {description && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function KPICard({ label, value, sub, trend, icon: Icon, accent = "default" }) {
  const ring = {
    default:     "border-border/60 bg-card",
    primary:     "border-primary/25 bg-primary/[0.06]",
    success:     "border-success/25 bg-success/[0.06]",
    warning:     "border-warning/25 bg-warning/[0.06]",
    destructive: "border-destructive/25 bg-destructive/[0.06]",
  }[accent] ?? "border-border/60 bg-card";
  const val = {
    default: "text-foreground", primary: "text-primary",
    success: "text-success",   warning: "text-warning", destructive: "text-destructive",
  }[accent] ?? "text-foreground";

  const isUp   = typeof trend === "number" && trend > 0;
  const isDown = typeof trend === "number" && trend < 0;

  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-4", ring)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn("h-4 w-4 opacity-25", val)} />}
      </div>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      <div className="flex items-center gap-1.5">
        {trend != null && (
          <>
            {isUp   && <TrendingUp   className="h-3 w-3 text-success" />}
            {isDown && <TrendingDown className="h-3 w-3 text-destructive" />}
            <span className={cn("text-[11px] font-medium tabular-nums",
              isUp ? "text-success" : isDown ? "text-destructive" : "text-muted-foreground"
            )}>
              {trend > 0 ? "+" : ""}{Math.abs(trend).toFixed(1)}% vs prev
            </span>
          </>
        )}
        {sub && !trend && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function NarrativeBlock({ icon: Icon, title, children, accent = "primary" }) {
  const styles = {
    primary:     { border: "border-primary/20",     bg: "bg-primary/[0.04]",     strip: "bg-primary",     icon: "border-primary/25 bg-primary/10 text-primary" },
    success:     { border: "border-success/20",     bg: "bg-success/[0.04]",     strip: "bg-success",     icon: "border-success/25 bg-success/10 text-success" },
    warning:     { border: "border-warning/20",     bg: "bg-warning/[0.04]",     strip: "bg-warning",     icon: "border-warning/25 bg-warning/10 text-warning" },
    destructive: { border: "border-destructive/20", bg: "bg-destructive/[0.04]", strip: "bg-destructive", icon: "border-destructive/25 bg-destructive/10 text-destructive" },
  }[accent] ?? {};

  return (
    <div className={cn("rounded-xl border overflow-hidden", styles.border, styles.bg)}>
      <div className={cn("h-[3px] w-full", styles.strip)} />
      <div className="flex gap-4 px-5 py-4">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border", styles.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-foreground mb-1.5">{title}</p>
          <div className="text-[12px] text-muted-foreground leading-relaxed space-y-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Peak hours heatmap ────────────────────────────────────────────────────────
function PeakHoursHeatmap({ peakHours }) {
  const DAYS   = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const HOURS  = Array.from({ length: 14 }, (_, i) => i + 7); // 7am – 8pm

  // Build a 2D map: day_of_week (1=Mon) × hour_of_day → revenue
  const grid = useMemo(() => {
    const map = {};
    (peakHours ?? []).forEach((r) => {
      const key = `${r.day_of_week}_${r.hour_of_day}`;
      map[key] = (map[key] ?? 0) + parseFloat(r.revenue ?? 0);
    });
    return map;
  }, [peakHours]);

  const maxVal = useMemo(() => Math.max(1, ...Object.values(grid)), [grid]);

  function opacity(val) {
    if (!val) return 0;
    const ratio = val / maxVal;
    if (ratio > 0.75) return "bg-primary/80";
    if (ratio > 0.5)  return "bg-primary/55";
    if (ratio > 0.25) return "bg-primary/30";
    return "bg-primary/12";
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[520px]">
        {/* Day headers */}
        <div className="flex items-center mb-1 ml-10">
          {DAYS.map((d) => (
            <div key={d} className="flex-1 text-center text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>
        {/* Hour rows */}
        {HOURS.map((h) => (
          <div key={h} className="flex items-center gap-0.5 mb-0.5">
            <div className="w-9 text-right text-[9px] text-muted-foreground pr-1.5 shrink-0">
              {h > 12 ? `${h - 12}pm` : h === 12 ? "12pm" : `${h}am`}
            </div>
            {DAYS.map((_, di) => {
              const dayNum = di + 1;
              const val = grid[`${dayNum}_${h}`] ?? 0;
              return (
                <div
                  key={di}
                  title={val > 0 ? formatCurrency(val) : "No sales"}
                  className={cn(
                    "flex-1 h-5 rounded-sm transition-all duration-150",
                    val > 0 ? opacity(val) : "bg-muted/20"
                  )}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Narrative generator ───────────────────────────────────────────────────────
function generateNarrative(summary, payments) {
  if (!summary) return null;

  const gross  = parseFloat(summary.total_revenue   ?? summary.gross_sales ?? 0);
  const net    = parseFloat(summary.net_revenue      ?? summary.net_sales   ?? 0);
  const txns   = parseInt(summary.total_transactions ?? 0, 10);
  const avg    = parseFloat(summary.average_order    ?? 0);
  const disc   = parseFloat(summary.total_discounts  ?? 0);

  const topPayment = Array.isArray(payments) && payments.length > 0
    ? (PAYMENT_METHOD_LABELS[payments[0]?.payment_method] ?? payments[0]?.payment_method ?? "Cash")
    : null;
  const topPaymentPct = Array.isArray(payments) && payments.length > 0
    ? (() => {
        const totalPay = payments.reduce((s, p) => s + parseFloat(p.total ?? 0), 0);
        return totalPay > 0 ? ((parseFloat(payments[0]?.total ?? 0) / totalPay) * 100).toFixed(0) : null;
      })()
    : null;

  return (
    <>
      <p>
        Your store generated{" "}
        <strong className="text-foreground">{formatCurrencyCompact(gross)}</strong> in gross sales
        this period across{" "}
        <strong className="text-foreground">{txns.toLocaleString()} transactions</strong>,
        with an average basket size of{" "}
        <strong className="text-foreground">{formatCurrency(avg)}</strong>.
      </p>
      {disc > 0 && (
        <p>
          Discounts of{" "}
          <strong className="text-warning">{formatCurrencyCompact(disc)}</strong> were applied,
          bringing net revenue to{" "}
          <strong className="text-foreground">{formatCurrencyCompact(net)}</strong>.
        </p>
      )}
      {topPayment && topPaymentPct && (
        <p>
          <strong className="text-foreground">{topPayment}</strong> is your most popular payment method,
          accounting for <strong className="text-foreground">{topPaymentPct}%</strong> of transactions.
        </p>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SalesAnalyticsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [period,   setPeriod]   = useState("day");

  const params = useMemo(() => ({
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  }), [dateFrom, dateTo]);

  const { data: summary,  isLoading: lSummary  } = useSalesSummary(params);
  const { data: revenue,  isLoading: lRevenue  } = useRevenueByPeriod({ ...params, period });
  const { data: payments, isLoading: lPayments } = usePaymentMethodSummary(params);
  const { data: peakHours                      } = usePeakHoursAnalysis(params);
  const { data: comparison, isLoading: lComp   } = useComparisonReport({ ...params, metric: "revenue", period: "month" });

  // ── Derived data ─────────────────────────────────────────────────────────
  const revenueData = useMemo(() =>
    (Array.isArray(revenue) ? revenue : []).map((r) => ({
      name:    r.period,
      gross:   parseFloat(r.revenue   ?? 0),
      txns:    parseInt(r.transactions ?? 0, 10),
      avg:     parseFloat(r.avg_basket ?? 0),
    })), [revenue]);

  const paymentData = useMemo(() =>
    (Array.isArray(payments) ? payments : []).map((p) => ({
      name:  PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
      value: parseFloat(p.total ?? 0),
      count: p.transaction_count ?? 0,
    })), [payments]);

  const paymentTotal = useMemo(() =>
    paymentData.reduce((s, p) => s + p.value, 0)
  , [paymentData]);

  const compMetrics = useMemo(() => comparison?.metrics ?? [], [comparison]);

  const narrative = useMemo(() => generateNarrative(summary, payments), [summary, payments]);

  return (
    <>
      <PageHeader
        title="Sales Analytics"
        description="Revenue trends, payment breakdown, peak hours, and period comparisons."
        backHref="/analytics"
        action={
          <DateRangePicker
            from={dateFrom} to={dateTo}
            onFromChange={setDateFrom} onToChange={setDateTo}
            onClear={() => { setDateFrom(""); setDateTo(""); }}
          />
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-5 space-y-5">

          {/* Narrative */}
          {(summary || lSummary) && (
            <NarrativeBlock icon={TrendingUp} title="Sales Performance Summary" accent="primary">
              {lSummary
                ? <span className="animate-pulse">Analysing your sales data…</span>
                : (narrative ?? <span className="text-muted-foreground">No sales data for this period.</span>)
              }
            </NarrativeBlock>
          )}

          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              label="Gross Sales"
              value={lSummary ? "—" : formatCurrencyCompact(parseFloat(summary?.total_revenue ?? summary?.gross_sales ?? 0))}
              icon={DollarSign}
              accent="primary"
              sub={`${summary?.total_transactions ?? 0} transactions`}
            />
            <KPICard
              label="Net Sales"
              value={lSummary ? "—" : formatCurrencyCompact(parseFloat(summary?.net_revenue ?? summary?.net_sales ?? 0))}
              icon={TrendingUp}
              accent="success"
            />
            <KPICard
              label="Avg Transaction"
              value={lSummary ? "—" : formatCurrency(parseFloat(summary?.average_order ?? summary?.avg_order_value ?? 0))}
              icon={ShoppingCart}
              accent="default"
            />
            <KPICard
              label="Transactions"
              value={lSummary ? "—" : (parseInt(summary?.total_transactions ?? 0, 10)).toLocaleString()}
              icon={BarChart3}
              accent="default"
            />
          </div>

          {/* Revenue Trend */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/20 flex items-center justify-between">
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Revenue Trend</h3>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">Gross sales over time</p>
              </div>
              {/* Period toggle */}
              <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
                {[["day","Daily"],["week","Weekly"],["month","Monthly"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setPeriod(val)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all duration-150",
                      period === val
                        ? "bg-card text-foreground shadow-sm border border-border/60"
                        : "text-muted-foreground hover:text-foreground"
                    )}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5">
              {lRevenue ? (
                <div className="h-56 animate-pulse rounded-lg bg-muted/30" />
              ) : revenueData.length === 0 ? (
                <EmptyState icon={BarChart3} title="No revenue data" description="Select a date range or wait for sales." compact />
              ) : (
                <>
                  <ChartContainer config={REVENUE_CHART_CONFIG} className="h-[220px]">
                    <ComposedChart data={revenueData}>
                      <defs>
                        <linearGradient id="sales-gross-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="var(--color-gross)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="var(--color-gross)" stopOpacity={0}   />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                      <YAxis yAxisId="rev"  tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={52} />
                      <YAxis yAxisId="txns" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={36} />
                      <ChartTooltip content={<CurrencyTooltipContent formatFn={(v, name) =>
                        name === "Transactions" ? `${Number(v).toLocaleString()} txns` : formatCurrency(v)
                      } />} />
                      <Legend content={({ payload }) => (
                        <div className="flex items-center justify-center gap-5 pt-2">
                          {payload?.map((p, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
                              <span className="text-[10px] text-muted-foreground">{p.value}</span>
                            </div>
                          ))}
                        </div>
                      )} />
                      <Area  yAxisId="rev"  type="monotone" dataKey="gross" name="Revenue"      stroke="var(--color-gross)" fill="url(#sales-gross-grad)" strokeWidth={2} dot={false} />
                      <Line  yAxisId="txns" type="monotone" dataKey="txns"  name="Transactions" stroke="var(--color-txns)"  strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    </ComposedChart>
                  </ChartContainer>
                  <p className="text-[10px] text-muted-foreground mt-2 text-center">
                    Blue area = gross revenue (left axis) · Dashed amber line = transaction count (right axis)
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Payment Methods */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border bg-muted/20">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Payment Methods</h3>
              </div>
              <div className="p-5">
                {lPayments ? (
                  <div className="h-48 animate-pulse rounded-lg bg-muted/30" />
                ) : paymentData.length === 0 ? (
                  <EmptyState icon={CreditCard} title="No payment data" compact />
                ) : (
                  <ChartContainer config={{}} className="h-[200px]">
                    <PieChart>
                      <Pie
                        data={paymentData} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" outerRadius={72} innerRadius={36}
                        paddingAngle={2}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={{ stroke: "#27272a" }}
                      >
                        {paymentData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
                    </PieChart>
                  </ChartContainer>
                )}
              </div>
            </div>

            {/* Payment table */}
            <Section title="Payment Breakdown">
              {lPayments ? (
                <div className="space-y-2">
                  {[1,2,3].map((i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-muted/30" />
                  ))}
                </div>
              ) : paymentData.length === 0 ? (
                <EmptyState icon={CreditCard} title="No data" compact />
              ) : (
                <div className="space-y-2">
                  {paymentData.map((p, i) => {
                    const pct = paymentTotal > 0 ? ((p.value / paymentTotal) * 100).toFixed(1) : "0";
                    return (
                      <div key={i} className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="flex-1 text-xs font-semibold text-foreground">{p.name}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{p.count} txns</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums w-10 text-right">{pct}%</span>
                        <span className="text-xs font-bold tabular-nums font-mono text-foreground w-24 text-right">{formatCurrency(p.value)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>

          {/* Peak Hours Heatmap */}
          <Section
            title="Peak Hours Heatmap"
            description="Revenue intensity by hour and day of week — darker = more revenue"
          >
            {!peakHours ? (
              <div className="h-48 animate-pulse rounded-lg bg-muted/30" />
            ) : (
              <PeakHoursHeatmap peakHours={peakHours} />
            )}
          </Section>

          {/* Comparison Table */}
          <Section
            title="Period Comparison"
            description={comparison ? `${comparison.current_label} vs ${comparison.previous_label}` : "Current vs previous period"}
          >
            {lComp ? (
              <div className="h-32 animate-pulse rounded-lg bg-muted/30" />
            ) : compMetrics.length === 0 ? (
              <EmptyState icon={BarChart3} title="No comparison data" description="Select a date range to compare periods." compact />
            ) : (
              <DataTable
                columns={[
                  { key: "metric",        header: "Metric",          render: (r) => <span className="text-xs font-semibold capitalize">{String(r.metric ?? "").replace(/_/g, " ")}</span> },
                  { key: "current_value", header: comparison?.current_label  ?? "Current",  align: "right", render: (r) => <span className="text-xs font-mono font-bold tabular-nums">{formatCurrency(parseFloat(r.current_value ?? 0))}</span> },
                  { key: "previous_value",header: comparison?.previous_label ?? "Previous", align: "right", render: (r) => <span className="text-xs font-mono tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.previous_value ?? 0))}</span> },
                  { key: "change_percent",header: "Change",          align: "right", render: (r) => {
                    const pct = parseFloat(r.change_percent ?? 0);
                    return (
                      <span className={cn("text-xs font-bold tabular-nums",
                        pct > 0 ? "text-success" : pct < 0 ? "text-destructive" : "text-muted-foreground"
                      )}>
                        {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                      </span>
                    );
                  }},
                ]}
                data={compMetrics}
                emptyState={<EmptyState icon={BarChart3} title="No comparison" compact />}
              />
            )}
          </Section>

          {/* Back link */}
          <div className="flex items-center gap-2 pt-2 pb-4">
            <Link to="/analytics">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                Business Health
              </Button>
            </Link>
            <Link to="/analytics/reports">
              <Button variant="outline" size="sm">Full Reports</Button>
            </Link>
          </div>

        </div>
      </div>
    </>
  );
}
