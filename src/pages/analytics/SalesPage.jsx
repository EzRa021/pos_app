// pages/analytics/SalesPage.jsx
import { useState, useMemo } from "react";
import { TrendingUp, Package, Tag, DollarSign } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatCurrency, formatCurrencyCompact, formatDecimal, formatQuantity } from "@/lib/format";
import { useItemAnalytics, useCategoryAnalytics, useDepartmentAnalytics } from "@/features/analytics/useAnalytics";
import { useAnalyticsDate }  from "@/features/analytics/AnalyticsLayout";
import {
  CardShell, ChartCard, SectionHeader, TopNSelector, CurrencyFmtTooltip,
} from "@/features/analytics/AnalyticsShared";
import { useSalesSummary } from "@/features/analytics/useAnalytics";

export default function SalesPage() {
  const { params }      = useAnalyticsDate();
  const [topN, setTopN] = useState(10);
  const limit           = topN === 9999 ? 200 : topN;

  const { data: summary,    isLoading: ls } = useSalesSummary(params);
  const { data: items,      isLoading: l1, error: e1 } = useItemAnalytics({ ...params, limit });
  const { data: categories, isLoading: l2 }             = useCategoryAnalytics({ ...params, limit: 15 });
  const { data: depts,      isLoading: l3 }             = useDepartmentAnalytics({ ...params, limit: 10 });

  const s = (k) => parseFloat(summary?.[k] ?? 0);

  const topItemData = useMemo(() => (items ?? []).slice(0, limit).map((i) => ({
    name:    (i.item_name ?? "").length > 22 ? i.item_name.slice(0, 20) + "…" : i.item_name,
    revenue: parseFloat(i.revenue  ?? 0),
    qty:     parseFloat(i.qty_sold ?? 0),
  })), [items, limit]);

  const catData = useMemo(() => (categories ?? []).slice(0, 10).map((c) => ({
    name:    (c.category_name ?? "").length > 14 ? c.category_name.slice(0, 12) + "…" : c.category_name,
    revenue: parseFloat(c.revenue ?? 0),
  })), [categories]);

  const deptData = useMemo(() => (depts ?? []).slice(0, 8).map((d) => ({
    name:    (d.department_name ?? "").length > 14 ? d.department_name.slice(0, 12) + "…" : d.department_name,
    revenue: parseFloat(d.revenue  ?? 0),
    qty:     parseFloat(d.qty_sold ?? 0),
  })), [depts]);

  return (
    <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
      <SectionHeader
        icon={TrendingUp}
        title="Sales Performance"
        description="Revenue and transaction volume across items, categories, and departments."
      />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CardShell label="Gross Sales"    value={ls ? "—" : formatCurrencyCompact(s("total_revenue"))}   sub={`${summary?.total_transactions ?? 0} txns`} icon={DollarSign} accent="primary" />
        <CardShell label="Net Sales"      value={ls ? "—" : formatCurrencyCompact(s("net_revenue"))}     icon={TrendingUp} accent="success" />
        <CardShell label="Total Items"    value={ls ? "—" : formatDecimal(parseFloat(summary?.total_items_sold ?? 0))} icon={Package} />
        <CardShell label="Avg Basket"     value={ls ? "—" : formatCurrency(s("average_order"))}          icon={Tag} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top Items by Revenue" loading={l1} error={e1}
          action={<TopNSelector value={topN} onChange={setTopN} />}>
          {topItemData.length === 0 ? <EmptyState icon={Package} title="No item data" compact /> : (
            <ResponsiveContainer width="100%" height={Math.max(160, topItemData.length * 26)}>
              <BarChart data={topItemData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <Tooltip content={<CurrencyFmtTooltip />} />
                <Bar dataKey="revenue" name="Revenue" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Revenue by Category" loading={l2}>
          {catData.length === 0 ? <EmptyState icon={Tag} title="No category data" compact /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={catData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <Tooltip content={<CurrencyFmtTooltip />} />
                <Bar dataKey="revenue" name="Revenue" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Department chart */}
      <ChartCard title="Revenue by Department" loading={l3}>
        {deptData.length === 0 ? <EmptyState icon={Package} title="No department data" compact /> : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={deptData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
              <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
              <Tooltip content={<CurrencyFmtTooltip />} />
              <Bar dataKey="revenue" name="Revenue"  fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="qty"     name="Qty Sold" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Item detail table */}
      <ChartCard title="Item Sales Detail" loading={l1} error={e1}>
        <DataTable
          columns={[
            { key: "item_name", header: "Item",      render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "sku",       header: "SKU",       render: (r) => <span className="text-[10px] font-mono text-muted-foreground">{r.sku}</span> },
            { key: "qty_sold",  header: "Qty Sold",  align: "right", sortable: true,
              render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.qty_sold ?? 0), r.measurement_type, r.unit_type)}</span> },
            { key: "avg_price", header: "Avg Price", align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_price ?? 0))}</span> },
            { key: "revenue",   header: "Revenue",   align: "right", sortable: true,
              render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-primary">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
          ]}
          data={items ?? []}
          isLoading={l1}
          emptyState={<EmptyState icon={Package} title="No sales data" compact />}
        />
      </ChartCard>
    </div>
  );
}
