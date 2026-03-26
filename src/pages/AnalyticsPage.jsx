// pages/AnalyticsPage.jsx — Full analytics dashboard with tabs
import { useState, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BarChart3, TrendingUp, Package, Users, CreditCard, Star, Tag,
  DollarSign, ShoppingCart, RotateCcw, Award, AlertTriangle,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";

import { PageHeader }     from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { DataTable }      from "@/components/shared/DataTable";
import { EmptyState }     from "@/components/shared/EmptyState";
import { Button }         from "@/components/ui/button";
import { cn }             from "@/lib/utils";
import {
  useSalesSummary, useRevenueByPeriod, useItemAnalytics,
  useCategoryAnalytics, useDepartmentAnalytics, useProfitAnalysis,
  useProfitLossSummary, useLowMarginItems, useStockVelocity,
  useCashierPerformance, usePeakHoursAnalysis,
  usePaymentMethodSummary, useSlowMovingItems, useDeadStock,
  useCustomerAnalytics, useReturnAnalysis, useDiscountAnalytics,
  useComparisonReport, useTaxReport, useBusinessHealthSummary,
} from "@/features/analytics/useAnalytics";
import { InsightFeed }      from "@/features/analytics/insights/InsightFeed";
import { computeInsights, filterInsights } from "@/features/analytics/insights";
import { formatCurrency, formatCurrencyCompact, formatDecimal, formatDate, formatQuantity } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { ChartContainer, ChartTooltip, CurrencyTooltipContent, CHART_COLORS } from "@/components/ui/chart";

const REV_CFG  = { revenue: { label: "Revenue",      color: "var(--chart-1)" } };
const BAR_CFG  = { revenue: { label: "Revenue",      color: "var(--chart-1)" } };
const CAT_CFG  = { revenue: { label: "Revenue",      color: "var(--chart-2)" } };
const HOUR_CFG = { count:   { label: "Transactions", color: "var(--chart-1)" } };
const DEPT_CFG = { revenue: { label: "Revenue",      color: "var(--chart-1)" }, qty: { label: "Qty Sold", color: "var(--chart-2)" } };

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "overview",      label: "Overview",      icon: BarChart3   },
  { id: "sales",         label: "Sales",         icon: TrendingUp  },
  { id: "products",      label: "Item Performance", icon: Package  },
  { id: "profitability", label: "Profitability", icon: DollarSign  },
  { id: "cashiers",      label: "Cashiers",      icon: Award       },
  { id: "inventory",     label: "Inventory",     icon: Package     },
  { id: "customers",     label: "Customers",     icon: Users       },
  { id: "discounts",     label: "Discounts",     icon: Tag         },
  { id: "returns",       label: "Returns",       icon: RotateCcw   },
  { id: "comparison",    label: "Comparison",    icon: TrendingUp  },
  { id: "tax",           label: "Tax Report",    icon: DollarSign  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, icon: Icon, accent = "default" }) {
  const ring = { default: "border-border/60 bg-card", success: "border-success/25 bg-success/5", warning: "border-warning/25 bg-warning/5", primary: "border-primary/25 bg-primary/5", destructive: "border-destructive/25 bg-destructive/5" }[accent];
  const val  = { default: "text-foreground", success: "text-success", warning: "text-warning", primary: "text-primary", destructive: "text-destructive" }[accent];
  return (
    <div className={cn("rounded-xl border px-4 py-4", ring)}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn("h-4 w-4 opacity-30", val)} />}
      </div>
      <p className={cn("text-2xl font-bold tabular-nums", val)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/20">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Tab content components ────────────────────────────────────────────────────

function OverviewTab({ params, insights }) {
  const { data: summary }                  = useSalesSummary(params);
  const { data: revenue,   isLoading: l2 } = useRevenueByPeriod({ ...params, period: "day" });
  const { data: payments,  isLoading: l3 } = usePaymentMethodSummary(params);

  const revenueData = useMemo(() => (revenue ?? []).map((r) => ({
    name:    r.period,
    revenue: parseFloat(r.revenue ?? 0),
    txns:    r.transactions ?? 0,
  })), [revenue]);

  const paymentData = useMemo(() => (payments ?? []).map((p) => ({
    name:  PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
    value: parseFloat(p.total ?? 0),
  })), [payments]);

  const overviewInsights = useMemo(() =>
    filterInsights(insights ?? [], ["sales_", "profitability_"], 3),
  [insights]);

  return (
    <div className="space-y-5">
      {overviewInsights.length > 0 && (
        <InsightFeed insights={overviewInsights} compact />
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Gross Sales"    value={formatCurrencyCompact(parseFloat(summary?.total_revenue   ?? 0))} icon={DollarSign}  accent="primary" sub={`${summary?.total_transactions ?? 0} transactions`} />
        <KPICard label="Net Sales"      value={formatCurrencyCompact(parseFloat(summary?.net_revenue     ?? 0))} icon={TrendingUp}  accent="success" />
        <KPICard label="Avg Basket"     value={formatCurrency(parseFloat(summary?.average_order          ?? 0))} icon={ShoppingCart} />
        <KPICard label="Total Discounts" value={formatCurrencyCompact(parseFloat(summary?.total_discounts ?? 0))} icon={Star} accent="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="col-span-2">
          <Section title="Revenue Trend">
            {l2 ? <div className="h-48 animate-pulse bg-muted/30 rounded-lg" /> : (
              <ChartContainer config={REV_CFG} className="h-[200px]">
                <AreaChart data={revenueData}>
                  <defs>
                    <linearGradient id="rev-gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--color-revenue)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
                  <Area type="monotone" dataKey="revenue" stroke="var(--color-revenue)" fill="url(#rev-gradient)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            )}
          </Section>
        </div>
        <Section title="Payment Methods">
          {l3 ? <div className="h-48 animate-pulse bg-muted/30 rounded-lg" /> : (
            paymentData.length === 0
              ? <EmptyState icon={CreditCard} title="No data" compact />
              : (
                <ChartContainer config={{}} className="h-[200px]">
                  <PieChart>
                    <Pie data={paymentData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {paymentData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
                  </PieChart>
                </ChartContainer>
              )
          )}
        </Section>
      </div>
    </div>
  );
}

function SalesTab({ params }) {
  const { data: items,      isLoading: l1 } = useItemAnalytics({ ...params, limit: 10, sort_by: "revenue" });
  const { data: categories, isLoading: l2 } = useCategoryAnalytics(params);

  const topItemData = (items ?? []).map((i) => ({ name: i.item_name, revenue: parseFloat(i.revenue ?? 0) }));
  const catData     = (categories ?? []).map((c) => ({ name: c.category_name, revenue: parseFloat(c.revenue ?? 0) }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Top Items by Revenue">
          {l1 ? <div className="h-48 animate-pulse bg-muted/30 rounded-lg" /> : (
            <ChartContainer config={BAR_CFG} className="h-[220px]">
              <BarChart data={topItemData} layout="vertical">
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis type="category" dataKey="name" width={100} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </Section>
        <Section title="Sales by Category">
          {l2 ? <div className="h-48 animate-pulse bg-muted/30 rounded-lg" /> : (
            <ChartContainer config={CAT_CFG} className="h-[220px]">
              <BarChart data={catData}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <ChartTooltip content={<CurrencyTooltipContent formatFn={formatCurrency} />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </Section>
      </div>

      {/* Top items table */}
      <Section title="Top Items Detail">
        <DataTable
          columns={[
            { key: "item_name", header: "Item",     render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "qty_sold",  header: "Qty Sold", align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums">{formatDecimal(r.qty_sold)}</span> },
            { key: "revenue",   header: "Revenue",  align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
            { key: "avg_price", header: "Avg Price",align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_price ?? 0))}</span> },
          ]}
          data={items ?? []}
          isLoading={l1}
          emptyState={<EmptyState icon={Package} title="No sales data" compact />}
        />
      </Section>
    </div>
  );
}

function ProfitabilityTab({ params }) {
  const { data: pl }                    = useProfitLossSummary(params);
  const { data: profit, isLoading: l2 } = useProfitAnalysis({ ...params, limit: 15, sort_by: "gross_profit" });

  const v = (k) => parseFloat(pl?.[k] ?? 0);

  return (
    <div className="space-y-5">
      {/* P&L waterfall */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Gross Sales"   value={formatCurrencyCompact(v("gross_sales"))}   accent="primary" icon={TrendingUp} />
        <KPICard label="Net Sales"     value={formatCurrencyCompact(v("net_sales"))}     accent="success" icon={DollarSign} />
        <KPICard label="Gross Profit"  value={formatCurrencyCompact(v("gross_profit"))}  accent={v("gross_profit") >= 0 ? "success" : "destructive"} />
        <KPICard label="Net Profit"    value={formatCurrencyCompact(v("net_profit"))}    accent={v("net_profit")   >= 0 ? "success" : "destructive"} />
      </div>

      <Section title="Item Profitability">
        <DataTable
          columns={[
            { key: "item_name",     header: "Item",         render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "qty_sold",      header: "Sold",         align: "right", render: (r) => <span className="text-xs tabular-nums">{formatDecimal(r.qty_sold)}</span> },
            { key: "revenue",       header: "Revenue",      align: "right", sortable: true, render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
            { key: "cost_of_goods", header: "COGS",         align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.cost_of_goods ?? 0))}</span> },
            { key: "gross_profit",  header: "Gross Profit", align: "right", sortable: true, render: (r) => { const p = parseFloat(r.gross_profit ?? 0); return <span className={cn("text-xs font-mono font-bold tabular-nums", p >= 0 ? "text-success" : "text-destructive")}>{formatCurrency(p)}</span>; } },
            { key: "margin_percent",header: "Margin",       align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums">{parseFloat(r.margin_percent ?? 0).toFixed(1)}%</span> },
          ]}
          data={profit?.by_item ?? []}
          isLoading={l2}
          emptyState={<EmptyState icon={DollarSign} title="No profit data" compact />}
        />
      </Section>
    </div>
  );
}

function CashiersTab({ params }) {
  const { data: cashiers, isLoading } = useCashierPerformance(params);
  const { data: peakHours } = usePeakHoursAnalysis(params);

  // Aggregate peak hours into a heatmap-style bar chart by hour
  const hourData = Array.from({ length: 24 }, (_, h) => ({
    hour:  `${h}:00`,
    count: 0,
    rev:   0,
  }));
  (peakHours ?? []).forEach((r) => {
    const h = r.hour_of_day ?? 0;
    hourData[h].count += r.transaction_count ?? 0;
    hourData[h].rev   += parseFloat(r.revenue ?? 0);
  });

  return (
    <div className="space-y-5">
      <Section title="Peak Hours">
        <ChartContainer config={HOUR_CFG} className="h-[160px]">
          <BarChart data={hourData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
            <ChartTooltip content={<CurrencyTooltipContent formatFn={(v) => String(v)} />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={[2, 2, 0, 0]} name="Transactions" />
          </BarChart>
        </ChartContainer>
      </Section>

      <Section title="Cashier Performance">
        <DataTable
          columns={[
            { key: "cashier_name",        header: "Cashier",       render: (r) => <span className="text-xs font-semibold">{r.cashier_name}</span> },
            { key: "transaction_count",  header: "Transactions",  align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums">{r.transaction_count ?? 0}</span> },
            { key: "total_sales",        header: "Total Sales",   align: "right", sortable: true, render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.total_sales ?? 0))}</span> },
            { key: "avg_transaction_value", header: "Avg Basket", align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_transaction_value ?? 0))}</span> },
            { key: "void_count",         header: "Voids",         align: "right", render: (r) => <span className={cn("text-xs tabular-nums", (r.void_count ?? 0) > 0 ? "text-warning" : "text-muted-foreground")}>{r.void_count ?? 0}</span> },
            { key: "total_discounts",    header: "Discounts",     align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.total_discounts ?? 0))}</span> },
          ]}
          data={cashiers ?? []}
          isLoading={isLoading}
          emptyState={<EmptyState icon={Award} title="No cashier data" compact />}
        />
      </Section>
    </div>
  );
}

function ProductsTab({ params }) {
  const { data: items,   isLoading: l1 } = useItemAnalytics({ ...params, limit: 25, sort_by: "qty" });
  const { data: depts,   isLoading: l2 } = useDepartmentAnalytics(params);
  const { data: lowMargin, isLoading: l3 } = useLowMarginItems({ ...params, limit: 20 });
  const { data: velocity,  isLoading: l4 } = useStockVelocity({ ...params, limit: 20 });

  const deptData = (depts ?? []).map((d) => ({
    name:    d.department_name,
    revenue: parseFloat(d.revenue ?? 0),
    qty:     parseFloat(d.qty_sold ?? 0),
  }));

  return (
    <div className="space-y-5">
      {/* Department breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Revenue by Department">
          {l2 ? <div className="h-48 animate-pulse bg-muted/30 rounded-lg" /> : (
            deptData.length === 0
              ? <EmptyState icon={Package} title="No department data" compact />
              : (
                <ChartContainer config={DEPT_CFG} className="h-[200px]">
                  <BarChart data={deptData}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <ChartTooltip content={<CurrencyTooltipContent formatFn={(v, name) => name === "revenue" ? formatCurrency(v) : String(formatDecimal(v))} />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="revenue" fill="var(--color-revenue)" name="Revenue"  radius={[4, 4, 0, 0]} />
                    <Bar dataKey="qty"     fill="var(--color-qty)"     name="Qty Sold" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              )
          )}
        </Section>

        <Section title="Low Margin Items">
          <DataTable
            columns={[
              { key: "item_name",      header: "Item",    render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
              { key: "selling_price",  header: "Price",   align: "right", render: (r) => <span className="text-xs tabular-nums font-mono">{formatCurrency(parseFloat(r.selling_price ?? 0))}</span> },
              { key: "cost_price",     header: "Cost",    align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground font-mono">{formatCurrency(parseFloat(r.cost_price ?? 0))}</span> },
              { key: "margin_percent", header: "Margin",  align: "right", sortable: true, render: (r) => {
                const m = parseFloat(r.margin_percent ?? 0);
                return <span className={cn("text-xs font-bold tabular-nums", m < 10 ? "text-destructive" : m < 20 ? "text-warning" : "text-success")}>{m.toFixed(1)}%</span>;
              }},
            ]}
            data={lowMargin ?? []}
            isLoading={l3}
            emptyState={<EmptyState icon={Tag} title="No low-margin items" description="All items have healthy margins." compact />}
          />
        </Section>
      </div>

      {/* Top items by qty sold */}
      <Section title="Top Items by Quantity Sold">
        <DataTable
          columns={[
            { key: "item_name",   header: "Item",       render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "category_name", header: "Category", render: (r) => <span className="text-xs text-muted-foreground">{r.category_name ?? "—"}</span> },
            { key: "qty_sold",    header: "Qty Sold",   align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums font-mono">{formatQuantity(parseFloat(r.qty_sold ?? 0), r.measurement_type, r.unit_type)}</span> },
            { key: "revenue",     header: "Revenue",    align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums font-mono font-bold">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
            { key: "avg_price",   header: "Avg Price",  align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_price ?? 0))}</span> },
          ]}
          data={items ?? []}
          isLoading={l1}
          emptyState={<EmptyState icon={Package} title="No product data" compact />}
        />
      </Section>

      {/* Stock velocity */}
      <Section title="Stock Velocity (Fastest Moving)">
        <DataTable
          columns={[
            { key: "item_name",        header: "Item",            render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "qty_sold",         header: "Qty Sold",        align: "right", render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.qty_sold ?? 0), r.measurement_type, r.unit_type)}</span> },
            { key: "current_stock",    header: "In Stock",        align: "right", render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.current_stock ?? 0), r.measurement_type, r.unit_type)}</span> },
            { key: "days_of_stock_remaining", header: "Days Left", align: "right", sortable: true, render: (r) => {
              const d = r.days_of_stock_remaining;
              return <span className={cn("text-xs font-bold tabular-nums", d == null ? "text-muted-foreground" : d < 7 ? "text-destructive" : d < 14 ? "text-warning" : "text-success")}>{d ?? "∞"}</span>;
            }},
          ]}
          data={velocity ?? []}
          isLoading={l4}
          emptyState={<EmptyState icon={Package} title="No stock velocity data" compact />}
        />
      </Section>
    </div>
  );
}

function DiscountsTab({ params }) {
  const { data, isLoading } = useDiscountAnalytics(params);

  const byItem    = (data?.by_item    ?? []).slice(0, 15);
  const byCashier = (data?.by_cashier ?? []).slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPICard label="Total Discounts Given" value={formatCurrencyCompact(parseFloat(data?.total_discounts_given           ?? 0))} icon={Tag}          accent="warning" />
        <KPICard label="Discounted Transactions" value={(data?.transactions_with_discounts ?? 0).toLocaleString()}                  icon={ShoppingCart} />
        <KPICard label="Avg Discount"            value={formatCurrency(parseFloat(data?.avg_discount_per_transaction ?? 0))}        icon={Tag} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Most Discounted Items">
          <DataTable
            columns={[
              { key: "item_name",          header: "Item",           render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
              { key: "tx_count",           header: "Transactions",   align: "right", render: (r) => <span className="text-xs tabular-nums">{r.tx_count ?? 0}</span> },
              { key: "total_discount",     header: "Total Discount", align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-warning">{formatCurrency(parseFloat(r.total_discount ?? 0))}</span> },
              { key: "avg_discount_amount",header: "Avg Discount",   align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_discount_amount ?? 0))}</span> },
            ]}
            data={byItem}
            isLoading={isLoading}
            emptyState={<EmptyState icon={Tag} title="No item discount data" description="No per-item discounts in this period." compact />}
          />
        </Section>

        <Section title="Discounts by Cashier">
          <DataTable
            columns={[
              { key: "cashier_name",       header: "Cashier",        render: (r) => <span className="text-xs font-semibold">{r.cashier_name}</span> },
              { key: "discount_count",     header: "Count",          align: "right", render: (r) => <span className="text-xs tabular-nums">{r.discount_count ?? 0}</span> },
              { key: "total_discounts",    header: "Total Given",    align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-warning">{formatCurrency(parseFloat(r.total_discounts ?? 0))}</span> },
              { key: "avg_discount_amount",header: "Avg Amount",     align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_discount_amount ?? 0))}</span> },
            ]}
            data={byCashier}
            isLoading={isLoading}
            emptyState={<EmptyState icon={Award} title="No cashier discount data" compact />}
          />
        </Section>
      </div>
    </div>
  );
}

function ReturnsTab({ params }) {
  const { data, isLoading } = useReturnAnalysis(params);

  const summary   = data?.summary   ?? {};
  const byItem    = (data?.by_item    ?? []).slice(0, 15);
  const byCashier = (data?.by_cashier ?? []).slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Total Return Value" value={formatCurrencyCompact(parseFloat(summary.total_return_value ?? 0))} icon={RotateCcw} accent="warning" />
        <KPICard label="Return Count"       value={(summary.return_count ?? 0).toLocaleString()}                      icon={RotateCcw} />
        <KPICard label="Return Rate"        value={`${parseFloat(summary.return_rate ?? 0).toFixed(1)}%`}             icon={TrendingUp} accent={parseFloat(summary.return_rate ?? 0) > 5 ? "destructive" : "default"} />
        <KPICard label="Items Returned"     value={formatDecimal(parseFloat(summary.items_returned ?? 0))}            icon={Package} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Most Returned Items">
          <DataTable
            columns={[
              { key: "item_name",          header: "Item",           render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
              { key: "total_returned",     header: "Qty Returned",   align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums">{formatDecimal(parseFloat(r.total_returned ?? 0))}</span> },
              { key: "return_rate_percent",header: "Return Rate",    align: "right", render: (r) => <span className="text-xs tabular-nums">{parseFloat(r.return_rate_percent ?? 0).toFixed(1)}%</span> },
              { key: "return_value",       header: "Value",          align: "right", render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-warning">{formatCurrency(parseFloat(r.return_value ?? 0))}</span> },
            ]}
            data={byItem}
            isLoading={isLoading}
            emptyState={<EmptyState icon={RotateCcw} title="No return data" description="No returns in this period." compact />}
          />
        </Section>

        <Section title="Returns by Cashier">
          <DataTable
            columns={[
              { key: "cashier_name",       header: "Cashier",        render: (r) => <span className="text-xs font-semibold">{r.cashier_name}</span> },
              { key: "total_return_count", header: "Total Returns",  align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums">{r.total_return_count ?? 0}</span> },
              { key: "refund_count",       header: "Refunds",        align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{r.refund_count ?? 0}</span> },
              { key: "total_return_value", header: "Total Value",    align: "right", render: (r) => <span className="text-xs font-mono tabular-nums text-warning">{formatCurrency(parseFloat(r.total_return_value ?? 0))}</span> },
            ]}
            data={byCashier}
            isLoading={isLoading}
            emptyState={<EmptyState icon={Award} title="No cashier return data" compact />}
          />
        </Section>
      </div>
    </div>
  );
}

function InventoryTab({ params }) {
  const { data: slow, isLoading: l1 } = useSlowMovingItems({ ...params, limit: 20 });
  const { data: dead, isLoading: l2 } = useDeadStock({ days: 60 });

  return (
    <div className="space-y-5">
      <Section title="Slow-Moving Items">
        <DataTable
          columns={[
            { key: "item_name",  header: "Item",      render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "qty_sold",   header: "Qty Sold",  align: "right", render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.qty_sold), r.measurement_type, r.unit_type)}</span> },
            { key: "last_sold_at", header: "Last Sale", render: (r) => <span className="text-xs text-muted-foreground">{r.last_sold_at ? formatDate(r.last_sold_at) : "Never"}</span> },
            { key: "current_stock", header: "Stock",  align: "right", render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.current_stock ?? 0), r.measurement_type, r.unit_type)}</span> },
          ]}
          data={slow ?? []}
          isLoading={l1}
          emptyState={<EmptyState icon={Package} title="No slow-moving items" compact />}
        />
      </Section>
      <Section title="Dead Stock (60 days)">
        <DataTable
          columns={[
            { key: "item_name",    header: "Item",      render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "current_stock",header: "Stock",     align: "right", render: (r) => <span className="text-xs tabular-nums text-warning">{formatQuantity(parseFloat(r.current_stock ?? 0), r.measurement_type, r.unit_type)}</span> },
            { key: "stock_value",  header: "Value",     align: "right", render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.stock_value_at_cost ?? 0))}</span> },
            { key: "days_of_stock",header: "Days Left", align: "right", render: (r) => <span className="text-xs tabular-nums text-destructive">{r.days_of_stock_remaining ?? "∞"}</span> },
          ]}
          data={dead ?? []}
          isLoading={l2}
          emptyState={<EmptyState icon={Package} title="No dead stock" description="All items have had recent sales." compact />}
        />
      </Section>
    </div>
  );
}

function CustomersTab({ params }) {
  const { data, isLoading } = useCustomerAnalytics(params);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Total Customers"    value={(data?.total_customers   ?? 0).toLocaleString()} icon={Users} />
        <KPICard label="Active (last 60d)"  value={(data?.active_customers  ?? 0).toLocaleString()} icon={TrendingUp} accent="success" />
        <KPICard label="Lapsed (60–365d)"   value={(data?.lapsed_customers  ?? 0).toLocaleString()} icon={AlertTriangle} accent={(data?.lapsed_customers ?? 0) > 0 ? "warning" : "default"} />
        <KPICard label="Avg Lifetime Value" value={formatCurrency(parseFloat(data?.avg_lifetime_value ?? 0))} icon={DollarSign} accent="primary" />
      </div>
      <Section title="Top Customers by Spend">
        <DataTable
          columns={[
            { key: "customer_name",    header: "Customer",   render: (r) => <span className="text-xs font-semibold">{r.customer_name}</span> },
            { key: "transaction_count",header: "Visits",     align: "right", render: (r) => <span className="text-xs tabular-nums">{r.transaction_count ?? 0}</span> },
            { key: "total_spent",      header: "Total Spent",align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums">{formatCurrency(parseFloat(r.total_spent ?? 0))}</span> },
            { key: "avg_basket_size",  header: "Avg Basket", align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_basket_size ?? 0))}</span> },
            { key: "days_since_last_purchase", header: "Last Purchase", align: "right", render: (r) => {
              const d = r.days_since_last_purchase;
              return <span className={cn("text-xs tabular-nums", d == null ? "text-muted-foreground" : d > 60 ? "text-warning" : "text-foreground")}>{d == null ? "—" : `${d}d ago`}</span>;
            }},
          ]}
          data={data?.top_customers ?? []}
          isLoading={isLoading}
          emptyState={<EmptyState icon={Users} title="No customer data" compact />}
        />
      </Section>
    </div>
  );
}

function ComparisonTab({ params }) {
  const { data, isLoading } = useComparisonReport(params);
  const metrics = data?.metrics ?? [];

  const fmtValue = (metric, val) => {
    const v = parseFloat(val ?? 0);
    return metric === "transaction_count" ? v.toLocaleString() : formatCurrency(v);
  };

  return (
    <div className="space-y-5">
      {data && (
        <div className="flex items-center gap-4 px-1 text-[11px] text-muted-foreground">
          <span className="font-bold text-foreground">{data.current_label}</span>
          <span>vs</span>
          <span>{data.previous_label}</span>
        </div>
      )}
      <Section title="Period Comparison">
        <DataTable
          columns={[
            { key: "metric",         header: "Metric",          render: (r) => <span className="text-xs font-semibold capitalize">{(r.metric ?? "").replace(/_/g, " ")}</span> },
            { key: "current_value",  header: data?.current_label  ?? "Current Period",  align: "right", render: (r) => <span className="text-xs font-mono tabular-nums font-bold">{fmtValue(r.metric, r.current_value)}</span> },
            { key: "previous_value", header: data?.previous_label ?? "Previous Period", align: "right", render: (r) => <span className="text-xs font-mono tabular-nums text-muted-foreground">{fmtValue(r.metric, r.previous_value)}</span> },
            { key: "change_percent", header: "Change",          align: "right", render: (r) => {
              const pct = parseFloat(r.change_percent ?? 0);
              return <span className={cn("text-xs font-bold tabular-nums", pct > 0 ? "text-success" : pct < 0 ? "text-destructive" : "text-muted-foreground")}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>;
            }},
            { key: "change_amount",  header: "Δ Amount",        align: "right", render: (r) => {
              const v = parseFloat(r.change_amount ?? 0);
              return <span className={cn("text-xs tabular-nums", v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground")}>{v >= 0 ? "+" : ""}{fmtValue(r.metric, r.change_amount)}</span>;
            }},
          ]}
          data={metrics}
          isLoading={isLoading}
          emptyState={<EmptyState icon={TrendingUp} title="No comparison data" description="Select a date range to compare periods." compact />}
        />
      </Section>
    </div>
  );
}

function TaxTab({ params }) {
  const { data, isLoading } = useTaxReport(params);
  const periodRows  = data?.period_rows      ?? [];
  const byCategory  = data?.vat_by_category  ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <KPICard label="Total VAT Collected" value={formatCurrencyCompact(parseFloat(data?.total_vat     ?? 0))} accent="primary" icon={DollarSign} sub={`${(data?.transaction_count ?? 0).toLocaleString()} transactions`} />
        <KPICard label="Gross Sales"          value={formatCurrencyCompact(parseFloat(data?.gross_sales   ?? 0))} accent="default" icon={TrendingUp} />
        <KPICard label="Net Sales (ex-VAT)"   value={formatCurrencyCompact(parseFloat(data?.net_sales     ?? 0))} accent="success" icon={ShoppingCart} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="VAT by Tax Category">
          <DataTable
            columns={[
              { key: "category_name", header: "Tax Category",  render: (r) => <span className="text-xs font-semibold">{r.category_name}</span> },
              { key: "rate",          header: "Rate",           align: "right", render: (r) => <span className="text-xs tabular-nums">{parseFloat(r.rate ?? 0).toFixed(1)}%</span> },
              { key: "taxable_sales", header: "Taxable Sales",  align: "right", render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.taxable_sales ?? 0))}</span> },
              { key: "vat_amount",    header: "VAT Amount",     align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-primary">{formatCurrency(parseFloat(r.vat_amount ?? 0))}</span> },
            ]}
            data={byCategory}
            isLoading={isLoading}
            emptyState={<EmptyState icon={DollarSign} title="No tax category data" description="Tax data will appear here after sales are recorded." compact />}
          />
        </Section>

        <Section title="VAT by Period">
          <DataTable
            columns={[
              { key: "period",             header: "Period",        render: (r) => <span className="text-xs font-semibold">{r.period}</span> },
              { key: "gross_sales",        header: "Gross Sales",   align: "right", render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.gross_sales ?? 0))}</span> },
              { key: "vat_collected",      header: "VAT Collected", align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-primary">{formatCurrency(parseFloat(r.vat_collected ?? 0))}</span> },
              { key: "transaction_count",  header: "Transactions",  align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{r.transaction_count ?? 0}</span> },
            ]}
            data={periodRows}
            isLoading={isLoading}
            emptyState={<EmptyState icon={DollarSign} title="No period data" compact />}
          />
        </Section>
      </div>
    </div>
  );
}

// ── Path → tab mapping ─────────────────────────────────────────────────────────
const PATH_TAB_MAP = {
  "/analytics/sales":          "sales",
  "/analytics/products":       "products",
  "/analytics/inventory":      "inventory",
  "/analytics/profitability":  "profitability",
  "/analytics/cashiers":       "cashiers",
  "/analytics/customers":      "customers",
  "/analytics/reports":        "overview",
};

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const location = useLocation();
  const initialTab = PATH_TAB_MAP[location.pathname] ?? "overview";
  const [tab,      setTab]      = useState(initialTab);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");

  const params = {
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  };

  // Fetch all data needed to power insights across tabs
  const { data: health }    = useBusinessHealthSummary();
  const { data: summary }   = useSalesSummary(params);
  const { data: velocity }  = useStockVelocity({ limit: 50 });
  const { data: deadStock } = useDeadStock({ days: 30 });
  const { data: cashiers }  = useCashierPerformance(params);
  const { data: discounts } = useDiscountAnalytics(params);
  const { data: returns }   = useReturnAnalysis(params);
  const { data: customers } = useCustomerAnalytics({ ...params, lapsed_days: 60 });
  const { data: items }     = useItemAnalytics({ ...params, limit: 10, sort_by: "revenue" });
  const { data: profit }    = useProfitAnalysis(params);
  const { data: pl }        = useProfitLossSummary(params);
  const { data: lowMargin } = useLowMarginItems({ ...params, min_margin_percent: 10 });
  const { data: comparison } = useComparisonReport({ metric: "revenue", period: "month" });

  const insights = useMemo(() => computeInsights({
    health, summary,
    items:   Array.isArray(items)     ? items     : null,
    profit,
    pl,
    lowMargin: Array.isArray(lowMargin) ? lowMargin : null,
    velocity:  Array.isArray(velocity)  ? velocity  : null,
    deadStock: Array.isArray(deadStock) ? deadStock : null,
    cashiers:  Array.isArray(cashiers)  ? cashiers  : null,
    discounts, returns, customers, comparison,
    maxInsights: 15,
  }), [health, summary, items, profit, pl, lowMargin, velocity, deadStock, cashiers, discounts, returns, customers, comparison]);

  const renderTab = () => {
    switch (tab) {
      case "overview":      return <OverviewTab        params={params} insights={insights} />;
      case "sales":         return <SalesTab           params={params} />;
      case "profitability": return <ProfitabilityTab   params={params} />;
      case "cashiers":      return <CashiersTab        params={params} />;
      case "inventory":     return <InventoryTab       params={params} />;
      case "products":      return <ProductsTab        params={params} />;
      case "customers":     return <CustomersTab       params={params} />;
      case "discounts":     return <DiscountsTab       params={params} />;
      case "returns":       return <ReturnsTab         params={params} />;
      case "comparison":    return <ComparisonTab      params={params} />;
      case "tax":           return <TaxTab             params={params} />;
      default:              return <OverviewTab        params={params} insights={insights} />;
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Analytics Reports"
        description="Sales insights, profitability analysis, and operational metrics."
        action={
          <div className="flex items-center gap-2">
            <Link to="/analytics">
              <Button variant="outline" size="sm">← Dashboard</Button>
            </Link>
            <DateRangePicker
              from={dateFrom} to={dateTo}
              onFromChange={setDateFrom} onToChange={setDateTo}
              onClear={() => { setDateFrom(""); setDateTo(""); }}
            />
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-5 space-y-5">

          {/* Tab bar */}
          <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 border border-border/60 overflow-x-auto flex-nowrap">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all shrink-0",
                    tab === t.id ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground",
                  )}>
                  <Icon className="h-3 w-3" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {renderTab()}
        </div>
      </div>
    </div>
  );
}
