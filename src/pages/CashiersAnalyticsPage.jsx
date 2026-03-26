// pages/CashiersAnalyticsPage.jsx — Team Performance at /analytics/cashiers
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Award, ArrowLeft, BarChart3, AlertTriangle,
} from "lucide-react";
import {
  BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid,
} from "recharts";

import { PageHeader }      from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { DataTable }       from "@/components/shared/DataTable";
import { EmptyState }      from "@/components/shared/EmptyState";
import { Button }          from "@/components/ui/button";
import { cn }              from "@/lib/utils";
import { useCashierPerformance } from "@/features/analytics/useAnalytics";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { ChartContainer, ChartTooltip, CurrencyTooltipContent, CHART_COLORS } from "@/components/ui/chart";

const BAR_CHART_CONFIG   = { sales: { label: "Sales", color: "var(--chart-1)" } };
const RADAR_CHART_CONFIG = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function KPICard({ label, value, sub, accent = "default" }) {
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

  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function voidRateColor(pct) {
  if (pct < 2)  return "text-success";
  if (pct < 4)  return "text-warning";
  return "text-destructive";
}

// ── Cashier Leaderboard Card ──────────────────────────────────────────────────
function CashierCard({ cashier, rank }) {
  const totalSales = parseFloat(cashier.total_sales ?? 0);
  const txns       = cashier.transaction_count ?? 0;
  const avgBasket  = parseFloat(cashier.avg_transaction_value ?? 0);
  const voidCount  = cashier.void_count ?? 0;
  const voidPct    = txns > 0 ? ((voidCount / txns) * 100) : 0;
  const discounts  = parseFloat(cashier.total_discounts ?? 0);

  const rankStyles = {
    1: "border-warning/40 bg-warning/[0.06]",
    2: "border-border/60 bg-muted/10",
    3: "border-border/60 bg-muted/10",
  };
  const rankBadgeStyles = {
    1: "border-warning/40 bg-warning/10 text-warning",
    2: "border-border/60 bg-muted/30 text-muted-foreground",
    3: "border-border/60 bg-muted/30 text-muted-foreground",
  };
  const hasHighVoidRate = voidPct >= 4;

  return (
    <div className={cn(
      "rounded-xl border px-4 py-4 flex flex-col gap-3",
      rankStyles[rank] ?? "border-border/60 bg-card",
      hasHighVoidRate && "border-warning/30",
    )}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg border text-[11px] font-bold",
          rankBadgeStyles[rank] ?? "border-border/60 bg-muted/20 text-muted-foreground"
        )}>
          #{rank}
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-[11px] font-bold uppercase text-primary">
          {(cashier.cashier_name ?? "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-foreground truncate">{cashier.cashier_name}</p>
          {hasHighVoidRate && (
            <div className="flex items-center gap-1 mt-0.5">
              <AlertTriangle className="h-2.5 w-2.5 text-warning" />
              <span className="text-[9px] text-warning font-semibold">High void rate</span>
            </div>
          )}
        </div>
      </div>

      {/* Main metric */}
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Total Sales</p>
        <p className="text-xl font-bold tabular-nums text-primary">{formatCurrencyCompact(totalSales)}</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Transactions</p>
          <p className="text-xs font-bold tabular-nums text-foreground mt-0.5">{txns.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Avg Basket</p>
          <p className="text-xs font-bold tabular-nums text-foreground mt-0.5">{formatCurrencyCompact(avgBasket)}</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Void Rate</p>
          <p className={cn("text-xs font-bold tabular-nums mt-0.5", voidRateColor(voidPct))}>
            {voidPct.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Discounts */}
      {discounts > 0 && (
        <div className="border-t border-border/40 pt-2">
          <p className="text-[10px] text-muted-foreground">
            <span className="font-semibold text-warning">{formatCurrencyCompact(discounts)}</span> in discounts given
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CashiersAnalyticsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");

  const params = useMemo(() => ({
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  }), [dateFrom, dateTo]);

  const { data: cashiers, isLoading } = useCashierPerformance(params);

  const cashierList = useMemo(() => {
    if (!Array.isArray(cashiers)) return [];
    return [...cashiers].sort((a, b) => parseFloat(b.total_sales ?? 0) - parseFloat(a.total_sales ?? 0));
  }, [cashiers]);

  // Team KPIs
  const teamStats = useMemo(() => {
    if (cashierList.length === 0) return { totalSales: 0, totalTxns: 0, avgBasket: 0, voidRate: 0 };
    const totalSales = cashierList.reduce((s, c) => s + parseFloat(c.total_sales ?? 0), 0);
    const totalTxns  = cashierList.reduce((s, c) => s + (c.transaction_count ?? 0), 0);
    const totalVoids = cashierList.reduce((s, c) => s + (c.void_count ?? 0), 0);
    return {
      totalSales,
      totalTxns,
      avgBasket: totalTxns > 0 ? totalSales / totalTxns : 0,
      voidRate:  totalTxns > 0 ? (totalVoids / totalTxns) * 100 : 0,
    };
  }, [cashierList]);

  // Chart data
  const chartData = useMemo(() =>
    cashierList.slice(0, 10).map((c) => ({
      name:  c.cashier_name?.split(" ")[0] ?? "?",
      sales: parseFloat(c.total_sales ?? 0),
    })), [cashierList]);

  // Discount behavior data
  const discountData = useMemo(() =>
    cashierList.filter((c) => parseFloat(c.total_discounts ?? 0) > 0)
  , [cashierList]);

  // Radar chart — normalized performance comparison for top 5 cashiers
  const top5info = useMemo(() =>
    cashierList.slice(0, 5).map((c, i) => ({
      name:  c.cashier_name?.split(" ")[0] ?? `C${i + 1}`,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }))
  , [cashierList]);

  const radarData = useMemo(() => {
    const top = cashierList.slice(0, 5);
    if (top.length < 2) return [];
    const maxSales = Math.max(...top.map((c) => parseFloat(c.total_sales ?? 0)), 1);
    const maxTxns  = Math.max(...top.map((c) => c.transaction_count ?? 0), 1);
    const maxAvg   = Math.max(...top.map((c) => parseFloat(c.avg_transaction_value ?? 0)), 1);
    const names    = top5info.map((c) => c.name);
    const entry    = (label, fn) => ({ metric: label, ...Object.fromEntries(top.map((c, i) => [names[i], fn(c)])) });
    return [
      entry("Sales",        (c) => Math.round(parseFloat(c.total_sales ?? 0) / maxSales * 100)),
      entry("Transactions", (c) => Math.round((c.transaction_count ?? 0) / maxTxns * 100)),
      entry("Avg Basket",   (c) => Math.round(parseFloat(c.avg_transaction_value ?? 0) / maxAvg * 100)),
      entry("Reliability",  (c) => {
        const txns = c.transaction_count ?? 0;
        const vr   = txns > 0 ? (c.void_count ?? 0) / txns * 100 : 0;
        return Math.max(0, Math.round(100 - vr * 15));
      }),
      entry("Efficiency",   (c) => {
        const disc    = parseFloat(c.total_discounts ?? 0);
        const revenue = parseFloat(c.total_sales ?? 0);
        const discPct = revenue > 0 ? disc / revenue * 100 : 0;
        return Math.max(0, Math.round(100 - discPct * 5));
      }),
    ];
  }, [cashierList, top5info]);

  // Top cashier for narrative
  const top = cashierList[0];
  const highVoidCashier = useMemo(() =>
    cashierList.find((c) => {
      const txns = c.transaction_count ?? 0;
      return txns > 0 && ((c.void_count ?? 0) / txns * 100) >= 4;
    }), [cashierList]);

  const narrative = useMemo(() => {
    if (!top) return null;
    const topPct = teamStats.totalSales > 0
      ? ((parseFloat(top.total_sales ?? 0) / teamStats.totalSales) * 100).toFixed(0)
      : "0";
    return (
      <>
        <p>
          <strong className="text-foreground">{top.cashier_name}</strong> leads the team with{" "}
          <strong className="text-primary">{formatCurrencyCompact(parseFloat(top.total_sales ?? 0))}</strong> in
          sales ({topPct}% of total team revenue).
        </p>
        <p>
          The team processed{" "}
          <strong className="text-foreground">{teamStats.totalTxns.toLocaleString()} transactions</strong> with
          an average basket of{" "}
          <strong className="text-foreground">{formatCurrency(teamStats.avgBasket)}</strong>.
          Combined void rate:{" "}
          <strong className={cn(teamStats.voidRate < 2 ? "text-success" : teamStats.voidRate < 4 ? "text-warning" : "text-destructive")}>
            {teamStats.voidRate.toFixed(1)}%
          </strong>.
        </p>
        {highVoidCashier && (
          <p>
            <strong className="text-warning">{highVoidCashier.cashier_name}</strong>'s void rate
            of{" "}
            <strong className="text-warning">
              {((highVoidCashier.void_count ?? 0) / Math.max(highVoidCashier.transaction_count ?? 1, 1) * 100).toFixed(1)}%
            </strong>{" "}
            may need review — above the 4% threshold.
          </p>
        )}
      </>
    );
  }, [top, teamStats, highVoidCashier]);

  const discountColumns = useMemo(() => [
    { key: "cashier_name",    header: "Cashier",          render: (r) => <span className="text-xs font-semibold">{r.cashier_name}</span> },
    { key: "total_discounts", header: "Total Discounts",  align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-warning">{formatCurrency(parseFloat(r.total_discounts ?? 0))}</span> },
    { key: "transaction_count",header:"Transactions",     align: "right", render: (r) => <span className="text-xs tabular-nums">{r.transaction_count ?? 0}</span> },
    { key: "avg_transaction_value",header:"Avg Basket",   align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_transaction_value ?? 0))}</span> },
    { key: "discount_rate",   header: "Discount Rate %",  align: "right", render: (r) => {
      const txns = r.transaction_count ?? 0;
      const disc = parseFloat(r.total_discounts ?? 0);
      const avg  = txns > 0 ? parseFloat(r.avg_transaction_value ?? 0) : 0;
      const rate = avg > 0 ? ((disc / txns) / avg * 100) : 0;
      return (
        <span className={cn("text-xs font-bold tabular-nums", rate > 10 ? "text-warning" : "text-muted-foreground")}>
          {rate.toFixed(1)}%
        </span>
      );
    }},
  ], []);

  return (
    <>
      <PageHeader
        title="Team Performance"
        description="Cashier sales rankings, void rates, discount behaviour, and team metrics."
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
          <div className="rounded-xl border border-primary/20 bg-primary/4 overflow-hidden">
            <div className="h-0.75 w-full bg-primary" />
            <div className="flex gap-4 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                <Award className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-foreground mb-1.5">Team Performance Summary</p>
                <div className="text-[12px] text-muted-foreground leading-relaxed space-y-1">
                  {isLoading
                    ? <span className="animate-pulse">Loading team data…</span>
                    : (narrative ?? <span>No cashier performance data for this period.</span>)
                  }
                </div>
              </div>
            </div>
          </div>

          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              label="Team Total Sales"
              value={isLoading ? "—" : formatCurrencyCompact(teamStats.totalSales)}
              sub="combined revenue"
              accent="primary"
            />
            <KPICard
              label="Transactions"
              value={isLoading ? "—" : teamStats.totalTxns.toLocaleString()}
              sub="completed"
              accent="default"
            />
            <KPICard
              label="Team Avg Basket"
              value={isLoading ? "—" : formatCurrency(teamStats.avgBasket)}
              sub="per transaction"
              accent="default"
            />
            <KPICard
              label="Combined Void Rate"
              value={isLoading ? "—" : `${teamStats.voidRate.toFixed(1)}%`}
              sub="lower is better"
              accent={teamStats.voidRate < 2 ? "success" : teamStats.voidRate < 4 ? "warning" : "destructive"}
            />
          </div>

          {/* Leaderboard */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
              Cashier Leaderboard — {cashierList.length} Team Member{cashierList.length !== 1 ? "s" : ""}
            </h3>
            {isLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {[1,2,3].map((i) => <div key={i} className="h-48 animate-pulse rounded-xl bg-muted/30" />)}
              </div>
            ) : cashierList.length === 0 ? (
              <EmptyState icon={Award} title="No cashier data" description="No transactions recorded in this period." />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {cashierList.map((cashier, i) => (
                  <CashierCard key={cashier.cashier_name} cashier={cashier} rank={i + 1} />
                ))}
              </div>
            )}
          </div>

          {/* Performance Charts — bar + radar side by side */}
          {chartData.length > 0 && (
            <div className={radarData.length > 0 ? "grid grid-cols-1 lg:grid-cols-2 gap-5" : ""}>

              {/* Sales bar chart */}
              <Section title="Revenue by Cashier" description="Total sales ranked highest to lowest">
                <ChartContainer config={BAR_CHART_CONFIG} className={`h-[${Math.max(180, chartData.length * 28)}px]`}>
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <YAxis type="category" dataKey="name" width={80} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
                    <Bar dataKey="sales" name="Sales" radius={[0, 4, 4, 0]}>
                      {chartData.map((_, i) => (
                        <rect key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </Section>

              {/* Radar performance comparison */}
              {radarData.length > 0 && (
                <Section
                  title="Performance Radar"
                  description="Normalised comparison across 5 dimensions: sales, transactions, avg basket, reliability (low voids), efficiency (low discounts)"
                >
                  <ChartContainer config={RADAR_CHART_CONFIG} className="h-[220px]">
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
                      <PolarGrid stroke="#27272a" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "#a1a1aa" }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      {top5info.map((c) => (
                        <Radar key={c.name} name={c.name} dataKey={c.name}
                          stroke={c.color} fill={c.color} fillOpacity={0.12} strokeWidth={1.5} />
                      ))}
                      <ChartTooltip content={<CurrencyTooltipContent formatFn={(v) => `${v}/100`} />} />
                    </RadarChart>
                  </ChartContainer>
                  <div className="flex flex-wrap justify-center gap-3 pt-1">
                    {top5info.map((c, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: c.color }} />
                        <span className="text-[10px] text-muted-foreground">{cashierList[i]?.cashier_name ?? c.name}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

            </div>
          )}

          {/* Discount Behavior */}
          {discountData.length > 0 && (
            <Section
              title="Discount Behaviour"
              description="Cashiers who applied discounts this period"
              action={<AlertTriangle className="h-4 w-4 text-muted-foreground opacity-40" />}
            >
              <DataTable
                columns={discountColumns}
                data={discountData}
                emptyState={<EmptyState icon={BarChart3} title="No discounts" compact />}
              />
            </Section>
          )}

          {/* Back link */}
          <div className="flex items-center gap-2 pt-2 pb-4">
            <Link to="/analytics"><Button variant="outline" size="sm" className="gap-1.5"><ArrowLeft className="h-3.5 w-3.5" />Business Health</Button></Link>
          </div>

        </div>
      </div>
    </>
  );
}
