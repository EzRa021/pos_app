// pages/AnalyticsDashboardPage.jsx
// World-class role-aware business dashboard.
// Layout adapts to: super_admin/admin → manager → cashier → stock_keeper
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, BarChart3, ArrowRight, Package, Users,
  DollarSign, ShoppingCart, Clock,
  Timer, Activity, Boxes, ClipboardList, ArrowUpRight,
  ShieldAlert, CreditCard, Receipt,
} from "lucide-react";
import {
  ComposedChart, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  Line, XAxis, YAxis, CartesianGrid,
} from "recharts";

import { PageHeader }      from "@/components/shared/PageHeader";
import { Button }          from "@/components/ui/button";
import { cn }              from "@/lib/utils";
import {
  useBusinessHealthSummary, useSalesSummary,
  useRevenueByPeriod, useItemAnalytics,
  usePaymentMethodSummary, useProfitLossSummary,
  useCashierPerformance, useCustomerAnalytics, useStockVelocity,
} from "@/features/analytics/useAnalytics";
import { formatCurrency, formatCurrencyCompact, formatDateTime } from "@/lib/format";
import { PAYMENT_METHOD_LABELS }  from "@/lib/constants";
import { useAuthStore }    from "@/stores/auth.store";
import { useBranchStore }  from "@/stores/branch.store";
import { useShiftStore }   from "@/stores/shift.store";
import { ChartContainer, ChartTooltip, CurrencyTooltipContent, CHART_COLORS } from "@/components/ui/chart";

const ADM_REV_CONFIG  = { rev: { label: "Revenue", color: "var(--chart-1)" }, txns: { label: "Transactions", color: "var(--chart-3)" } };
const ADM_BAR_CONFIG  = { rev: { label: "Revenue", color: "var(--chart-1)" } };
const MGR_REV_CONFIG  = { rev: { label: "Revenue", color: "var(--chart-1)" } };
import { getTransactions } from "@/commands/transactions";
import { getLowStock }     from "@/commands/inventory";

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function niceDate() {
  return new Date().toLocaleDateString("en-NG", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function shiftDuration(openedAt) {
  if (!openedAt) return "—";
  const ms = Date.now() - new Date(openedAt).getTime();
  const h  = Math.floor(ms / 3_600_000);
  const m  = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function todayRange() {
  const d   = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const s   = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { date_from: s, date_to: s };
}

function monthRange() {
  const d   = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const y   = d.getFullYear();
  const m   = pad(d.getMonth() + 1);
  return { date_from: `${y}-${m}-01`, date_to: `${y}-${m}-${pad(d.getDate())}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Micro components
// ─────────────────────────────────────────────────────────────────────────────

function Skel({ h = 4, w, className }) {
  return (
    <div
      className={cn("animate-pulse rounded bg-muted/40", className)}
      style={{ height: `${h * 4}px`, width: w ? `${w * 4}px` : undefined }}
    />
  );
}

function TrendChip({ pct, loading }) {
  if (loading) return <Skel h={4} w={12} />;
  if (pct == null) return null;
  const up  = pct > 0;
  const dn  = pct < 0;
  const abs = Math.abs(pct).toFixed(1);
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
      up ? "bg-success/15 text-success" : dn ? "bg-destructive/12 text-destructive" : "bg-muted/50 text-muted-foreground",
    )}>
      {up ? <TrendingUp className="h-2.5 w-2.5" /> : dn ? <TrendingDown className="h-2.5 w-2.5" /> : null}
      {up ? "+" : ""}{abs}%
    </span>
  );
}

// Large KPI tile — links to a detail page
function KpiTile({ label, value, sub, trend, href, loading, alert }) {
  const content = (
    <div className={cn(
      "flex flex-col gap-1.5 rounded-xl border px-4 py-3.5 transition-all duration-150",
      alert
        ? "border-destructive/30 bg-destructive/4 hover:bg-destructive/6"
        : "border-border/60 bg-card hover:bg-muted/20",
    )}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {loading
        ? <Skel h={7} className="my-0.5 w-32" />
        : <span className="text-[22px] font-bold tabular-nums leading-none text-foreground">{value ?? "—"}</span>
      }
      <div className="flex items-center gap-2 flex-wrap">
        <TrendChip pct={trend} loading={loading} />
        {!loading && sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
  if (!href) return content;
  return <Link to={href} className="cursor-pointer">{content}</Link>;
}

// Section card with header + optional link + optional loading skeleton
function Section({ title, href, hrefLabel = "View all", loading, empty, emptyMsg = "No data", right, children, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
        <div className="flex items-center gap-3">
          {right}
          {href && (
            <Link to={href} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary hover:underline">
              {hrefLabel} <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          )}
        </div>
      </div>
      <div className="p-5">
        {loading ? (
          <div className="space-y-2.5">
            <Skel h={5} className="w-full" />
            <Skel h={5} className="w-5/6" />
            <Skel h={5} className="w-4/6" />
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <Activity className="h-7 w-7 text-muted-foreground/30" />
            <p className="text-[12px] text-muted-foreground">{emptyMsg}</p>
          </div>
        ) : children}
      </div>
    </div>
  );
}

// Greeting banner — changes tint per role
function GreetingBanner({ user, health, lHealth, alerts, tint = "primary" }) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username || "there";
  const role = (user?.role_name ?? user?.role_slug ?? "").replace(/_/g, " ");
  const tints = {
    primary:     "border-primary/20 bg-primary/4",
    success:     "border-success/20 bg-success/4",
    warning:     "border-warning/20 bg-warning/4",
    muted:       "border-border/60 bg-muted/20",
  };

  return (
    <div className={cn("rounded-xl border px-5 py-4", tints[tint] ?? tints.primary)}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-bold text-foreground leading-tight">
              {greeting()}, {name}!
            </p>
            <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold capitalize text-muted-foreground">
              {role}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{niceDate()}</p>
          {!lHealth && health && <HealthNarrative health={health} />}
        </div>

        {/* Alert chips */}
        {!lHealth && (
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {alerts?.map((a) => (
              <Link key={a.href} to={a.href}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all duration-150 hover:opacity-80",
                  a.level === "critical" ? "border-destructive/25 bg-destructive/10 text-destructive"
                    : a.level === "warning" ? "border-warning/25 bg-warning/10 text-warning"
                    : "border-border/50 bg-muted/30 text-muted-foreground",
                )}
              >
                {a.icon && <a.icon className="h-3 w-3" />}
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HealthNarrative({ health }) {
  const parts = useMemo(() => {
    const out = [];
    const todayRev  = parseFloat(health.today_revenue  ?? 0);
    const weekRev   = parseFloat(health.week_revenue   ?? 0);
    const weekPct   = parseFloat(health.week_vs_last_week ?? 0);
    const margin    = parseFloat(health.gross_profit_margin ?? 0);
    const outStock  = parseInt(health.out_of_stock_count ?? 0, 10);
    const lowStock  = parseInt(health.low_stock_count   ?? 0, 10);
    const openCred  = parseFloat(health.open_credit_total ?? 0);
    const topItem   = health.top_item_name;

    if (todayRev > 0) {
      const trend = weekPct > 10 ? "strong week" : weekPct > 0 ? "steady week" : weekPct < -10 ? "slower week" : "week";
      out.push(`Today's revenue is ${formatCurrencyCompact(todayRev)} — it's been a ${trend} at ${formatCurrencyCompact(weekRev)}${Math.abs(weekPct) > 3 ? ` (${weekPct > 0 ? "+" : ""}${weekPct.toFixed(1)}% vs last week)` : ""}.`);
    }
    if (margin > 0) out.push(`Gross margin this month: ${margin.toFixed(1)}%.`);
    if (topItem)    out.push(`Top product: ${topItem}.`);
    if (outStock > 0 || lowStock > 0)
      out.push(`${[outStock > 0 ? `${outStock} out of stock` : "", lowStock > 0 ? `${lowStock} running low` : ""].filter(Boolean).join(", ")}.`);
    if (openCred > 0) out.push(`${formatCurrencyCompact(openCred)} in open credit.`);
    return out;
  }, [health]);

  if (parts.length === 0) return null;
  return (
    <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed max-w-2xl">
      {parts.join("  ")}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P&L row (for management views)
// ─────────────────────────────────────────────────────────────────────────────
function PLRow({ label, value, sub, accent, indent, separator }) {
  return (
    <>
      {separator && <div className="border-t border-border/60 my-1" />}
      <div className={cn("flex items-center justify-between py-2", indent && "pl-3")}>
        <div className="flex items-center gap-2">
          {indent && <div className="h-3 w-0.5 rounded-full bg-border" />}
          <span className={cn("text-[12px]", indent ? "text-muted-foreground" : "font-semibold text-foreground")}>{label}</span>
          {sub && <span className="text-[10px] text-muted-foreground">({sub})</span>}
        </div>
        <span className={cn(
          "text-[12px] font-bold tabular-nums",
          accent === "success" ? "text-success" : accent === "destructive" ? "text-destructive" : accent === "muted" ? "text-muted-foreground" : "text-foreground",
        )}>
          {value ?? "—"}
        </span>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / SUPER-ADMIN VIEW
// ─────────────────────────────────────────────────────────────────────────────
function AdminView({ user, health, lHealth }) {
  const now = useMemo(() => monthRange(), []);

  const { data: revenue,  isLoading: lRev  } = useRevenueByPeriod({ ...now, period: "day" });
  const { data: items,    isLoading: lItems } = useItemAnalytics({ ...now, limit: 6, sort_by: "revenue" });
  const { data: payments, isLoading: lPay   } = usePaymentMethodSummary(now);
  const { data: pl,       isLoading: lPL    } = useProfitLossSummary(now);
  const { data: cashiers, isLoading: lCash  } = useCashierPerformance(now);
  const { data: summary                      } = useSalesSummary(now);
  const { data: customers                    } = useCustomerAnalytics({ lapsed_days: 60 });

  // Chart data
  const revenueData = useMemo(() =>
    (Array.isArray(revenue) ? revenue : []).slice(-30).map((r) => ({
      d:       r.period ?? "",
      rev:     parseFloat(r.revenue ?? 0),
      txns:    parseInt(r.transactions ?? 0, 10),
    })), [revenue]);

  const topItemsData = useMemo(() =>
    (Array.isArray(items) ? items : []).map((i) => ({
      name: (i.item_name?.length ?? 0) > 14 ? i.item_name.slice(0, 14) + "…" : (i.item_name ?? ""),
      rev:  parseFloat(i.revenue ?? 0),
    })), [items]);

  const payData = useMemo(() =>
    (Array.isArray(payments) ? payments : []).map((p, i) => ({
      name:  PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
      value: parseFloat(p.total ?? 0),
      color: CHART_COLORS[i % CHART_COLORS.length],
    })), [payments]);

  const cashierList = useMemo(() => (Array.isArray(cashiers) ? cashiers : []).slice(0, 5), [cashiers]);
  const maxCashierSales = useMemo(() =>
    cashierList.reduce((m, c) => Math.max(m, parseFloat(c.total_value ?? 0)), 1), [cashierList]);

  // KPI values
  const todayPct  = parseFloat(health?.today_vs_yesterday  ?? 0);
  const weekPct   = parseFloat(health?.week_vs_last_week   ?? 0);
  const monthPct  = parseFloat(health?.month_vs_last_month ?? 0);
  const margin    = parseFloat(health?.gross_profit_margin ?? 0);
  const outStock  = parseInt(health?.out_of_stock_count   ?? 0, 10);
  const lowStock  = parseInt(health?.low_stock_count      ?? 0, 10);
  const openCred  = parseFloat(health?.open_credit_total  ?? 0);

  // Alerts for banner
  const alerts = useMemo(() => {
    const a = [];
    if (parseInt(health?.pending_expenses_count ?? 0, 10) > 0)
      a.push({ label: `${health.pending_expenses_count} pending expense${parseInt(health.pending_expenses_count,10)>1?"s":""}`, href: "/expenses", level: "warning", icon: Receipt });
    if (parseInt(health?.pending_po_count ?? 0, 10) > 0)
      a.push({ label: `${health.pending_po_count} PO${parseInt(health.pending_po_count,10)>1?"s":""} pending`, href: "/purchase-orders", level: "warning", icon: ClipboardList });
    if (parseInt(health?.overdue_credit_count ?? 0, 10) > 0)
      a.push({ label: `${health.overdue_credit_count} overdue credit`, href: "/credit-sales", level: "critical", icon: CreditCard });
    return a;
  }, [health]);

  return (
    <div className="space-y-5">
      <GreetingBanner user={user} health={health} lHealth={lHealth} alerts={alerts} tint="primary" />

      {/* KPI Pulse Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile label="Today's Revenue"  loading={lHealth} href="/analytics/sales"
          value={formatCurrencyCompact(parseFloat(health?.today_revenue ?? 0))}
          trend={todayPct} sub={`${health?.today_transactions ?? "–"} txns`} />
        <KpiTile label="This Week"        loading={lHealth} href="/analytics/sales"
          value={formatCurrencyCompact(parseFloat(health?.week_revenue ?? 0))}
          trend={weekPct} sub="vs last week" />
        <KpiTile label="This Month"       loading={lHealth} href="/analytics/sales"
          value={formatCurrencyCompact(parseFloat(health?.month_revenue ?? 0))}
          trend={monthPct} sub="vs last month" />
        <KpiTile label="Gross Margin"     loading={lHealth} href="/analytics/profitability"
          value={margin > 0 ? `${margin.toFixed(1)}%` : "—"}
          sub="this month" />
        <KpiTile label={outStock > 0 ? "Stock Alerts" : "Open Credit"} loading={lHealth}
          href={outStock > 0 ? "/analytics/inventory" : "/credit-sales"}
          value={outStock > 0 ? `${outStock} out` : openCred > 0 ? formatCurrencyCompact(openCred) : "All clear"}
          sub={outStock > 0 ? `${lowStock} low stock` : openCred > 0 ? `${health?.overdue_credit_count ?? 0} overdue` : "healthy"}
          trend={outStock > 0 || parseInt(health?.overdue_credit_count ?? 0,10) > 0 ? -1 : null}
          alert={outStock > 0} />
      </div>

      {/* Main 2-column: Revenue chart + P&L */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        <Section title="Revenue Trend — Last 30 Days" href="/analytics/sales" loading={lRev}
          empty={revenueData.length === 0} emptyMsg="No revenue data yet">
          <ChartContainer config={ADM_REV_CONFIG} className="h-[200px]">
            <ComposedChart data={revenueData}>
              <defs>
                <linearGradient id="adm-rev-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--color-rev)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-rev)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 9 }} hide />
              <YAxis yAxisId="rev"  tickFormatter={formatCurrencyCompact} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} width={52} />
              <YAxis yAxisId="txns" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} width={30} />
              <ChartTooltip content={<CurrencyTooltipContent formatFn={(v, name) => name === "Transactions" ? String(v) : formatCurrency(v)} />} />
              <Area yAxisId="rev" type="monotone" dataKey="rev" name="Revenue"
                stroke="var(--color-rev)" fill="url(#adm-rev-grad)" strokeWidth={2} dot={false} />
              <Line yAxisId="txns" type="monotone" dataKey="txns" name="Transactions"
                stroke="var(--color-txns)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </ComposedChart>
          </ChartContainer>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-5 rounded-sm bg-primary/60" />Revenue (left axis)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-5 border-t border-dashed border-warning" />Transactions (right axis)</span>
          </div>
        </Section>

        {/* P&L Snapshot */}
        <Section title="P&L Snapshot (Month)" href="/analytics/profitability" loading={lPL}
          empty={!pl} emptyMsg="No P&L data yet">
          {pl && (
            <div className="divide-y divide-border/40">
              <PLRow label="Gross Sales"  value={formatCurrencyCompact(parseFloat(pl.gross_sales ?? 0))} />
              <PLRow label="Discounts"    value={`− ${formatCurrencyCompact(parseFloat(pl.total_discounts ?? 0))}`}
                accent="muted" indent />
              <PLRow label="Net Revenue"  value={formatCurrencyCompact(parseFloat(pl.net_sales ?? pl.net_revenue ?? 0))} />
              <PLRow label="COGS"         value={`− ${formatCurrencyCompact(parseFloat(pl.cogs ?? 0))}`}
                accent="muted" indent />
              <PLRow label="Gross Profit" value={formatCurrencyCompact(parseFloat(pl.gross_profit ?? 0))}
                accent="success" separator />
              <PLRow label="Expenses"     value={`− ${formatCurrencyCompact(parseFloat(pl.total_expenses ?? 0))}`}
                accent="muted" indent />
              <PLRow label="Net Profit"   value={formatCurrencyCompact(parseFloat(pl.net_profit ?? 0))}
                accent={parseFloat(pl.net_profit ?? 0) >= 0 ? "success" : "destructive"} separator />
              {pl.tax_collected != null && (
                <PLRow label="VAT Collected" value={formatCurrencyCompact(parseFloat(pl.tax_collected ?? 0))}
                  accent="muted" indent />
              )}
            </div>
          )}
        </Section>
      </div>

      {/* Bottom 3-column: Items + Payments + Team */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section title="Top Products (Month)" href="/analytics/products" loading={lItems}
          empty={topItemsData.length === 0} emptyMsg="No sales data yet">
          <ChartContainer config={ADM_BAR_CONFIG} className="h-[160px]">
            <BarChart data={topItemsData} layout="vertical">
              <XAxis type="number" tickFormatter={formatCurrencyCompact} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
              <YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#a1a1aa" }} />
              <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
              <Bar dataKey="rev" name="Revenue" radius={[0, 4, 4, 0]}>
                {topItemsData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? "#22c55e" : CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </Section>

        <Section title="Payment Methods" href="/analytics/sales" loading={lPay}
          empty={payData.length === 0} emptyMsg="No transactions yet">
          <ChartContainer config={{}} className="h-[130px]">
            <PieChart>
              <Pie data={payData} dataKey="value" nameKey="name"
                cx="50%" cy="50%" outerRadius={55} innerRadius={26} paddingAngle={2}>
                {payData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
            </PieChart>
          </ChartContainer>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {payData.map((e) => (
              <span key={e.name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                {e.name}
              </span>
            ))}
          </div>
        </Section>

        <Section title="Team Performance" href="/analytics/cashiers" loading={lCash}
          empty={cashierList.length === 0} emptyMsg="No cashier data yet">
          <div className="space-y-2">
            {cashierList.map((c, i) => {
              const sales = parseFloat(c.total_value ?? 0);
              const pct   = maxCashierSales > 0 ? (sales / maxCashierSales) * 100 : 0;
              return (
                <div key={c.cashier_id ?? i} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-[9px] font-bold text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="text-[12px] font-medium text-foreground truncate max-w-[100px]">
                        {c.cashier_name ?? "Unknown"}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[12px] font-bold tabular-nums text-foreground">
                        {formatCurrencyCompact(sales)}
                      </span>
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {c.total_transactions ?? 0} txns
                      </span>
                    </div>
                  </div>
                  <div className="h-1 w-full rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", i === 0 ? "bg-primary" : "bg-muted-foreground/40")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {/* Customer snapshot + Month summary */}
      {(customers || summary) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {customers && (
            <Section title="Customer Intelligence" href="/analytics/customers">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Total Customers",  value: parseInt(customers.total_customers  ?? 0, 10).toLocaleString(), accent: "default" },
                  { label: "Active",            value: parseInt(customers.active_customers ?? 0, 10).toLocaleString(), accent: "success" },
                  { label: "Lapsed (60 days)",  value: parseInt(customers.lapsed_customers ?? 0, 10).toLocaleString(), accent: customers.lapsed_customers > 0 ? "warning" : "muted" },
                  { label: "Avg. Lifetime Value", value: formatCurrencyCompact(parseFloat(customers.avg_lifetime_value ?? 0)), accent: "primary" },
                ].map(({ label, value, accent }) => (
                  <div key={label} className={cn(
                    "rounded-lg border px-3 py-2.5",
                    accent === "success" ? "border-success/20 bg-success/4"
                      : accent === "warning" ? "border-warning/20 bg-warning/4"
                      : accent === "primary" ? "border-primary/20 bg-primary/4"
                      : "border-border/60 bg-muted/10",
                  )}>
                    <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                    <p className={cn("text-lg font-bold tabular-nums",
                      accent === "success" ? "text-success" : accent === "warning" ? "text-warning" : accent === "primary" ? "text-primary" : "text-foreground",
                    )}>{value}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {summary && (
            <Section title="Month at a Glance">
              <div className="divide-y divide-border/40">
                {[
                  { label: "Gross Sales",   value: formatCurrencyCompact(parseFloat(summary.total_revenue ?? summary.gross_sales ?? 0)) },
                  { label: "Net Revenue",   value: formatCurrencyCompact(parseFloat(summary.net_revenue ?? summary.net_sales ?? 0)) },
                  { label: "Transactions",  value: parseInt(summary.total_transactions ?? 0, 10).toLocaleString() },
                  { label: "Avg Basket",    value: formatCurrency(parseFloat(summary.average_order ?? summary.avg_order_value ?? 0)) },
                  { label: "Discounts",     value: formatCurrencyCompact(parseFloat(summary.total_discounts ?? 0)) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-2.5">
                    <span className="text-[12px] text-muted-foreground">{label}</span>
                    <span className="text-[12px] font-bold tabular-nums text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* Navigation cards */}
      <AnalyticsNavGrid role="admin" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MANAGER VIEW
// ─────────────────────────────────────────────────────────────────────────────
function ManagerView({ user, health, lHealth }) {
  const activeShift = useShiftStore((s) => s.activeShift);
  const isShiftOpen = useShiftStore((s) => s.isShiftOpen());
  const now         = useMemo(() => monthRange(), []);

  const { data: revenue,  isLoading: lRev  } = useRevenueByPeriod({ ...now, period: "day" });
  const { data: items,    isLoading: lItems } = useItemAnalytics({ ...now, limit: 5, sort_by: "revenue" });
  const { data: cashiers, isLoading: lCash  } = useCashierPerformance(now);

  const revenueData = useMemo(() =>
    (Array.isArray(revenue) ? revenue : []).slice(-14).map((r) => ({
      d:   r.period ?? "",
      rev: parseFloat(r.revenue ?? 0),
    })), [revenue]);

  const topItemsData = useMemo(() =>
    (Array.isArray(items) ? items : []).map((i) => ({
      name: (i.item_name?.length ?? 0) > 16 ? i.item_name.slice(0, 16) + "…" : (i.item_name ?? ""),
      rev:  parseFloat(i.revenue ?? 0),
      qty:  parseInt(i.qty_sold ?? 0, 10),
    })), [items]);

  const cashierList = useMemo(() => (Array.isArray(cashiers) ? cashiers : []).slice(0, 6), [cashiers]);

  const todayPct  = parseFloat(health?.today_vs_yesterday  ?? 0);
  const weekPct   = parseFloat(health?.week_vs_last_week   ?? 0);
  const outStock  = parseInt(health?.out_of_stock_count   ?? 0, 10);
  const lowStock  = parseInt(health?.low_stock_count      ?? 0, 10);

  const alerts = useMemo(() => {
    const a = [];
    if (parseInt(health?.pending_expenses_count ?? 0, 10) > 0)
      a.push({ label: `${health.pending_expenses_count} expense${parseInt(health.pending_expenses_count,10)>1?"s":""} pending`, href: "/expenses", level: "warning", icon: Receipt });
    if (parseInt(health?.overdue_credit_count ?? 0, 10) > 0)
      a.push({ label: `${health.overdue_credit_count} overdue credit`, href: "/credit-sales", level: "critical", icon: CreditCard });
    return a;
  }, [health]);

  return (
    <div className="space-y-5">
      <GreetingBanner user={user} health={health} lHealth={lHealth} alerts={alerts} tint="primary" />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile label="Today's Revenue" loading={lHealth} href="/analytics/sales"
          value={formatCurrencyCompact(parseFloat(health?.today_revenue ?? 0))}
          trend={todayPct} sub={`${health?.today_transactions ?? "–"} txns`} />
        <KpiTile label="This Week" loading={lHealth} href="/analytics/sales"
          value={formatCurrencyCompact(parseFloat(health?.week_revenue ?? 0))}
          trend={weekPct} sub="vs last week" />
        <KpiTile label="Gross Margin" loading={lHealth} href="/analytics/profitability"
          value={parseFloat(health?.gross_profit_margin ?? 0) > 0
            ? `${parseFloat(health.gross_profit_margin).toFixed(1)}%` : "—"}
          sub="this month" />
        <KpiTile label="Stock Alerts" loading={lHealth} href="/inventory"
          value={outStock > 0 ? `${outStock} out` : lowStock > 0 ? `${lowStock} low` : "All clear"}
          sub={outStock > 0 ? `${lowStock} also low` : "stock healthy"}
          alert={outStock > 0} />
        <Link to="/shifts" className={cn(
          "flex flex-col gap-1.5 rounded-xl border px-4 py-3.5 transition-all duration-150",
          isShiftOpen ? "border-success/30 bg-success/4 hover:bg-success/6" : "border-warning/30 bg-warning/4 hover:bg-warning/6",
        )}>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Shift Status</span>
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full", isShiftOpen ? "bg-success" : "bg-warning")} />
            <span className={cn("text-[14px] font-bold", isShiftOpen ? "text-success" : "text-warning")}>
              {isShiftOpen ? "Open" : "No shift"}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {isShiftOpen && activeShift?.opened_at
              ? `Since ${new Date(activeShift.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${shiftDuration(activeShift.opened_at)}`
              : isShiftOpen ? "Shift in progress" : "Open a shift to sell"}
          </span>
        </Link>
      </div>

      {/* Revenue chart + Cashier leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <Section title="Revenue — Last 14 Days" href="/analytics/sales" loading={lRev}
          empty={revenueData.length === 0} emptyMsg="No revenue data yet">
          <ChartContainer config={MGR_REV_CONFIG} className="h-[190px]">
            <AreaChart data={revenueData}>
              <defs>
                <linearGradient id="mgr-rev-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--color-rev)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-rev)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 9 }} hide />
              <YAxis tickFormatter={formatCurrencyCompact} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} width={52} />
              <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
              <Area type="monotone" dataKey="rev" name="Revenue"
                stroke="var(--color-rev)" fill="url(#mgr-rev-grad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ChartContainer>
        </Section>

        <Section title="Staff Performance" href="/analytics/cashiers" loading={lCash}
          empty={cashierList.length === 0} emptyMsg="No cashier data">
          <div className="space-y-3">
            {cashierList.map((c, i) => (
              <div key={c.cashier_id ?? i} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/50 text-[10px] font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-foreground truncate">{c.cashier_name ?? "Unknown"}</p>
                  <p className="text-[10px] text-muted-foreground">{c.total_transactions ?? 0} txns · avg {formatCurrencyCompact(parseFloat(c.avg_transaction_value ?? 0))}</p>
                </div>
                <span className="text-[12px] font-bold tabular-nums text-foreground">{formatCurrencyCompact(parseFloat(c.total_value ?? 0))}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Top items + quick links */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
        <Section title="Top Selling Items (Month)" href="/analytics/products" loading={lItems}
          empty={topItemsData.length === 0} emptyMsg="No items sold yet">
          <div className="space-y-2">
            {topItemsData.map((item, i) => (
              <div key={i} className="flex items-center gap-3 py-1">
                <div className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold",
                  i === 0 ? "border-success/30 bg-success/10 text-success" : "border-border/60 bg-muted/20 text-muted-foreground",
                )}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-foreground truncate">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">{item.qty} units sold</p>
                </div>
                <span className="text-[12px] font-bold tabular-nums text-foreground">{formatCurrencyCompact(item.rev)}</span>
              </div>
            ))}
          </div>
        </Section>

        <AnalyticsNavGrid role="manager" compact />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASHIER VIEW
// ─────────────────────────────────────────────────────────────────────────────
function CashierView({ user, health, lHealth }) {
  const storeId    = useBranchStore((s) => s.activeStore?.id);
  const storeName  = useBranchStore((s) => s.activeStore?.store_name);
  const activeShift = useShiftStore((s) => s.activeShift);
  const isShiftOpen = useShiftStore((s) => s.isShiftOpen());
  const navigate    = useNavigate();
  const today       = useMemo(() => todayRange(), []);

  // My stats today
  const { data: myCashiers, isLoading: lMine } = useCashierPerformance({
    cashier_id: user?.id,
    ...today,
  });
  const myStats = useMemo(() =>
    (Array.isArray(myCashiers) ? myCashiers : []).find((c) => c.cashier_id === user?.id) ?? myCashiers?.[0] ?? null,
    [myCashiers, user?.id]);

  // Recent transactions (store-wide, latest 6)
  const { data: txnPage, isLoading: lTxns } = useQuery({
    queryKey: ["dash-recent-txns", storeId],
    queryFn:  () => getTransactions({ store_id: storeId, limit: 6, page: 1 }),
    enabled:  !!storeId,
    staleTime: 30_000,
  });
  const recentTxns = useMemo(() => txnPage?.rows ?? [], [txnPage]);

  // Low stock notice
  const { data: lowStockItems } = useQuery({
    queryKey: ["dash-low-stock-cashier", storeId],
    queryFn:  () => getLowStock(storeId, 5),
    enabled:  !!storeId,
    staleTime: 120_000,
  });
  const lowStockList = useMemo(() => lowStockItems ?? [], [lowStockItems]);

  const mySales = parseFloat(myStats?.total_value ?? 0);
  const myTxns  = parseInt(myStats?.total_transactions ?? 0, 10);
  const myAvg   = parseFloat(myStats?.avg_transaction_value ?? 0);

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div className="rounded-xl border border-success/20 bg-success/4 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-bold text-foreground">{greeting()}, {[user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username || "there"}!</p>
              <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Cashier</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{niceDate()} · {storeName ?? "Your store"}</p>
          </div>
          <div className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2",
            isShiftOpen ? "border-success/25 bg-success/10" : "border-warning/25 bg-warning/10",
          )}>
            <div className={cn("h-2 w-2 rounded-full", isShiftOpen ? "bg-success animate-pulse" : "bg-warning")} />
            <span className={cn("text-[12px] font-bold", isShiftOpen ? "text-success" : "text-warning")}>
              {isShiftOpen ? "Shift Open" : "No Active Shift"}
            </span>
          </div>
        </div>
      </div>

      {/* Shift hero card */}
      <div className={cn(
        "rounded-xl border overflow-hidden",
        isShiftOpen ? "border-success/25" : "border-warning/25",
      )}>
        <div className={cn("h-1 w-full", isShiftOpen ? "bg-success" : "bg-warning")} />
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[13px] font-bold text-foreground">
                {isShiftOpen ? "My Shift Today" : "Start Your Shift"}
              </h2>
              {isShiftOpen && activeShift?.opened_at && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Open since {new Date(activeShift.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {shiftDuration(activeShift.opened_at)} running
                </p>
              )}
              {!isShiftOpen && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Open a shift before you can process sales
                </p>
              )}
            </div>
            {isShiftOpen && (
              <div className="flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-3 py-1">
                <Timer className="h-3 w-3 text-success" />
                <span className="text-[11px] font-semibold text-success">{shiftDuration(activeShift?.opened_at)}</span>
              </div>
            )}
          </div>

          {/* My KPIs */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: "My Sales",      value: lMine ? null : formatCurrencyCompact(mySales),      color: "text-foreground" },
              { label: "Transactions",  value: lMine ? null : myTxns.toLocaleString(),              color: "text-primary" },
              { label: "Avg Basket",    value: lMine ? null : formatCurrency(myAvg),                color: "text-foreground" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border border-border/60 bg-card px-3 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
                {value === null ? <Skel h={6} className="w-20" /> : <p className={cn("text-[18px] font-bold tabular-nums leading-none", color)}>{value}</p>}
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="flex gap-3">
            <Button
              variant={isShiftOpen ? "default" : "outline"}
              className="flex-1 gap-2"
              onClick={() => navigate("/pos")}
            >
              <ShoppingCart className="h-4 w-4" />
              {isShiftOpen ? "Go to POS" : "Open POS"}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => navigate("/shifts")}>
              <Clock className="h-4 w-4" />
              Shifts
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => navigate("/transactions")}>
              <Receipt className="h-4 w-4" />
              History
            </Button>
          </div>
        </div>
      </div>

      {/* Recent transactions + Low stock */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
        <Section title="Recent Transactions" href="/transactions" loading={lTxns}
          empty={recentTxns.length === 0} emptyMsg="No transactions yet today">
          <div className="divide-y divide-border/40">
            {recentTxns.map((txn) => (
              <Link key={txn.id} to={`/transactions/${txn.id}`}
                className="flex items-center gap-3 py-2.5 hover:bg-muted/20 -mx-5 px-5 transition-colors duration-100">
                <div className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[10px]",
                  txn.status === "completed" ? "border-success/25 bg-success/10 text-success"
                    : txn.status === "voided" ? "border-destructive/25 bg-destructive/10 text-destructive"
                    : "border-border/60 bg-muted/20 text-muted-foreground",
                )}>
                  <Receipt className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-foreground truncate">{txn.transaction_ref ?? `#${txn.id}`}</p>
                  <p className="text-[10px] text-muted-foreground">{formatDateTime(txn.created_at)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[12px] font-bold tabular-nums text-foreground">{formatCurrency(parseFloat(txn.total_amount ?? 0))}</p>
                  <p className={cn("text-[10px] capitalize",
                    txn.status === "completed" ? "text-success" : txn.status === "voided" ? "text-destructive" : "text-muted-foreground",
                  )}>{txn.status}</p>
                </div>
              </Link>
            ))}
          </div>
        </Section>

        {/* Low stock notice */}
        <div className="space-y-4">
          {lowStockList.length > 0 && (
            <Section title="Low Stock — Heads Up" href="/inventory">
              <div className="space-y-2">
                {lowStockList.map((item) => (
                  <div key={item.item_id ?? item.id} className="flex items-center gap-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-warning/25 bg-warning/10">
                      <Package className="h-3 w-3 text-warning" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-foreground truncate">{item.item_name ?? item.name}</p>
                      <p className="text-[10px] text-muted-foreground">{item.current_stock ?? item.quantity ?? 0} left · min {item.min_stock_level ?? item.reorder_level ?? 0}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Store overview tiles */}
          {!lHealth && health && (
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/20">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Store Overview</h3>
              </div>
              <div className="divide-y divide-border/40">
                {[
                  { label: "Today's Store Sales", value: formatCurrencyCompact(parseFloat(health.today_revenue ?? 0)) },
                  { label: "Transactions Today",  value: parseInt(health.today_transactions ?? 0, 10).toLocaleString() },
                  { label: "Low Stock Items",      value: parseInt(health.low_stock_count ?? 0, 10).toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className="text-[11px] font-bold tabular-nums text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCK KEEPER VIEW
// ─────────────────────────────────────────────────────────────────────────────
function StockKeeperView({ user, health, lHealth }) {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data: velocity, isLoading: lVel } = useStockVelocity({ limit: 20 });

  const { data: lowStockData, isLoading: lLow } = useQuery({
    queryKey: ["dash-low-stock-sk", storeId],
    queryFn:  () => getLowStock(storeId, 15),
    enabled:  !!storeId,
    staleTime: 60_000,
  });

  const velList  = useMemo(() => (Array.isArray(velocity) ? velocity : []), [velocity]);
  const lowList  = useMemo(() => lowStockData ?? [], [lowStockData]);
  const critical = useMemo(() => velList.filter((i) => i.reorder_urgency === "critical"), [velList]);
  const low      = useMemo(() => velList.filter((i) => i.reorder_urgency === "low"),      [velList]);

  const urgencyColors = {
    critical:   { bg: "bg-destructive/10 border-destructive/25", text: "text-destructive",     bar: "bg-destructive" },
    low:        { bg: "bg-warning/10 border-warning/25",         text: "text-warning",         bar: "bg-warning" },
    adequate:   { bg: "bg-success/10 border-success/25",         text: "text-success",         bar: "bg-success" },
    overstocked:{ bg: "bg-primary/10 border-primary/25",         text: "text-primary",         bar: "bg-primary" },
  };

  const maxDays = useMemo(() =>
    velList.reduce((m, i) => Math.max(m, Math.min(i.days_of_stock_remaining ?? 0, 90)), 1), [velList]);

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div className="rounded-xl border border-warning/20 bg-warning/4 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-bold text-foreground">{greeting()}, {[user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username || "there"}!</p>
              <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">Stock Keeper</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{niceDate()}</p>
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Low Stock Items"   loading={lHealth} href="/inventory"
          value={parseInt(health?.low_stock_count ?? 0, 10).toLocaleString()}
          alert={parseInt(health?.low_stock_count ?? 0, 10) > 0}
          sub="at or below reorder level" />
        <KpiTile label="Out of Stock"      loading={lHealth} href="/inventory"
          value={parseInt(health?.out_of_stock_count ?? 0, 10).toLocaleString()}
          alert={parseInt(health?.out_of_stock_count ?? 0, 10) > 0}
          sub="zero stock" />
        <KpiTile label="Pending POs"       loading={lHealth} href="/purchase-orders"
          value={parseInt(health?.pending_po_count ?? 0, 10).toLocaleString()}
          sub="awaiting receipt" />
        <KpiTile label="Critical Items"    loading={lVel}
          value={critical.length.toLocaleString()}
          alert={critical.length > 0}
          sub="< 7 days stock" />
      </div>

      {/* Critical items table */}
      <Section title={`Critical Stock — ${critical.length + low.length} items need attention`}
        href="/inventory" loading={lVel}
        empty={critical.length === 0 && low.length === 0}
        emptyMsg="No critical or low stock items — inventory looks healthy!">
        <div className="space-y-2">
          {[...critical, ...low].slice(0, 12).map((item, i) => {
            const urgency = item.reorder_urgency ?? "adequate";
            const colors  = urgencyColors[urgency] ?? urgencyColors.adequate;
            const days    = Math.min(item.days_of_stock_remaining ?? 0, 90);
            const barPct  = maxDays > 0 ? (days / maxDays) * 100 : 0;
            return (
              <div key={item.item_id ?? i} className={cn("flex items-center gap-3 rounded-lg border p-3", colors.bg)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[12px] font-semibold text-foreground truncate">{item.item_name}</p>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", colors.text)}>
                      {urgency}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>Stock: <strong className="text-foreground">{item.current_stock ?? 0}</strong></span>
                    <span>Avg daily: <strong className="text-foreground">{parseFloat(item.avg_daily_sales ?? 0).toFixed(1)}</strong></span>
                    <span className={cn("font-semibold", colors.text)}>
                      {days <= 0 ? "Stockout" : `${days}d left`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full rounded-full bg-muted/30 overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", colors.bar)}
                      style={{ width: `${barPct}%` }} />
                  </div>
                </div>
                <Link to="/purchase-orders/new"
                  className="shrink-0 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted/50 transition-colors">
                  Reorder
                </Link>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Low stock list + Quick links */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5">
        <Section title="Low Stock Items" href="/inventory" loading={lLow}
          empty={lowList.length === 0} emptyMsg="All items are well stocked">
          <div className="divide-y divide-border/40">
            {lowList.map((item) => {
              const qty = item.current_stock ?? item.quantity ?? 0;
              const min = item.min_stock_level ?? item.reorder_level ?? 0;
              const pct = min > 0 ? Math.min((qty / min) * 100, 100) : 100;
              return (
                <div key={item.item_id ?? item.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-warning/25 bg-warning/10">
                    <Package className="h-3.5 w-3.5 text-warning" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-foreground truncate">{item.item_name ?? item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="h-1 w-16 rounded-full bg-muted/30 overflow-hidden">
                        <div className="h-full rounded-full bg-warning" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{qty} / {min} min</span>
                    </div>
                  </div>
                  <span className={cn("text-[11px] font-semibold tabular-nums",
                    qty === 0 ? "text-destructive" : "text-warning",
                  )}>
                    {qty === 0 ? "OUT" : `${qty} left`}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        <div className="space-y-3">
          {[
            { icon: Boxes, label: "Inventory", sub: "View all stock levels", href: "/inventory", color: "text-warning" },
            { icon: ClipboardList, label: "Stock Counts", sub: "Start or review a count", href: "/stock-counts", color: "text-primary" },
            { icon: Package, label: "Purchase Orders", sub: "Pending receipts", href: "/purchase-orders", color: "text-success" },
            { icon: ArrowUpRight, label: "Stock Transfers", sub: "Move stock between stores", href: "/stock-transfers", color: "text-muted-foreground" },
          ].map(({ icon: Icon, label, sub, href, color }) => (
            <Link key={href} to={href} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 hover:bg-muted/20 transition-all duration-150">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
                <Icon className={cn("h-4 w-4", color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-foreground">{label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics navigation grid (shared by admin + manager)
// ─────────────────────────────────────────────────────────────────────────────
const NAV_CARDS = [
  { icon: TrendingUp,    title: "Sales",          sub: "Revenue, payments, peak hours",    href: "/analytics/sales",         color: "text-primary",    border: "border-primary/20 hover:border-primary/40 hover:bg-primary/4" },
  { icon: Package,       title: "Products",        sub: "Top items, margins, categories",   href: "/analytics/products",      color: "text-success",    border: "border-success/20 hover:border-success/40 hover:bg-success/4" },
  { icon: Boxes,         title: "Inventory",       sub: "Stock velocity, dead stock",        href: "/analytics/inventory",     color: "text-warning",    border: "border-warning/20 hover:border-warning/40 hover:bg-warning/4" },
  { icon: Users,         title: "Customers",       sub: "Retention, LTV, top spenders",      href: "/analytics/customers",     color: "text-primary",    border: "border-border/60 hover:border-primary/25 hover:bg-primary/4" },
  { icon: DollarSign,    title: "Profitability",   sub: "Margins, waterfall, net profit",    href: "/analytics/profitability", color: "text-success",    border: "border-success/20 hover:border-success/40 hover:bg-success/4" },
  { icon: BarChart3,     title: "Team",            sub: "Cashier rankings, void rates",      href: "/analytics/cashiers",      color: "text-primary",    border: "border-border/60 hover:border-primary/25 hover:bg-primary/4" },
];

function AnalyticsNavGrid({ role, compact }) {
  const cards = role === "manager" ? NAV_CARDS.slice(0, 4) : NAV_CARDS;
  return (
    <div className={cn(compact ? "space-y-2" : "space-y-3")}>
      {!compact && (
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-0.5">
          Detailed Analytics
        </h2>
      )}
      <div className={cn(compact ? "space-y-2" : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2")}>
        {cards.map(({ icon: Icon, title, sub, href, color, border }) => (
          <Link key={href} to={href}
            className={cn("flex items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-150", border)}>
            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20")}>
              <Icon className={cn("h-4 w-4", color)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-foreground">{title}</p>
              <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT PAGE — routes to correct role view
// ─────────────────────────────────────────────────────────────────────────────
export default function AnalyticsDashboardPage() {
  const user = useAuthStore((s) => s.user);

  const roleSlug      = user?.role_slug ?? "";
  const isAdmin       = ["super_admin", "admin"].includes(roleSlug);
  const isManager     = roleSlug === "manager";
  const isCashier     = roleSlug === "cashier";
  const isStockKeeper = roleSlug === "stock_keeper";

  const { data: health, isLoading: lHealth } = useBusinessHealthSummary();

  const pageTitle = isAdmin       ? "Business Dashboard"
    : isManager     ? "Store Dashboard"
    : isCashier     ? "My Dashboard"
    : isStockKeeper ? "Inventory Dashboard"
    : "Dashboard";

  const pageDesc = isAdmin       ? "Real-time overview of your business performance."
    : isManager     ? "Today's store activity and team performance."
    : isCashier     ? "Your shift, sales, and recent transactions."
    : isStockKeeper ? "Stock levels, alerts, and replenishment status."
    : "";

  return (
    <>
      <PageHeader
        title={pageTitle}
        description={pageDesc}
        action={isAdmin || isManager ? (
          <Link to="/analytics/reports">
            <Button variant="outline" size="sm" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              Full Reports
            </Button>
          </Link>
        ) : null}
      />

      <div className="flex-1 overflow-auto">
        <div className={cn("mx-auto px-6 py-5 space-y-5", isAdmin ? "max-w-7xl" : "max-w-5xl")}>
          {isAdmin       && <AdminView       user={user} health={health} lHealth={lHealth} />}
          {isManager     && <ManagerView     user={user} health={health} lHealth={lHealth} />}
          {isCashier     && <CashierView     user={user} health={health} lHealth={lHealth} />}
          {isStockKeeper && <StockKeeperView user={user} health={health} lHealth={lHealth} />}

          {/* Fallback for unknown roles */}
          {!isAdmin && !isManager && !isCashier && !isStockKeeper && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <ShieldAlert className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No dashboard available for your role.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
