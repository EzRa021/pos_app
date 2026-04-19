// pages/analytics/ProfitabilityPage.jsx
import { DollarSign, TrendingUp } from "lucide-react";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn }         from "@/lib/utils";
import { formatCurrency, formatCurrencyCompact, formatDecimal } from "@/lib/format";
import { useProfitLossSummary, useProfitAnalysis } from "@/features/analytics/useAnalytics";
import { useAnalyticsDate }  from "@/features/analytics/AnalyticsLayout";
import { CardShell, ChartCard, SectionHeader } from "@/features/analytics/AnalyticsShared";

export default function ProfitabilityPage() {
  const { params } = useAnalyticsDate();

  const { data: pl,     isLoading: l1 } = useProfitLossSummary(params);
  const { data: profit, isLoading: l2 } = useProfitAnalysis({ ...params, limit: 50 });

  const v = (k) => parseFloat(pl?.[k] ?? 0);

  const waterfall = [
    { label: "Gross Sales",      value: v("gross_sales"),          type: "pos",    indent: false },
    { label: "Less: Discounts",  value: v("total_discounts"),      type: "deduct", indent: true  },
    { label: "Net Sales",        value: v("net_sales"),            type: "total",  indent: false },
    { label: "Less: COGS",       value: v("cost_of_goods_sold"),   type: "deduct", indent: true  },
    { label: "Gross Profit",     value: v("gross_profit"),         type: v("gross_profit")  >= 0 ? "subtotal" : "neg", indent: false },
    { label: "Less: Expenses",   value: v("total_expenses"),       type: "deduct", indent: true  },
    { label: "Net Profit",       value: v("net_profit"),           type: v("net_profit") >= 0 ? "final" : "final_neg", indent: false },
  ];

  return (
    <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
      <SectionHeader
        icon={DollarSign}
        title="Profitability"
        description="Full P&L statement — Gross Sales → Net Sales → COGS → Gross Profit → Expenses → Net Profit."
      />

      {/* P&L summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CardShell label="Gross Sales"   value={l1 ? "—" : formatCurrencyCompact(v("gross_sales"))}  icon={TrendingUp} accent="primary" />
        <CardShell label="Net Sales"     value={l1 ? "—" : formatCurrencyCompact(v("net_sales"))}    icon={DollarSign} accent="success" />
        <CardShell label="Gross Profit"  value={l1 ? "—" : formatCurrencyCompact(v("gross_profit"))} icon={DollarSign} accent={v("gross_profit")  >= 0 ? "success" : "destructive"} sub={`${v("gross_margin_percent").toFixed(1)}% margin`} />
        <CardShell label="Net Profit"    value={l1 ? "—" : formatCurrencyCompact(v("net_profit"))}   icon={DollarSign} accent={v("net_profit") >= 0 ? "success" : "destructive"} sub={`${v("net_margin_percent").toFixed(1)}% margin`} />
      </div>

      {/* P&L waterfall */}
      <div className="rounded-xl border border-border/50 bg-muted/10 overflow-hidden">
        <div className="px-5 py-2.5 border-b border-border/40">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Profit & Loss Statement</span>
        </div>
        <div className="divide-y divide-border/20">
          {waterfall.map((row) => {
            const isFinal    = row.type.startsWith("final");
            const isTotal    = row.type === "total" || row.type === "subtotal" || isFinal;
            const isDeduct   = row.type === "deduct";
            const isNegFinal = row.type === "final_neg";
            return (
              <div key={row.label} className={cn(
                "flex items-center justify-between px-5 py-2.5",
                isFinal   ? "bg-muted/30" :
                isTotal   ? "bg-muted/15" : "",
              )}>
                <span className={cn(
                  "text-xs",
                  row.indent ? "pl-4 text-muted-foreground" :
                  isFinal   ? "font-bold text-foreground" :
                  isTotal   ? "font-semibold text-foreground" :
                               "text-muted-foreground",
                )}>
                  {row.label}
                </span>
                <span className={cn(
                  "tabular-nums font-mono",
                  isFinal   ? "text-base font-bold" : "text-sm",
                  isNegFinal ? "text-destructive" :
                  isFinal && v("net_profit") >= 0 ? "text-success" :
                  isTotal   ? "text-foreground font-semibold" :
                  isDeduct  ? "text-muted-foreground" :
                              "text-foreground",
                )}>
                  {l1 ? "—" : (isDeduct ? `(${formatCurrency(row.value)})` : formatCurrency(row.value))}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category profitability */}
      <ChartCard title="Profitability by Category" loading={l2}>
        <DataTable
          columns={[
            { key: "category_name",  header: "Category",      render: (r) => <span className="text-xs font-semibold">{r.category_name}</span> },
            { key: "qty_sold",       header: "Qty",           align: "right",
              render: (r) => <span className="text-xs tabular-nums">{formatDecimal(parseFloat(r.qty_sold ?? 0))}</span> },
            { key: "revenue",        header: "Revenue",       align: "right",
              render: (r) => <span className="text-xs tabular-nums font-mono">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
            { key: "cost_of_goods",  header: "COGS",          align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground font-mono">{formatCurrency(parseFloat(r.cost_of_goods ?? 0))}</span> },
            { key: "gross_profit",   header: "Gross Profit",  align: "right", sortable: true,
              render: (r) => {
                const p = parseFloat(r.gross_profit ?? 0);
                return <span className={cn("text-xs font-bold tabular-nums font-mono", p >= 0 ? "text-success" : "text-destructive")}>{formatCurrency(p)}</span>;
              }},
            { key: "margin_percent", header: "Margin",        align: "right",
              render: (r) => {
                const m = parseFloat(r.margin_percent ?? 0);
                return (
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 w-14 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full", m >= 30 ? "bg-success" : m >= 15 ? "bg-warning" : "bg-destructive")}
                           style={{ width: `${Math.min(Math.max(m, 0), 100)}%` }} />
                    </div>
                    <span className="text-xs tabular-nums w-10 text-right">{m.toFixed(1)}%</span>
                  </div>
                );
              }},
          ]}
          data={profit?.by_category ?? []}
          isLoading={l2}
          emptyState={<EmptyState icon={DollarSign} title="No category profit data" compact />}
        />
      </ChartCard>

      {/* Department profitability */}
      <ChartCard title="Profitability by Department" loading={l2}>
        <DataTable
          columns={[
            { key: "department_name",header: "Department",    render: (r) => <span className="text-xs font-semibold">{r.department_name}</span> },
            { key: "qty_sold",       header: "Qty",           align: "right",
              render: (r) => <span className="text-xs tabular-nums">{formatDecimal(parseFloat(r.qty_sold ?? 0))}</span> },
            { key: "revenue",        header: "Revenue",       align: "right",
              render: (r) => <span className="text-xs tabular-nums font-mono">{formatCurrency(parseFloat(r.revenue ?? 0))}</span> },
            { key: "gross_profit",   header: "Gross Profit",  align: "right", sortable: true,
              render: (r) => {
                const p = parseFloat(r.gross_profit ?? 0);
                return <span className={cn("text-xs font-bold tabular-nums font-mono", p >= 0 ? "text-success" : "text-destructive")}>{formatCurrency(p)}</span>;
              }},
            { key: "margin_percent", header: "Margin",        align: "right",
              render: (r) => <span className="text-xs tabular-nums">{parseFloat(r.margin_percent ?? 0).toFixed(1)}%</span> },
          ]}
          data={profit?.by_department ?? []}
          isLoading={l2}
          emptyState={<EmptyState icon={DollarSign} title="No department profit data" compact />}
        />
      </ChartCard>
    </div>
  );
}
