// pages/analytics/OverviewPage.jsx
import { useState, useMemo } from "react";
import {
  BarChart3, DollarSign, TrendingUp, ShoppingCart,
  Star, AlertTriangle, Package, Clock, Activity, Target, Zap,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { EmptyState }  from "@/components/shared/EmptyState";
import { cn }          from "@/lib/utils";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { CHART_COLORS } from "@/components/ui/chart";
import {
  useBusinessHealthSummary, useSalesSummary,
  useRevenueByPeriod, usePaymentMethodSummary, useComparisonReport,
} from "@/features/analytics/useAnalytics";
import { useAnalyticsDate }      from "@/features/analytics/AnalyticsLayout";
import {
  CardShell, ChartCard, SectionHeader,
  CurrencyFmtTooltip, getPaymentMeta, PeriodSelector,
} from "@/features/analytics/AnalyticsShared";

export default function OverviewPage() {
  const { params }          = useAnalyticsDate();
  const [period, setPeriod] = useState("day");

  const { data: health,   isLoading: lh } = useBusinessHealthSummary();
  const { data: summary,  isLoading: ls } = useSalesSummary(params);
  const { data: revenue,  isLoading: lr } = useRevenueByPeriod({ ...params, period });
  const { data: payments, isLoading: lp } = usePaymentMethodSummary(params);
  const { data: comparison }              = useComparisonReport({ ...params, compare_with: "previous_month" });

  const f = (k) => parseFloat(health?.[k]  ?? 0);
  const s = (k) => parseFloat(summary?.[k] ?? 0);

  const revenueData = useMemo(() => (revenue ?? []).map((r) => ({
    period:    (r.period ?? "").slice(0, 10),
    revenue:   parseFloat(r.revenue   ?? 0),
    discounts: parseFloat(r.discounts ?? 0),
  })), [revenue]);

  const payData = useMemo(() => {
    const list  = payments ?? [];
    const total = list.reduce((acc, p) => acc + parseFloat(p.total ?? 0), 0);
    return list.map((p) => ({
      ...p,
      label: getPaymentMeta(p.payment_method).label,
      color: getPaymentMeta(p.payment_method).color,
      value: parseFloat(p.total ?? 0),
      pct:   total > 0 ? parseFloat(p.total ?? 0) / total * 100 : 0,
    }));
  }, [payments]);

  const metrics = comparison?.metrics ?? [];

  return (
    <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
      <SectionHeader
        icon={BarChart3}
        title="Business Overview"
        description="Live health snapshot — today vs yesterday, current week and month. All key metrics at a glance."
      />

      {/* Health KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CardShell label="Today's Revenue"    value={lh ? "—" : formatCurrencyCompact(f("today_revenue"))}
          sub={`${health?.today_transactions ?? 0} transactions`} icon={DollarSign} accent="primary"
          trend trendValue={f("today_vs_yesterday")} />
        <CardShell label="This Week"          value={lh ? "—" : formatCurrencyCompact(f("week_revenue"))}
          icon={TrendingUp} accent="success" trend trendValue={f("week_vs_last_week")} />
        <CardShell label="This Month"         value={lh ? "—" : formatCurrencyCompact(f("month_revenue"))}
          icon={Activity} trend trendValue={f("month_vs_last_month")} />
        <CardShell label="Gross Profit Margin" value={lh ? "—" : `${f("gross_profit_margin").toFixed(1)}%`}
          sub="Current month" icon={Target}
          accent={f("gross_profit_margin") >= 20 ? "success" : f("gross_profit_margin") >= 10 ? "warning" : "destructive"} />
      </div>

      {/* Filtered period KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CardShell label="Gross Sales"     value={ls ? "—" : formatCurrencyCompact(s("total_revenue"))}
          sub={`${summary?.total_transactions ?? 0} txns`} icon={ShoppingCart} />
        <CardShell label="Net Sales"       value={ls ? "—" : formatCurrencyCompact(s("net_revenue"))}     icon={DollarSign}  accent="success" />
        <CardShell label="Avg Basket"      value={ls ? "—" : formatCurrency(s("average_order"))}          icon={Activity} />
        <CardShell label="Total Discounts" value={ls ? "—" : formatCurrencyCompact(s("total_discounts"))} icon={Star}        accent="warning" />
      </div>

      {/* Alert strip */}
      {!lh && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Low Stock Items",  value: health?.low_stock_count      ?? 0, icon: AlertTriangle, accent: (health?.low_stock_count      ?? 0) > 0 ? "warning"     : "success" },
            { label: "Out of Stock",     value: health?.out_of_stock_count   ?? 0, icon: Package,       accent: (health?.out_of_stock_count   ?? 0) > 0 ? "destructive" : "success" },
            { label: "Overdue Credit",   value: health?.overdue_credit_count ?? 0, icon: Clock,         accent: (health?.overdue_credit_count ?? 0) > 0 ? "destructive" : "success" },
            { label: "Pending Actions",  value: (health?.pending_expenses_count ?? 0) + (health?.pending_po_count ?? 0), icon: Zap, accent: "default" },
          ].map((a) => {
            const Icon = a.icon;
            const border = { destructive: "border-destructive/30 bg-destructive/5", warning: "border-warning/30 bg-warning/5", success: "border-success/30 bg-success/5", default: "border-border/60 bg-muted/20" }[a.accent];
            const text   = { destructive: "text-destructive", warning: "text-warning", success: "text-success", default: "text-foreground" }[a.accent];
            return (
              <div key={a.label} className={cn("rounded-lg border px-3 py-2.5 flex items-center gap-2.5", border)}>
                <Icon className={cn("h-3.5 w-3.5 shrink-0", text)} />
                <div>
                  <p className={cn("text-base font-bold tabular-nums leading-none", text)}>{a.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{a.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Revenue chart + payment donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Revenue Trend" loading={lr} className="col-span-2"
          action={<PeriodSelector value={period} onChange={setPeriod} />}>
          {revenueData.length === 0 ? <EmptyState icon={TrendingUp} title="No revenue data" compact /> : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={revenueData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="g-rev"  x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--chart-1)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g-disc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--chart-4)" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="var(--chart-4)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="period"   tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <Tooltip content={<CurrencyFmtTooltip />} />
                <Area type="monotone" dataKey="revenue"   name="Revenue"   stroke="var(--chart-1)" fill="url(#g-rev)"  strokeWidth={2} />
                <Area type="monotone" dataKey="discounts" name="Discounts" stroke="var(--chart-4)" fill="url(#g-disc)" strokeWidth={1.5} strokeDasharray="3 3" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Payment Mix" loading={lp}>
          {payData.length === 0 ? <EmptyState icon={Activity} title="No payments" compact /> : (
            <div className="flex flex-col gap-3">
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie data={payData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={54} paddingAngle={2}>
                    {payData.map((p, i) => <Cell key={i} fill={p.color ?? CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl text-[11px]">
                        <p className="font-bold">{d.label}</p>
                        <p className="text-muted-foreground">{formatCurrency(d.value)} · {d.pct.toFixed(1)}%</p>
                      </div>
                    );
                  }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {payData.map((p) => {
                  const { icon: Icon } = getPaymentMeta(p.payment_method);
                  return (
                    <div key={p.payment_method} className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
                      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[10px] text-muted-foreground flex-1 truncate">{p.label}</span>
                      <span className="text-[11px] font-bold tabular-nums">{formatCurrencyCompact(p.value)}</span>
                      <span className="text-[9px] text-muted-foreground w-7 text-right">{p.pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Period comparison */}
      {metrics.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-muted/10 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            {comparison?.current_label} vs {comparison?.previous_label}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {metrics.map((m) => {
              const pct    = parseFloat(m.change_percent ?? 0);
              const up     = pct >= 0;
              const isCurr = m.metric !== "transaction_count";
              const fmt    = (v) => isCurr ? formatCurrencyCompact(parseFloat(v ?? 0)) : Number(v).toLocaleString();
              const TIcon  = up ? ArrowUpRight : ArrowDownRight;
              return (
                <div key={m.metric} className="flex flex-col gap-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{m.metric.replace(/_/g, " ")}</span>
                  <span className="text-sm font-bold tabular-nums text-foreground">{fmt(m.current_value)}</span>
                  <span className={cn("flex items-center gap-0.5 text-[10px] font-semibold", up ? "text-success" : "text-destructive")}>
                    <TIcon className="h-3 w-3" />{Math.abs(pct).toFixed(1)}%
                  </span>
                  <span className="text-[9px] text-muted-foreground">{fmt(m.previous_value)} prev</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
