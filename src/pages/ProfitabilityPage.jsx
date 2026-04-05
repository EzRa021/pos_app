// pages/ProfitabilityPage.jsx — Profitability & P&L at /analytics/profitability
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { DollarSign, ArrowLeft, TrendingUp, TrendingDown, Tag } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell,
} from "recharts";

import { PageHeader }      from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { DataTable }       from "@/components/shared/DataTable";
import { EmptyState }      from "@/components/shared/EmptyState";
import { Button }          from "@/components/ui/button";
import { cn }              from "@/lib/utils";
import {
  useProfitLossSummary, useProfitAnalysis, useLowMarginItems,
} from "@/features/analytics/useAnalytics";
import { formatCurrency, formatCurrencyCompact, formatQuantity } from "@/lib/format";
import { ChartContainer, ChartTooltip, CurrencyTooltipContent } from "@/components/ui/chart";

const PROFIT_CHART_CONFIG = { profit: { label: "Gross Profit", color: "var(--chart-1)" } };

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

function KPICard({ label, value, sub, accent = "default", trend }) {
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
      <div className="flex items-center gap-1.5">
        {trend != null && (
          <>
            {trend > 0  && <TrendingUp   className="h-3 w-3 text-success" />}
            {trend < 0  && <TrendingDown className="h-3 w-3 text-destructive" />}
            <span className={cn("text-[11px] font-medium", trend > 0 ? "text-success" : trend < 0 ? "text-destructive" : "text-muted-foreground")}>
              {trend > 0 ? "+" : ""}{Math.abs(trend).toFixed(1)}%
            </span>
          </>
        )}
        {sub && !trend && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

// ── P&L Waterfall ─────────────────────────────────────────────────────────────
function PLWaterfall({ pl }) {
  const rows = useMemo(() => {
    if (!pl) return [];
    const v = (k) => parseFloat(pl[k] ?? 0);
    const gross    = v("gross_sales");
    const disc     = v("discounts");
    const netSales = v("net_sales");
    const cogs     = v("cogs");
    const grossP   = v("gross_profit");
    const expenses = v("expenses");
    const netP     = v("net_profit");

    const maxVal = Math.max(Math.abs(gross), 1);
    const pct    = (n) => Math.round((Math.abs(n) / maxVal) * 100);

    return [
      { label: "Gross Sales",    value: gross,    type: "positive", width: pct(gross),    formula: null },
      { label: "Discounts",      value: -disc,    type: "negative", width: pct(disc),     formula: "minus" },
      { label: "Net Sales",      value: netSales, type: "neutral",  width: pct(netSales), formula: "equals" },
      { label: "Cost of Goods",  value: -cogs,    type: "negative", width: pct(cogs),     formula: "minus" },
      { label: "Gross Profit",   value: grossP,   type: grossP >= 0 ? "positive" : "negative", width: pct(grossP), formula: "equals" },
      { label: "Expenses",       value: -expenses,type: "negative", width: pct(expenses), formula: "minus" },
      { label: "Net Profit",     value: netP,     type: netP >= 0  ? "positive" : "negative",  width: pct(netP),   formula: "equals" },
    ];
  }, [pl]);

  if (rows.length === 0) return <div className="h-48 animate-pulse rounded-lg bg-muted/30" />;

  const barColor = {
    positive: "bg-success",
    negative: "bg-destructive",
    neutral:  "bg-primary",
  };
  const textColor = {
    positive: "text-success",
    negative: "text-destructive",
    neutral:  "text-primary",
  };
  const formulaLabel = { minus: "−", equals: "=" };

  return (
    <div className="space-y-2.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-3">
          {/* Formula symbol */}
          <div className="w-4 text-center text-sm font-bold text-muted-foreground shrink-0">
            {row.formula ? formulaLabel[row.formula] : " "}
          </div>
          {/* Label */}
          <div className="w-32 text-xs font-semibold text-muted-foreground shrink-0 truncate">{row.label}</div>
          {/* Bar */}
          <div className="flex-1 h-6 rounded-sm bg-muted/20 overflow-hidden">
            <div
              className={cn("h-full rounded-sm transition-all duration-500", barColor[row.type])}
              style={{ width: `${Math.max(row.width, row.value !== 0 ? 2 : 0)}%`, opacity: 0.75 }}
            />
          </div>
          {/* Value */}
          <div className={cn("w-28 text-xs font-bold tabular-nums font-mono text-right shrink-0", textColor[row.type])}>
            {row.value < 0 ? "−" : ""}{formatCurrencyCompact(Math.abs(row.value))}
          </div>
        </div>
      ))}
    </div>
  );
}

function marginColor(m) {
  if (m < 5)  return "text-destructive";
  if (m < 20) return "text-warning";
  return "text-success";
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProfitabilityPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 15;

  const params = useMemo(() => ({
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  }), [dateFrom, dateTo]);

  const { data: pl,        isLoading: lPL       } = useProfitLossSummary(params);
  const { data: profit,    isLoading: lProfit   } = useProfitAnalysis({ ...params, limit: 50, sort_by: "gross_profit" });
  const { data: lowMargin, isLoading: lLowMargin } = useLowMarginItems({ ...params, min_margin_percent: 10 });

  const v = (k) => parseFloat(pl?.[k] ?? 0);

  const grossSales  = v("gross_sales");
  const netProfit   = v("net_profit");
  const grossProfit = v("gross_profit");
  const grossMargin = grossSales > 0 ? ((grossProfit / grossSales) * 100) : 0;
  const netMargin   = grossSales > 0 ? ((netProfit   / grossSales) * 100) : 0;

  const profitItems  = useMemo(() => Array.isArray(profit?.by_item) ? profit.by_item : [], [profit]);
  const lowList      = useMemo(() => Array.isArray(lowMargin) ? lowMargin : [], [lowMargin]);
  const belowCostCnt = useMemo(() => profitItems.filter((i) => parseFloat(i.margin_percent ?? 0) < 0).length, [profitItems]);
  const pagedItems   = useMemo(() => profitItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [profitItems, page]);

  const narrative = useMemo(() => {
    if (!pl) return null;
    const healthyRange = grossMargin >= 25 && grossMargin <= 40;
    const marginStatus = healthyRange ? "within the healthy retail range of 25–40%" :
      grossMargin < 25 ? "below the healthy retail target of 25–40% — consider reviewing pricing or costs" :
      "above the typical retail benchmark, which is strong — maintain cost controls";

    return (
      <>
        <p>
          Your gross margin is{" "}
          <strong className={cn(grossMargin < 10 ? "text-destructive" : grossMargin < 25 ? "text-warning" : "text-success")}>
            {grossMargin.toFixed(1)}%
          </strong>{" "}
          this period — {marginStatus}.
        </p>
        <p>
          After all expenses, your net profit is{" "}
          <strong className={cn(netProfit >= 0 ? "text-success" : "text-destructive")}>
            {formatCurrencyCompact(netProfit)}
          </strong>
          , representing a net margin of{" "}
          <strong className={cn(netMargin >= 0 ? "text-success" : "text-destructive")}>
            {netMargin.toFixed(1)}%
          </strong>.
        </p>
        {belowCostCnt > 0 && (
          <p>
            <strong className="text-destructive">{belowCostCnt} item{belowCostCnt !== 1 ? "s" : ""}</strong> are
            currently selling below cost price and need immediate attention.
          </p>
        )}
      </>
    );
  }, [pl, grossMargin, netProfit, netMargin, belowCostCnt]);

  const profitColumns = useMemo(() => [
    { key: "item_name",    header: "Product",      render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
    { key: "qty_sold",     header: "Qty Sold",     align: "right", render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.qty_sold ?? 0))}</span> },
    { key: "revenue",      header: "Revenue",      align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
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

  const lowMarginColumns = useMemo(() => [
    { key: "item_name",      header: "Product",    render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
    { key: "cost_price",     header: "Cost Price", align: "right", render: (r) => <span className="text-xs font-mono tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.cost_price ?? 0))}</span> },
    { key: "selling_price",  header: "Sell Price", align: "right", render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.selling_price ?? 0))}</span> },
    { key: "revenue",        header: "Revenue",    align: "right", render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrencyCompact(parseFloat(r.revenue ?? 0))}</span> },
    { key: "gross_profit",   header: "Gross Profit",align: "right", render: (r) => {
      const gp = parseFloat(r.gross_profit ?? 0);
      return <span className={cn("text-xs font-mono tabular-nums", gp >= 0 ? "text-success" : "text-destructive")}>{formatCurrency(gp)}</span>;
    }},
    { key: "margin_percent", header: "Margin %",   align: "right", sortable: true, render: (r) => {
      const m = parseFloat(r.margin_percent ?? 0);
      return <span className={cn("text-xs font-bold tabular-nums", marginColor(m))}>{m.toFixed(1)}%</span>;
    }},
  ], []);

  return (
    <>
      <PageHeader
        title="Profitability & P&L"
        description="Gross and net profit, waterfall breakdown, margin analysis, and low-margin items."
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
          <div className="rounded-xl border border-success/20 bg-success/[0.04] overflow-hidden">
            <div className="h-[3px] w-full bg-success" />
            <div className="flex gap-4 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-success/25 bg-success/10 text-success">
                <DollarSign className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-foreground mb-1.5">Profitability Summary</p>
                <div className="text-[12px] text-muted-foreground leading-relaxed space-y-1">
                  {lPL
                    ? <span className="animate-pulse">Calculating profitability…</span>
                    : (narrative ?? <span>No profitability data for this period.</span>)
                  }
                </div>
              </div>
            </div>
          </div>

          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              label="Gross Profit"
              value={lPL ? "—" : formatCurrencyCompact(grossProfit)}
              sub="revenue minus COGS"
              accent={grossProfit >= 0 ? "success" : "destructive"}
            />
            <KPICard
              label="Net Profit"
              value={lPL ? "—" : formatCurrencyCompact(netProfit)}
              sub="after all expenses"
              accent={netProfit >= 0 ? "success" : "destructive"}
            />
            <KPICard
              label="Gross Margin %"
              value={lPL ? "—" : `${grossMargin.toFixed(1)}%`}
              sub="of gross sales"
              accent={grossMargin < 10 ? "destructive" : grossMargin < 25 ? "warning" : "success"}
            />
            <KPICard
              label="Net Margin %"
              value={lPL ? "—" : `${netMargin.toFixed(1)}%`}
              sub="of gross sales"
              accent={netMargin < 0 ? "destructive" : netMargin < 5 ? "warning" : "success"}
            />
          </div>

          {/* P&L Waterfall */}
          <Section title="P&L Waterfall" description="Visual breakdown from gross sales to net profit">
            {lPL ? (
              <div className="h-48 animate-pulse rounded-lg bg-muted/30" />
            ) : (
              <PLWaterfall pl={pl} />
            )}
          </Section>

          {/* Summary stats row */}
          {pl && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Gross Sales</p>
                <p className="text-lg font-bold tabular-nums text-foreground">{formatCurrencyCompact(v("gross_sales"))}</p>
              </div>
              <div className="rounded-xl border border-destructive/20 bg-destructive/[0.04] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Discounts</p>
                <p className="text-lg font-bold tabular-nums text-destructive">−{formatCurrencyCompact(v("discounts"))}</p>
              </div>
              <div className="rounded-xl border border-destructive/20 bg-destructive/[0.04] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Cost of Goods</p>
                <p className="text-lg font-bold tabular-nums text-destructive">−{formatCurrencyCompact(v("cogs"))}</p>
              </div>
              <div className="rounded-xl border border-warning/20 bg-warning/[0.04] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Expenses</p>
                <p className="text-lg font-bold tabular-nums text-warning">−{formatCurrencyCompact(v("expenses"))}</p>
              </div>
            </div>
          )}

          {/* Top Profit Contributors chart */}
          {profitItems.length > 0 && !lProfit && (() => {
            const top10 = profitItems.slice(0, 10).map((item) => ({
              name:   item.item_name?.length > 18 ? item.item_name.slice(0, 18) + "…" : (item.item_name ?? ""),
              profit: parseFloat(item.gross_profit ?? 0),
              margin: parseFloat(item.margin_percent ?? 0),
            }));
            return (
              <Section
                title="Top 10 Profit Contributors"
                description="Items generating the most absolute gross profit — bar colour reflects margin quality"
              >
                <ChartContainer config={PROFIT_CHART_CONFIG} style={{ height: Math.max(220, top10.length * 26) }}>
                  <BarChart data={top10} layout="vertical">
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <YAxis type="category" dataKey="name" width={140} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <ChartTooltip content={<CurrencyTooltipContent formatFn={(val, _name, props) =>
                      `${formatCurrency(val)} (${props?.payload?.margin?.toFixed(1) ?? 0}% margin)`
                    } />} />
                    <Bar dataKey="profit" name="Gross Profit" radius={[0, 4, 4, 0]}>
                      {top10.map((item, i) => (
                        <Cell
                          key={i}
                          fill={item.margin >= 25 ? "#22c55e" : item.margin >= 10 ? "#3b82f6" : item.margin >= 0 ? "#f59e0b" : "#ef4444"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
                <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-muted-foreground">
                  {[["#22c55e","≥ 25% margin (strong)"],["#3b82f6","10–25% (healthy)"],["#f59e0b","0–10% (low)"],["#ef4444","Negative (selling below cost)"]].map(([color, label]) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </Section>
            );
          })()}

          {/* Margin Analysis Table */}
          <Section title="Item Margin Analysis" description="Per-item profitability — sorted by gross profit">
            <DataTable
              columns={profitColumns}
              data={pagedItems}
              isLoading={lProfit}
              emptyState={<EmptyState icon={DollarSign} title="No profitability data" description="Cost prices may not be configured." compact />}
              pagination={{ page, pageSize: PAGE_SIZE, total: profitItems.length, onPageChange: setPage }}
            />
          </Section>

          {/* Low Margin Items */}
          {(lowList.length > 0 || lLowMargin) && (
            <Section
              title="Low Margin Items"
              description="Products below 10% margin — consider price adjustment"
              action={<Tag className="h-4 w-4 text-muted-foreground opacity-40" />}
            >
              <DataTable
                columns={lowMarginColumns}
                data={lowList}
                isLoading={lLowMargin}
                emptyState={<EmptyState icon={Tag} title="No low-margin items" description="All products have healthy margins." compact />}
              />
            </Section>
          )}

          {/* Back link */}
          <div className="flex items-center gap-2 pt-2 pb-4">
            <Link to="/analytics"><Button variant="outline" size="sm" className="gap-1.5"><ArrowLeft className="h-3.5 w-3.5" />Business Health</Button></Link>
            <Link to="/price-management"><Button variant="outline" size="sm">Price Management</Button></Link>
          </div>

        </div>
      </div>
    </>
  );
}
