// pages/CustomersAnalyticsPage.jsx — Customer Intelligence at /analytics/customers
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Users, ArrowLeft, DollarSign, TrendingDown, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

import { PageHeader }      from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { DataTable }       from "@/components/shared/DataTable";
import { EmptyState }      from "@/components/shared/EmptyState";
import { Button }          from "@/components/ui/button";
import { cn }              from "@/lib/utils";
import { useCustomerAnalytics } from "@/features/analytics/useAnalytics";
import { formatCurrency, formatCurrencyCompact, formatDate } from "@/lib/format";
import { ChartContainer, ChartTooltip, CurrencyTooltipContent, CHART_COLORS } from "@/components/ui/chart";

const FREQ_CHART_CONFIG = { count: { label: "Customers", color: "var(--chart-1)" } };

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

function daysSinceColor(days) {
  if (days == null) return "text-muted-foreground";
  if (days < 14)  return "text-success";
  if (days < 60)  return "text-warning";
  return "text-destructive";
}

// ── Purchase frequency buckets ────────────────────────────────────────────────
function buildFrequencyBuckets(topCustomers) {
  const buckets = { "1": 0, "2–3": 0, "4–10": 0, "10+": 0 };
  topCustomers.forEach((c) => {
    const n = c.transaction_count ?? 0;
    if (n === 1)       buckets["1"]++;
    else if (n <= 3)   buckets["2–3"]++;
    else if (n <= 10)  buckets["4–10"]++;
    else               buckets["10+"]++;
  });
  return Object.entries(buckets).map(([label, count]) => ({ label, count }));
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CustomersAnalyticsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 20;

  const params = useMemo(() => ({
    date_from:   dateFrom || undefined,
    date_to:     dateTo   || undefined,
    lapsed_days: 90,
  }), [dateFrom, dateTo]);

  const { data, isLoading } = useCustomerAnalytics(params);

  const topCustomers = useMemo(() => data?.top_customers ?? [], [data]);
  const totalCust    = data?.total_customers  ?? 0;
  const activeCust   = data?.active_customers ?? 0;
  const lapsedCust   = data?.lapsed_customers ?? 0;
  const avgLTV       = parseFloat(data?.avg_lifetime_value ?? 0);

  const freqData = useMemo(() => buildFrequencyBuckets(topCustomers), [topCustomers]);
  const repeatBuyers = useMemo(() => {
    const repeat = topCustomers.filter((c) => (c.transaction_count ?? 0) > 1).length;
    return topCustomers.length > 0 ? ((repeat / topCustomers.length) * 100).toFixed(0) : 0;
  }, [topCustomers]);

  // Pareto analysis — top 20% of customers and their revenue share
  const pareto = useMemo(() => {
    if (topCustomers.length < 5) return null;
    const sorted      = [...topCustomers].sort((a, b) => parseFloat(b.total_spent ?? 0) - parseFloat(a.total_spent ?? 0));
    const totalRev    = sorted.reduce((s, c) => s + parseFloat(c.total_spent ?? 0), 0);
    if (totalRev === 0) return null;
    const top20count  = Math.max(1, Math.ceil(sorted.length * 0.2));
    const top20rev    = sorted.slice(0, top20count).reduce((s, c) => s + parseFloat(c.total_spent ?? 0), 0);
    const top20pct    = ((top20rev / totalRev) * 100).toFixed(1);
    const topCust     = sorted[0];
    const topCustPct  = ((parseFloat(topCust?.total_spent ?? 0) / totalRev) * 100).toFixed(1);
    return { top20count, top20rev, top20pct: parseFloat(top20pct), totalRev, totalCount: sorted.length, topCust, topCustPct: parseFloat(topCustPct) };
  }, [topCustomers]);

  const pagedCustomers = useMemo(() =>
    topCustomers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  , [topCustomers, page]);

  const narrative = useMemo(() => {
    if (!data) return null;
    return (
      <>
        <p>
          You have <strong className="text-foreground">{activeCust.toLocaleString()} active customers</strong> who
          purchased within the last 90 days, out of{" "}
          <strong className="text-foreground">{totalCust.toLocaleString()} total customers</strong> on record.
        </p>
        {lapsedCust > 0 && (
          <p>
            <strong className="text-warning">{lapsedCust.toLocaleString()} customers</strong> are
            lapsed — they bought previously but have not returned recently. Consider a re-engagement campaign.
          </p>
        )}
        <p>
          Your average customer lifetime value is{" "}
          <strong className="text-foreground">{formatCurrency(avgLTV)}</strong>, and{" "}
          <strong className="text-foreground">{repeatBuyers}%</strong> of tracked customers
          are repeat buyers — a strong indicator of loyalty.
        </p>
      </>
    );
  }, [data, activeCust, totalCust, lapsedCust, avgLTV, repeatBuyers]);

  const columns = useMemo(() => [
    { key: "rank",          header: "#",            width: "36px", render: (r, i) => <span className="text-[10px] font-bold text-muted-foreground tabular-nums">{(page - 1) * PAGE_SIZE + i + 1}</span> },
    { key: "customer_name", header: "Customer",     render: (r) => (
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-[10px] font-bold uppercase text-primary">
          {(r.customer_name ?? "?").slice(0, 2).toUpperCase()}
        </div>
        <span className="text-xs font-semibold">{r.customer_name}</span>
      </div>
    )},
    { key: "transaction_count",header: "Visits",      align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums">{r.transaction_count ?? 0}</span> },
    { key: "total_spent",      header: "Total Spent", align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums">{formatCurrency(parseFloat(r.total_spent ?? 0))}</span> },
    { key: "avg_basket_size",  header: "Avg Basket",  align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_basket_size ?? 0))}</span> },
    { key: "last_purchase_date",header: "Last Visit", render: (r) => <span className="text-[11px] text-muted-foreground">{r.last_purchase_date ? formatDate(r.last_purchase_date) : "—"}</span> },
    { key: "days_since_last_purchase", header: "Days Since", align: "right", sortable: true, render: (r) => {
      const d = r.days_since_last_purchase;
      return <span className={cn("text-xs font-semibold tabular-nums", daysSinceColor(d))}>{d != null ? `${d}d` : "—"}</span>;
    }},
  ], [page]);

  return (
    <>
      <PageHeader
        title="Customer Intelligence"
        description="Customer retention, lifetime value, purchase frequency, and top spenders."
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
          <div className="rounded-xl border border-primary/20 bg-primary/[0.04] overflow-hidden">
            <div className="h-[3px] w-full bg-primary" />
            <div className="flex gap-4 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-foreground mb-1.5">Customer Overview</p>
                <div className="text-[12px] text-muted-foreground leading-relaxed space-y-1">
                  {isLoading
                    ? <span className="animate-pulse">Loading customer data…</span>
                    : (narrative ?? <span>No customer data for this period.</span>)
                  }
                </div>
              </div>
            </div>
          </div>

          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard label="Total Customers"    value={totalCust.toLocaleString()}   sub="all time"         accent="primary" />
            <KPICard label="Active (90 days)"   value={activeCust.toLocaleString()}  sub="purchased recently" accent="success" />
            <KPICard label="Lapsed"             value={lapsedCust.toLocaleString()}  sub="not visited recently" accent={lapsedCust > 0 ? "warning" : "default"} />
            <KPICard label="Avg Lifetime Value" value={formatCurrencyCompact(avgLTV)} sub="per customer"    accent="default" />
          </div>

          {/* ── Pareto Analysis ──────────────────────────────────────────────── */}
          {pareto && (
            <div className="rounded-xl border border-primary/20 bg-primary/4 overflow-hidden">
              <div className="h-0.75 w-full bg-primary" />
              <div className="px-5 py-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary mb-2">
                  Revenue Concentration Analysis (Pareto Principle)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Top 20% of Customers</p>
                    <p className="text-xl font-bold text-foreground tabular-nums">{pareto.top20count} people</p>
                    <p className="text-[11px] text-muted-foreground">out of {pareto.totalCount} tracked</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Their Revenue Share</p>
                    <p className={`text-xl font-bold tabular-nums ${pareto.top20pct > 70 ? "text-warning" : "text-primary"}`}>
                      {pareto.top20pct}%
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatCurrencyCompact(pareto.top20rev)} of {formatCurrencyCompact(pareto.totalRev)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Single Top Customer</p>
                    <p className="text-xl font-bold text-foreground tabular-nums">{pareto.topCustPct}%</p>
                    <p className="text-[11px] text-muted-foreground truncate">{pareto.topCust?.customer_name ?? "—"}</p>
                  </div>
                </div>
                {/* Visual concentration bar */}
                <div className="rounded-full h-2 w-full bg-muted/40 overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${pareto.top20pct}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                  {pareto.top20pct > 70
                    ? `⚠️ High revenue concentration — your top ${pareto.top20count} customers drive ${pareto.top20pct}% of revenue. Losing any of them would significantly impact your business. Build stronger loyalty programs for this group.`
                    : `Your revenue is moderately distributed. Your top ${pareto.top20count} customers (20%) account for ${pareto.top20pct}% of revenue — a healthy spread that reduces single-customer dependency.`
                  }
                </p>
              </div>
            </div>
          )}

          {/* Top Customers Table */}
          <Section title="Top Customers by Spend" description={`${topCustomers.length} customers tracked`}>
            <DataTable
              columns={columns}
              data={pagedCustomers}
              isLoading={isLoading}
              emptyState={<EmptyState icon={Users} title="No customer data" description="Customer analytics will appear as transactions are recorded." compact />}
              pagination={{ page, pageSize: PAGE_SIZE, total: topCustomers.length, onPageChange: setPage }}
            />
          </Section>

          {/* Purchase Frequency Chart */}
          <Section
            title="Purchase Frequency Distribution"
            description={`${repeatBuyers}% of tracked customers are repeat buyers`}
          >
            {isLoading ? (
              <div className="h-48 animate-pulse rounded-lg bg-muted/30" />
            ) : topCustomers.length === 0 ? (
              <EmptyState icon={BarChart3} title="No frequency data" compact />
            ) : (
              <ChartContainer config={FREQ_CHART_CONFIG} className="h-[180px]">
                <BarChart data={freqData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <ChartTooltip content={<CurrencyTooltipContent formatFn={(v) => `${v} customers`} />} />
                  <Bar dataKey="count" name="Customers" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </Section>

          {/* Credit Risk Panel (if lapsed data suggests credit issues) */}
          {lapsedCust > 0 && (
            <div className="rounded-xl border border-warning/25 bg-warning/[0.04] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-warning/20 flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-warning" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-warning">
                  Lapsed Customer Alert
                </h3>
              </div>
              <div className="p-5">
                <p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
                  <strong className="text-warning">{lapsedCust} customers</strong> have not
                  visited in over 90 days. Reaching out with a personalised offer could recover
                  a portion of this revenue.
                  {avgLTV > 0 && (
                    <> The potential recovery value (at avg LTV) is approximately{" "}
                      <strong className="text-foreground">
                        {formatCurrencyCompact(lapsedCust * avgLTV)}
                      </strong>.
                    </>
                  )}
                </p>
                <div className="flex items-center gap-3">
                  <Link to="/customers">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      View Customers
                    </Button>
                  </Link>
                  <Link to="/credit-sales">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <DollarSign className="h-3.5 w-3.5" />
                      Credit Sales
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
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
