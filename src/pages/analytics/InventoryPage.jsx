// pages/analytics/InventoryPage.jsx
import { useState, useMemo } from "react";
import { Box } from "lucide-react";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn }         from "@/lib/utils";
import { formatCurrency, formatCurrencyCompact, formatQuantity } from "@/lib/format";
import { useStockVelocity, useDeadStock } from "@/features/analytics/useAnalytics";
import { useAnalyticsDate }               from "@/features/analytics/AnalyticsLayout";
import { ChartCard, SectionHeader, TopNSelector, CardShell } from "@/features/analytics/AnalyticsShared";

const URGENCY = {
  critical:    { label: "Critical",    bg: "bg-destructive/10", text: "text-destructive", border: "border-destructive/25" },
  low:         { label: "Low",         bg: "bg-warning/10",     text: "text-warning",     border: "border-warning/25"     },
  adequate:    { label: "Adequate",    bg: "bg-success/10",     text: "text-success",     border: "border-success/25"     },
  overstocked: { label: "Overstocked", bg: "bg-primary/10",     text: "text-primary",     border: "border-primary/25"     },
  no_sales:    { label: "No Sales",    bg: "bg-muted/30",       text: "text-muted-foreground", border: "border-border/50" },
};

export default function InventoryPage() {
  const { params }      = useAnalyticsDate();
  const [topN, setTopN] = useState(20);
  const limit           = topN === 9999 ? 500 : topN;

  const { data: velocity, isLoading: l1 } = useStockVelocity({ ...params, limit });
  const { data: dead,     isLoading: l2 } = useDeadStock({ days: 60 });

  const summary = useMemo(() => {
    const counts = { critical: 0, low: 0, adequate: 0, overstocked: 0, no_sales: 0 };
    (velocity ?? []).forEach((i) => { counts[i.reorder_urgency] = (counts[i.reorder_urgency] ?? 0) + 1; });
    return counts;
  }, [velocity]);

  const deadStockValue = useMemo(() =>
    (dead ?? []).reduce((acc, i) => acc + parseFloat(i.stock_value ?? 0), 0)
  , [dead]);

  return (
    <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
      <SectionHeader
        icon={Box}
        title="Inventory Health"
        description="Stock velocity, days remaining, reorder urgency levels, and dead stock identification."
      />

      {/* Urgency summary */}
      {!l1 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {Object.entries(URGENCY).map(([key, cfg]) => (
            <div key={key} className={cn("rounded-xl border px-3 py-2.5 flex flex-col gap-1", cfg.bg, cfg.border)}>
              <p className={cn("text-xl font-bold tabular-nums leading-none", cfg.text)}>{summary[key] ?? 0}</p>
              <p className={cn("text-[10px] font-semibold", cfg.text)}>{cfg.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Dead stock value alert */}
      {!l2 && (dead ?? []).length > 0 && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-destructive">Dead Stock Alert</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{(dead ?? []).length} items with no sales in 60+ days</p>
          </div>
          <p className="text-lg font-bold tabular-nums font-mono text-destructive">{formatCurrencyCompact(deadStockValue)}</p>
        </div>
      )}

      {/* Stock velocity */}
      <ChartCard
        title="Stock Velocity & Days Remaining"
        loading={l1}
        action={<TopNSelector value={topN} onChange={setTopN} />}
      >
        <DataTable
          columns={[
            { key: "item_name",               header: "Item",       render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "category_name",           header: "Category",   render: (r) => <span className="text-[10px] text-muted-foreground">{r.category_name}</span> },
            { key: "current_stock",           header: "In Stock",   align: "right",
              render: (r) => <span className="text-xs tabular-nums">{formatQuantity(parseFloat(r.current_stock ?? 0), r.measurement_type, r.unit_type)}</span> },
            { key: "avg_daily_sales",         header: "Avg Daily",  align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{parseFloat(r.avg_daily_sales ?? 0).toFixed(2)}/d</span> },
            { key: "days_of_stock_remaining", header: "Days Left",  align: "right", sortable: true,
              render: (r) => {
                const d   = r.days_of_stock_remaining;
                const cfg = URGENCY[r.reorder_urgency] ?? URGENCY.no_sales;
                return <span className={cn("text-xs font-bold tabular-nums", cfg.text)}>{d == null ? "—" : `${d}d`}</span>;
              }},
            { key: "reorder_urgency",         header: "Status",
              render: (r) => {
                const cfg = URGENCY[r.reorder_urgency] ?? URGENCY.no_sales;
                return (
                  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider", cfg.bg, cfg.border, cfg.text)}>
                    {cfg.label}
                  </span>
                );
              }},
            { key: "stock_value_at_cost",     header: "Value",      align: "right",
              render: (r) => <span className="text-xs tabular-nums font-mono text-muted-foreground">{formatCurrency(parseFloat(r.stock_value_at_cost ?? 0))}</span> },
          ]}
          data={velocity ?? []}
          isLoading={l1}
          emptyState={<EmptyState icon={Box} title="No stock data" compact />}
        />
      </ChartCard>

      {/* Dead stock */}
      <ChartCard title="Dead Stock (No Sales in 60 Days)" loading={l2}>
        <DataTable
          columns={[
            { key: "item_name",    header: "Item",       render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "category_name",header: "Category",   render: (r) => <span className="text-[10px] text-muted-foreground">{r.category_name}</span> },
            { key: "current_stock",header: "Qty",        align: "right",
              render: (r) => <span className="text-xs tabular-nums text-warning">{formatQuantity(parseFloat(r.current_stock ?? 0), r.measurement_type, r.unit_type)}</span> },
            { key: "cost_price",   header: "Unit Cost",  align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground font-mono">{formatCurrency(parseFloat(r.cost_price ?? 0))}</span> },
            { key: "selling_price",header: "Sell Price", align: "right",
              render: (r) => <span className="text-xs tabular-nums font-mono">{formatCurrency(parseFloat(r.selling_price ?? 0))}</span> },
            { key: "stock_value",  header: "Stock Value",align: "right", sortable: true,
              render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-destructive">{formatCurrency(parseFloat(r.stock_value ?? 0))}</span> },
          ]}
          data={dead ?? []}
          isLoading={l2}
          emptyState={<EmptyState icon={Box} title="No dead stock" description="All items have had sales in the last 60 days." compact />}
        />
      </ChartCard>
    </div>
  );
}
