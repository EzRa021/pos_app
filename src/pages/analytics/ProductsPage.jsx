// pages/analytics/ProductsPage.jsx
import { useState, useMemo } from "react";
import { Package, Tag, DollarSign } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn }         from "@/lib/utils";
import { formatCurrency, formatCurrencyCompact, formatDecimal, formatQuantity, formatDate } from "@/lib/format";
import {
  useProfitAnalysis, useLowMarginItems, useSlowMovingItems,
} from "@/features/analytics/useAnalytics";
import { useAnalyticsDate }  from "@/features/analytics/AnalyticsLayout";
import {
  ChartCard, SectionHeader, TopNSelector, CurrencyFmtTooltip, CardShell,
} from "@/features/analytics/AnalyticsShared";

export default function ProductsPage() {
  const { params }      = useAnalyticsDate();
  const [topN, setTopN] = useState(10);
  const limit           = topN === 9999 ? 200 : topN;

  const { data: profit,  isLoading: l1, error: e1 } = useProfitAnalysis({ ...params, limit });
  const { data: lowMgn,  isLoading: l2 }             = useLowMarginItems({ ...params, limit: 20, threshold: 20 });
  const { data: slow,    isLoading: l3 }             = useSlowMovingItems({ ...params, limit: 25 });

  const profitData = useMemo(() => (profit?.by_item ?? []).slice(0, limit).map((i) => ({
    name:         (i.item_name ?? "").length > 22 ? i.item_name.slice(0, 20) + "…" : i.item_name,
    gross_profit: parseFloat(i.gross_profit ?? 0),
    revenue:      parseFloat(i.revenue      ?? 0),
  })), [profit, limit]);

  const catProfitData = useMemo(() => (profit?.by_category ?? []).slice(0, 8).map((c) => ({
    name:   (c.category_name ?? "").length > 14 ? c.category_name.slice(0, 12) + "…" : c.category_name,
    profit: parseFloat(c.gross_profit  ?? 0),
    margin: parseFloat(c.margin_percent ?? 0),
  })), [profit]);

  return (
    <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
      <SectionHeader
        icon={Package}
        title="Product Performance"
        description="Gross profit by item, low-margin alerts, and slow-moving inventory. Identify your best and worst performers."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top Items by Gross Profit" loading={l1} error={e1}
          action={<TopNSelector value={topN} onChange={setTopN} />}>
          {profitData.length === 0 ? <EmptyState icon={DollarSign} title="No profit data" compact /> : (
            <ResponsiveContainer width="100%" height={Math.max(160, profitData.length * 26)}>
              <BarChart data={profitData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <Tooltip content={<CurrencyFmtTooltip />} />
                <Bar dataKey="gross_profit" name="Gross Profit" fill="var(--chart-3)" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Gross Profit by Category" loading={l1}>
          {catProfitData.length === 0 ? <EmptyState icon={Tag} title="No category profit data" compact /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={catProfitData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <Tooltip content={<CurrencyFmtTooltip />} />
                <Bar dataKey="profit" name="Gross Profit" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Item profitability detail */}
      <ChartCard title="Item Profitability Detail" loading={l1} error={e1}>
        <DataTable
          columns={[
            { key: "item_name",     header: "Item",         render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "category_name", header: "Category",     render: (r) => <span className="text-[10px] text-muted-foreground">{r.category_name}</span> },
            { key: "qty_sold",      header: "Qty",          align: "right",
              render: (r) => <span className="text-xs tabular-nums">{formatDecimal(parseFloat(r.qty_sold ?? 0))}</span> },
            { key: "revenue",       header: "Revenue",      align: "right", sortable: true,
              render: (r) => <span className="text-xs tabular-nums font-mono">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
            { key: "cost_of_goods", header: "COGS",         align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground font-mono">{formatCurrency(parseFloat(r.cost_of_goods ?? 0))}</span> },
            { key: "gross_profit",  header: "Gross Profit", align: "right", sortable: true,
              render: (r) => {
                const p = parseFloat(r.gross_profit ?? 0);
                return <span className={cn("text-xs font-bold tabular-nums font-mono", p >= 0 ? "text-success" : "text-destructive")}>{formatCurrency(p)}</span>;
              }},
            { key: "margin_percent", header: "Margin",      align: "right",
              render: (r) => {
                const m = parseFloat(r.margin_percent ?? 0);
                return (
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full", m >= 30 ? "bg-success" : m >= 15 ? "bg-warning" : "bg-destructive")}
                           style={{ width: `${Math.min(Math.max(m, 0), 100)}%` }} />
                    </div>
                    <span className="text-xs tabular-nums w-10 text-right">{m.toFixed(1)}%</span>
                  </div>
                );
              }},
          ]}
          data={profit?.by_item ?? []}
          isLoading={l1}
          emptyState={<EmptyState icon={DollarSign} title="No profit data" compact />}
        />
      </ChartCard>

      {/* Low margin items */}
      <ChartCard title="Low Margin Items (Below 20%)" loading={l2}>
        <DataTable
          columns={[
            { key: "item_name",      header: "Item",        render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "category_name",  header: "Category",    render: (r) => <span className="text-[10px] text-muted-foreground">{r.category_name}</span> },
            { key: "selling_price",  header: "Price",       align: "right",
              render: (r) => <span className="text-xs tabular-nums font-mono">{formatCurrency(parseFloat(r.selling_price ?? 0))}</span> },
            { key: "cost_price",     header: "Cost",        align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground font-mono">{formatCurrency(parseFloat(r.cost_price ?? 0))}</span> },
            { key: "margin_percent", header: "Margin",      align: "right", sortable: true,
              render: (r) => {
                const m = parseFloat(r.margin_percent ?? 0);
                return <span className={cn("text-xs font-bold tabular-nums", m < 5 ? "text-destructive" : m < 15 ? "text-warning" : "text-muted-foreground")}>{m.toFixed(1)}%</span>;
              }},
            { key: "revenue",        header: "Revenue",     align: "right",
              render: (r) => <span className="text-xs tabular-nums font-mono text-muted-foreground">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
          ]}
          data={lowMgn ?? []}
          isLoading={l2}
          emptyState={<EmptyState icon={Tag} title="All margins healthy" description="No items below 20% margin." compact />}
        />
      </ChartCard>

      {/* Slow movers */}
      <ChartCard title="Slow-Moving Items" loading={l3}>
        <DataTable
          columns={[
            { key: "item_name",        header: "Item",       render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "category_name",    header: "Category",   render: (r) => <span className="text-[10px] text-muted-foreground">{r.category_name}</span> },
            { key: "qty_sold",         header: "Qty Sold",   align: "right",
              render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.qty_sold ?? 0), r.measurement_type, r.unit_type)}</span> },
            { key: "last_sold_at",     header: "Last Sale",
              render: (r) => <span className={cn("text-xs", !r.last_sold_at ? "text-destructive font-semibold" : "text-muted-foreground")}>{r.last_sold_at ? formatDate(r.last_sold_at) : "Never sold"}</span> },
            { key: "days_since_last_sale", header: "Days Idle", align: "right",
              render: (r) => {
                const d = r.days_since_last_sale;
                return <span className={cn("text-xs font-bold tabular-nums", d == null ? "text-destructive" : d > 60 ? "text-warning" : "text-muted-foreground")}>{d == null ? "∞" : `${d}d`}</span>;
              }},
            { key: "current_stock",    header: "In Stock",   align: "right",
              render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.current_stock ?? 0), r.measurement_type, r.unit_type)}</span> },
          ]}
          data={slow ?? []}
          isLoading={l3}
          emptyState={<EmptyState icon={Package} title="No slow-moving items" compact />}
        />
      </ChartCard>
    </div>
  );
}
