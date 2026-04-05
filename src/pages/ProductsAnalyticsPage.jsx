// pages/ProductsAnalyticsPage.jsx — Dedicated Product Performance page at /analytics/products
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Package, ArrowLeft, DollarSign, Tag, Star,
} from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
} from "recharts";

import { PageHeader }       from "@/components/shared/PageHeader";
import { DateRangePicker }  from "@/components/shared/DateRangePicker";
import { DataTable }        from "@/components/shared/DataTable";
import { EmptyState }       from "@/components/shared/EmptyState";
import { Button }           from "@/components/ui/button";
import { cn }               from "@/lib/utils";
import {
  useItemAnalytics, useCategoryAnalytics, useProfitAnalysis, useLowMarginItems,
} from "@/features/analytics/useAnalytics";
import { formatCurrency, formatCurrencyCompact, formatQuantity } from "@/lib/format";
import { ChartContainer, ChartTooltip, CurrencyTooltipContent, CHART_COLORS } from "@/components/ui/chart";

const BAR_CHART_CONFIG  = { revenue: { label: "Revenue", color: "var(--chart-1)" } };
const PIE_CHART_CONFIG  = {}; // dynamic — Cell fills use CHART_COLORS hex directly

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

function NarrativeBlock({ icon: Icon, title, children }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] overflow-hidden">
      <div className="h-[3px] w-full bg-primary" />
      <div className="flex gap-4 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-foreground mb-1.5">{title}</p>
          <div className="text-[12px] text-muted-foreground leading-relaxed space-y-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function marginColor(m) {
  if (m < 5)  return "text-destructive";
  if (m < 20) return "text-warning";
  return "text-success";
}

// ── Profitability zones ───────────────────────────────────────────────────────
function ProfitabilityZones({ items }) {
  const sorted = useMemo(() => {
    if (!Array.isArray(items) || items.length === 0) return { stars: [], core: [], review: [] };
    const sorted_ = [...items].sort((a, b) =>
      parseFloat(b.gross_profit ?? 0) - parseFloat(a.gross_profit ?? 0)
    );
    const quarter = Math.ceil(sorted_.length / 4);
    return {
      stars:  sorted_.slice(0, quarter),
      core:   sorted_.slice(quarter, quarter * 3),
      review: sorted_.slice(quarter * 3),
    };
  }, [items]);

  function ZoneRow({ item }) {
    const m = parseFloat(item.margin_percent ?? 0);
    return (
      <div className="flex items-center gap-3 py-1.5">
        <span className="flex-1 text-xs font-semibold text-foreground truncate">{item.item_name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{formatCurrencyCompact(parseFloat(item.revenue ?? 0))}</span>
        <span className={cn("text-xs font-bold tabular-nums w-14 text-right", marginColor(m))}>{m.toFixed(1)}%</span>
      </div>
    );
  }

  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Stars */}
      <div className="rounded-xl border border-success/25 bg-success/[0.04] overflow-hidden">
        <div className="px-4 py-3 border-b border-success/20 bg-success/[0.06]">
          <div className="flex items-center gap-2">
            <Star className="h-3.5 w-3.5 text-success" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-success">Stars</h4>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Top 25% by gross profit</p>
        </div>
        <div className="px-4 py-3 divide-y divide-border/40">
          {sorted.stars.map((item, i) => <ZoneRow key={i} item={item} />)}
        </div>
      </div>

      {/* Core */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Core</h4>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Middle 50%</p>
        </div>
        <div className="px-4 py-3 divide-y divide-border/40">
          {sorted.core.slice(0, 8).map((item, i) => <ZoneRow key={i} item={item} />)}
          {sorted.core.length > 8 && (
            <p className="text-[10px] text-muted-foreground py-1.5">+{sorted.core.length - 8} more items</p>
          )}
        </div>
      </div>

      {/* Review */}
      <div className="rounded-xl border border-destructive/25 bg-destructive/[0.04] overflow-hidden">
        <div className="px-4 py-3 border-b border-destructive/20 bg-destructive/[0.06]">
          <div className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-destructive" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-destructive">Review</h4>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Bottom 25% — may need repricing</p>
        </div>
        <div className="px-4 py-3 divide-y divide-border/40">
          {sorted.review.map((item, i) => <ZoneRow key={i} item={item} />)}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProductsAnalyticsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 15;

  const params = useMemo(() => ({
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  }), [dateFrom, dateTo]);

  const { data: items,     isLoading: lItems }    = useItemAnalytics({ ...params, limit: 50, sort_by: "revenue" });
  const { data: categories, isLoading: lCats }    = useCategoryAnalytics(params);
  const { data: profit,    isLoading: lProfit }   = useProfitAnalysis({ ...params, limit: 50, sort_by: "gross_profit" });
  const { data: lowMargin, isLoading: lLowMargin } = useLowMarginItems({ ...params, min_margin_percent: 10 });

  const itemList    = useMemo(() => Array.isArray(items)  ? items  : [], [items]);
  const profitItems = useMemo(() => Array.isArray(profit?.by_item) ? profit.by_item : [], [profit]);
  const catList     = useMemo(() => Array.isArray(categories) ? categories : [], [categories]);
  const lowList     = useMemo(() => Array.isArray(lowMargin) ? lowMargin : [], [lowMargin]);

  // Top 15 for bar chart
  const topChartData = useMemo(() =>
    itemList.slice(0, 15).map((i) => ({
      name:    i.item_name?.length > 18 ? i.item_name.slice(0, 18) + "…" : i.item_name,
      revenue: parseFloat(i.revenue ?? 0),
    })), [itemList]);

  const catChartData = useMemo(() =>
    catList.slice(0, 8).map((c) => ({
      name:  c.category_name,
      value: parseFloat(c.revenue ?? 0),
    })), [catList]);

  const catTotal = useMemo(() => catChartData.reduce((s, c) => s + c.value, 0), [catChartData]);

  // KPI values
  const topItem   = itemList[0];
  const totalRev  = useMemo(() => itemList.reduce((s, i) => s + parseFloat(i.revenue ?? 0), 0), [itemList]);
  const avgMargin = useMemo(() => {
    if (profitItems.length === 0) return 0;
    const sum = profitItems.reduce((s, i) => s + parseFloat(i.margin_percent ?? 0), 0);
    return sum / profitItems.length;
  }, [profitItems]);

  // Pagination for table
  const pagedItems = useMemo(() =>
    itemList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [itemList, page]);

  // Narrative
  const narrative = useMemo(() => {
    if (!topItem) return null;
    return (
      <>
        <p>
          Your top product this period is{" "}
          <strong className="text-foreground">{topItem.item_name}</strong>,
          sold <strong className="text-foreground">{formatQuantity(parseFloat(topItem.qty_sold ?? 0))}</strong> times
          and generating <strong className="text-foreground">{formatCurrencyCompact(parseFloat(topItem.revenue ?? 0))}</strong> in revenue.
        </p>
        {lowList.length > 0 && (
          <p>
            <strong className="text-warning">{lowList.length} item{lowList.length !== 1 ? "s" : ""}</strong> are
            currently below a 10% margin and may need repricing or cost review.
          </p>
        )}
        <p>
          Total product revenue this period:{" "}
          <strong className="text-foreground">{formatCurrencyCompact(totalRev)}</strong> across{" "}
          <strong className="text-foreground">{itemList.length}</strong> unique products.
          Average margin across analysed items:{" "}
          <strong className={cn(avgMargin < 10 ? "text-destructive" : avgMargin < 25 ? "text-warning" : "text-success")}>
            {avgMargin.toFixed(1)}%
          </strong>.
        </p>
      </>
    );
  }, [topItem, lowList, totalRev, itemList, avgMargin]);

  const columns = useMemo(() => [
    { key: "rank",        header: "#",          width: "36px", render: (_r, i) => <span className="text-[10px] font-bold text-muted-foreground tabular-nums">{(page - 1) * PAGE_SIZE + i + 1}</span> },
    { key: "item_name",   header: "Product",    render: (r) => <span className="text-xs font-semibold text-foreground">{r.item_name}</span> },
    { key: "category_name", header: "Category", render: (r) => <span className="text-[11px] text-muted-foreground">{r.category_name ?? "—"}</span> },
    { key: "qty_sold",    header: "Qty Sold",   align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.qty_sold ?? 0))}</span> },
    { key: "revenue",     header: "Revenue",    align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
    { key: "avg_price",   header: "Avg Price",  align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_price ?? 0))}</span> },
  ], [page]);

  const profitColumns = useMemo(() => [
    { key: "item_name",    header: "Product",      render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
    { key: "qty_sold",     header: "Qty Sold",     align: "right", render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.qty_sold ?? 0))}</span> },
    { key: "revenue",      header: "Revenue",      align: "right", sortable: true, render: (r) => <span className="text-xs font-mono tabular-nums font-bold">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
    { key: "cost_of_goods",header: "COGS",         align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.cost_of_goods ?? 0))}</span> },
    { key: "gross_profit", header: "Gross Profit", align: "right", sortable: true, render: (r) => {
      const gp = parseFloat(r.gross_profit ?? 0);
      return <span className={cn("text-xs font-mono font-bold tabular-nums", gp >= 0 ? "text-success" : "text-destructive")}>{formatCurrency(gp)}</span>;
    }},
    { key: "margin_percent",header: "Margin %",    align: "right", sortable: true, render: (r) => {
      const m = parseFloat(r.margin_percent ?? 0);
      return <span className={cn("text-xs font-bold tabular-nums", marginColor(m))}>{m.toFixed(1)}%</span>;
    }},
  ], []);

  return (
    <>
      <PageHeader
        title="Product Performance"
        description="Top products, profitability zones, category breakdown, and margin analysis."
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
          <NarrativeBlock icon={Package} title="Product Performance Summary">
            {lItems
              ? <span className="animate-pulse">Analysing your product data…</span>
              : (narrative ?? <span className="text-muted-foreground">No product data for this period.</span>)
            }
          </NarrativeBlock>

          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              label="Top Product"
              value={topItem?.item_name?.length > 14 ? topItem.item_name.slice(0, 14) + "…" : (topItem?.item_name ?? "—")}
              sub={topItem ? formatCurrencyCompact(parseFloat(topItem.revenue ?? 0)) : undefined}
              accent="primary"
            />
            <KPICard
              label="Items Sold"
              value={lItems ? "—" : itemList.length.toLocaleString()}
              sub="unique products"
              accent="default"
            />
            <KPICard
              label="Avg Margin"
              value={lProfit ? "—" : `${avgMargin.toFixed(1)}%`}
              sub="across all items"
              accent={avgMargin < 10 ? "destructive" : avgMargin < 25 ? "warning" : "success"}
            />
            <KPICard
              label="Total Revenue"
              value={lItems ? "—" : formatCurrencyCompact(totalRev)}
              sub="from products"
              accent="success"
            />
          </div>

          {/* ── Product Spotlight ─────────────────────────────────────────── */}
          {topItem && !lItems && (
            <div className="rounded-xl border border-success/25 bg-success/[0.04] overflow-hidden">
              <div className="h-[3px] w-full bg-success" />
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 px-5 py-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-success/30 bg-success/10 text-success text-base font-bold uppercase">
                  {(topItem.item_name ?? "").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Star className="h-3.5 w-3.5 text-warning" fill="currentColor" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-success">
                      Top Performing Product This Period
                    </span>
                  </div>
                  <p className="text-sm font-bold text-foreground leading-tight">{topItem.item_name}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Sold <strong className="text-foreground">{formatQuantity(parseFloat(topItem.qty_sold ?? 0))} units</strong>
                    {" · "}
                    Generated <strong className="text-foreground">{formatCurrencyCompact(parseFloat(topItem.revenue ?? 0))}</strong> in revenue
                    {" · "}
                    Average selling price of <strong className="text-foreground">{formatCurrency(parseFloat(topItem.avg_price ?? 0))}</strong>
                  </p>
                </div>
                <div className="text-right shrink-0 pl-2">
                  <p className="text-3xl font-bold tabular-nums text-success leading-none">
                    {totalRev > 0 ? `${((parseFloat(topItem.revenue ?? 0) / totalRev) * 100).toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">of total revenue</p>
                  {totalRev > 0 && parseFloat(topItem.revenue ?? 0) / totalRev > 0.3 && (
                    <p className="text-[10px] text-warning font-semibold mt-1">High concentration — high dependency risk</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Top Products bar chart + Category donut side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
            <Section title="Top 15 Products by Revenue" description="Click any bar to explore further">
              {lItems ? (
                <div className="h-72 animate-pulse rounded-lg bg-muted/30" />
              ) : topChartData.length === 0 ? (
                <EmptyState icon={Package} title="No product data" compact />
              ) : (
                <ChartContainer config={BAR_CHART_CONFIG} style={{ height: Math.max(280, topChartData.length * 22) }}>
                  <BarChart data={topChartData} layout="vertical">
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
                    <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                      {topChartData.map((_, i) => (
                        <rect key={i} fill={i === 0 ? "#22c55e" : CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </Section>

            {/* Category breakdown */}
            {catChartData.length > 0 && (
              <Section title="By Category">
                {lCats ? (
                  <div className="h-48 animate-pulse rounded-lg bg-muted/30" />
                ) : (
                  <>
                    <ChartContainer config={PIE_CHART_CONFIG} className="h-[180px]">
                      <PieChart>
                        <Pie
                          data={catChartData} dataKey="value" nameKey="name"
                          cx="50%" cy="50%" outerRadius={70} innerRadius={35}
                          paddingAngle={2}
                        >
                          {catChartData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
                      </PieChart>
                    </ChartContainer>
                    <div className="mt-2 space-y-1.5">
                      {catChartData.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="inline-block h-2 w-2 rounded-sm shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="flex-1 text-[11px] text-muted-foreground truncate">{c.name}</span>
                          <span className="text-[11px] font-semibold tabular-nums text-foreground">
                            {catTotal > 0 ? `${((c.value / catTotal) * 100).toFixed(0)}%` : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Section>
            )}
          </div>

          {/* Products Table */}
          <Section title="All Products" description={`${itemList.length} products`}>
            <DataTable
              columns={columns}
              data={pagedItems}
              isLoading={lItems}
              emptyState={<EmptyState icon={Package} title="No products found" compact />}
              pagination={{
                page, pageSize: PAGE_SIZE,
                total: itemList.length,
                onPageChange: setPage,
              }}
            />
          </Section>

          {/* Profitability Zones */}
          {profitItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                Profitability Zones
              </h3>
              {lProfit ? (
                <div className="h-48 animate-pulse rounded-lg bg-muted/30" />
              ) : (
                <ProfitabilityZones items={profitItems} />
              )}
            </div>
          )}

          {/* Margin Analysis Table */}
          <Section title="Margin Analysis" description="Per-item profitability breakdown">
            <DataTable
              columns={profitColumns}
              data={profitItems.slice(0, 20)}
              isLoading={lProfit}
              emptyState={<EmptyState icon={DollarSign} title="No profit data" description="Cost prices may not be set." compact />}
            />
          </Section>

          {/* Low Margin Items */}
          {(lowList.length > 0 || lLowMargin) && (
            <Section title="Low Margin Items" description="Products below 10% margin — consider repricing">
              <DataTable
                columns={[
                  { key: "item_name",      header: "Product",    render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
                  { key: "selling_price",  header: "Price",      align: "right", render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.selling_price ?? 0))}</span> },
                  { key: "cost_price",     header: "Cost",       align: "right", render: (r) => <span className="text-xs font-mono tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.cost_price ?? 0))}</span> },
                  { key: "revenue",        header: "Revenue",    align: "right", render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrencyCompact(parseFloat(r.revenue ?? 0))}</span> },
                  { key: "margin_percent", header: "Margin %",   align: "right", sortable: true, render: (r) => {
                    const m = parseFloat(r.margin_percent ?? 0);
                    return <span className={cn("text-xs font-bold tabular-nums", marginColor(m))}>{m.toFixed(1)}%</span>;
                  }},
                ]}
                data={lowList}
                isLoading={lLowMargin}
                emptyState={<EmptyState icon={Tag} title="No low-margin items" description="All products have healthy margins." compact />}
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
