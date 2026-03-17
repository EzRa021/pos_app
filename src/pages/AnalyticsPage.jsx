// pages/AnalyticsPage.jsx — Full analytics dashboard with tabs
import { useState } from "react";
import {
  BarChart3, TrendingUp, Package, Users, CreditCard, Star,
  DollarSign, ShoppingCart, RotateCcw, Award, AlertTriangle, Download,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

import { PageHeader }     from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { DataTable }      from "@/components/shared/DataTable";
import { EmptyState }     from "@/components/shared/EmptyState";
import { Button }         from "@/components/ui/button";
import { cn }             from "@/lib/utils";
import {
  useSalesSummary, useRevenueByPeriod, useItemAnalytics,
  useCategoryAnalytics, useProfitAnalysis, useProfitLossSummary,
  useCashierPerformance, usePeakHoursAnalysis,
  usePaymentMethodSummary, useSlowMovingItems, useDeadStock,
  useCustomerAnalytics, useReturnAnalysis, useDiscountAnalytics,
} from "@/features/analytics/useAnalytics";
import { formatCurrency, formatCurrencyCompact, formatDecimal, formatDate, formatQuantity } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants";

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "overview",      label: "Overview",      icon: BarChart3   },
  { id: "sales",         label: "Sales",         icon: TrendingUp  },
  { id: "products",      label: "Products",      icon: Package     },
  { id: "profitability", label: "Profitability", icon: DollarSign  },
  { id: "cashiers",      label: "Cashiers",      icon: Award       },
  { id: "inventory",     label: "Inventory",     icon: Package     },
  { id: "customers",     label: "Customers",     icon: Users       },
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

const CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"];

// ── Tab content components ────────────────────────────────────────────────────

function OverviewTab({ params }) {
  const { data: summary,   isLoading: l1 } = useSalesSummary(params);
  const { data: revenue,   isLoading: l2 } = useRevenueByPeriod({ ...params, period: "day" });
  const { data: payments,  isLoading: l3 } = usePaymentMethodSummary(params);

  const revenueData = (revenue ?? []).map((r) => ({
    name:    r.period_label,
    revenue: parseFloat(r.revenue ?? 0),
    txns:    r.transactions ?? 0,
  }));

  const paymentData = (payments ?? []).map((p) => ({
    name:  PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
    value: parseFloat(p.total ?? 0),
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Gross Sales"    value={formatCurrencyCompact(parseFloat(summary?.gross_sales    ?? 0))} icon={DollarSign}  accent="primary" sub={`${summary?.transactions_count ?? 0} transactions`} />
        <KPICard label="Net Sales"      value={formatCurrencyCompact(parseFloat(summary?.net_sales      ?? 0))} icon={TrendingUp}  accent="success" />
        <KPICard label="Avg Basket"     value={formatCurrency(parseFloat(summary?.avg_order_value       ?? 0))} icon={ShoppingCart} />
        <KPICard label="Total Discounts" value={formatCurrencyCompact(parseFloat(summary?.total_discounts ?? 0))} icon={Star} accent="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="col-span-2">
          <Section title="Revenue Trend">
            {l2 ? <div className="h-48 animate-pulse bg-muted/30 rounded-lg" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={revenueData}>
                  <defs>
                    <linearGradient id="rev-gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="url(#rev-gradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Section>
        </div>
        <Section title="Payment Methods">
          {l3 ? <div className="h-48 animate-pulse bg-muted/30 rounded-lg" /> : (
            paymentData.length === 0
              ? <EmptyState icon={CreditCard} title="No data" compact />
              : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={paymentData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {paymentData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topItemData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tickFormatter={(v) => formatCurrencyCompact(v)} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
        <Section title="Sales by Category">
          {l2 ? <div className="h-48 animate-pulse bg-muted/30 rounded-lg" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={catData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
  const { data: pl,     isLoading: l1 } = useProfitLossSummary(params);
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
          data={profit ?? []}
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
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={hourData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="hour" tick={{ fontSize: 8 }} />
            <YAxis tick={{ fontSize: 9 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} name="Transactions" />
          </BarChart>
        </ResponsiveContainer>
      </Section>

      <Section title="Cashier Performance">
        <DataTable
          columns={[
            { key: "cashier_name",      header: "Cashier",       render: (r) => <span className="text-xs font-semibold">{r.cashier_name}</span> },
            { key: "total_transactions",header: "Transactions",  align: "right", sortable: true, render: (r) => <span className="text-xs tabular-nums">{r.total_transactions ?? 0}</span> },
            { key: "total_value",       header: "Total Value",   align: "right", sortable: true, render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.total_value ?? 0))}</span> },
            { key: "avg_transaction",   header: "Avg Basket",    align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_transaction ?? 0))}</span> },
            { key: "voids_count",       header: "Voids",         align: "right", render: (r) => <span className={cn("text-xs tabular-nums", (r.voids_count ?? 0) > 0 ? "text-warning" : "text-muted-foreground")}>{r.voids_count ?? 0}</span> },
            { key: "total_discounts",   header: "Discounts",     align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.total_discounts ?? 0))}</span> },
          ]}
          data={cashiers ?? []}
          isLoading={isLoading}
          emptyState={<EmptyState icon={Award} title="No cashier data" compact />}
        />
      </Section>
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
        <KPICard label="Total Customers"   value={(data?.total_customers   ?? 0).toLocaleString()} icon={Users} />
        <KPICard label="Active This Period" value={(data?.active_customers  ?? 0).toLocaleString()} icon={TrendingUp} accent="success" />
        <KPICard label="Lapsed Customers"  value={(data?.lapsed_customers  ?? 0).toLocaleString()} icon={AlertTriangle} accent="warning" />
        <KPICard label="Avg Lifetime Value" value={formatCurrency(parseFloat(data?.avg_lifetime_value ?? 0))} icon={DollarSign} accent="primary" />
      </div>
      <Section title="Top Customers">
        <DataTable
          columns={[
            { key: "customer_name",    header: "Customer", render: (r) => <span className="text-xs font-semibold">{r.customer_name}</span> },
            { key: "visit_count",      header: "Visits",   align: "right", render: (r) => <span className="text-xs tabular-nums">{r.visit_count ?? 0}</span> },
            { key: "total_spent",      header: "Spent",    align: "right", sortable: true, render: (r) => <span className="text-xs font-mono font-bold tabular-nums">{formatCurrency(parseFloat(r.total_spent ?? 0))}</span> },
            { key: "avg_basket",       header: "Avg Basket",align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_basket ?? 0))}</span> },
          ]}
          data={data?.top_customers ?? []}
          isLoading={isLoading}
          emptyState={<EmptyState icon={Users} title="No customer data" compact />}
        />
      </Section>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [tab,      setTab]      = useState("overview");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");

  const params = {
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  };

  const renderTab = () => {
    switch (tab) {
      case "overview":      return <OverviewTab        params={params} />;
      case "sales":         return <SalesTab           params={params} />;
      case "profitability": return <ProfitabilityTab   params={params} />;
      case "cashiers":      return <CashiersTab        params={params} />;
      case "inventory":     return <InventoryTab       params={params} />;
      case "customers":     return <CustomersTab       params={params} />;
      default:              return <OverviewTab        params={params} />;
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Analytics"
        description="Sales insights, profitability analysis, and operational metrics."
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
