// pages/analytics/StaffPage.jsx
import { useState, useMemo } from "react";
import { Award, RotateCcw } from "lucide-react";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn }         from "@/lib/utils";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { useCashierPerformance, useReturnAnalysis, usePeakHoursAnalysis } from "@/features/analytics/useAnalytics";
import { useAnalyticsDate }  from "@/features/analytics/AnalyticsLayout";
import { CardShell, ChartCard, SectionHeader } from "@/features/analytics/AnalyticsShared";

export default function StaffPage() {
  const { params } = useAnalyticsDate();

  const { data: cashiers,  isLoading: l1, error: e1 } = useCashierPerformance(params);
  const { data: returns,   isLoading: l2 }             = useReturnAnalysis(params);
  const { data: peakHours, isLoading: l3 }             = usePeakHoursAnalysis(params);

  const hourData = useMemo(() => {
    const grid = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h}:00`, count: 0, revenue: 0 }));
    (peakHours ?? []).forEach((r) => {
      const h = r.hour_of_day ?? 0;
      grid[h].count   += Number(r.transaction_count ?? 0);
      grid[h].revenue += parseFloat(r.revenue ?? 0);
    });
    return grid;
  }, [peakHours]);

  const maxCount = Math.max(...hourData.map((h) => h.count), 1);

  // Top cashier
  const top = (cashiers ?? []).length > 0 ? cashiers[0] : null;

  return (
    <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
      <SectionHeader
        icon={Award}
        title="Staff & Shifts"
        description="Cashier sales performance, void and refund rates, discount usage, and transaction volume by hour of day."
      />

      {/* Top cashier highlight + overview KPIs */}
      {top && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 flex items-center gap-5">
          <div className="h-10 w-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-primary">{(top.cashier_name ?? "?")[0]}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-0.5">Top Performer</p>
            <p className="text-sm font-bold text-foreground">{top.cashier_name}</p>
            <p className="text-[11px] text-muted-foreground">{top.transaction_count ?? 0} transactions this period</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xl font-bold tabular-nums text-primary">{formatCurrencyCompact(parseFloat(top.total_sales ?? 0))}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">total sales</p>
          </div>
        </div>
      )}

      {/* Cashier card grid */}
      {!l1 && (cashiers ?? []).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {(cashiers ?? []).slice(0, 8).map((c) => (
            <div key={c.cashier_id} className="rounded-xl border border-border/60 bg-muted/10 px-4 py-3.5">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-primary">{(c.cashier_name ?? "?")[0]}</span>
                </div>
                <span className="text-[11px] font-semibold text-foreground truncate">{c.cashier_name}</span>
              </div>
              <p className="text-base font-bold tabular-nums text-primary">{formatCurrencyCompact(parseFloat(c.total_sales ?? 0))}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{c.transaction_count ?? 0} txns</p>
              {(c.void_count ?? 0) > 0 && (
                <p className="text-[10px] text-warning mt-0.5">{c.void_count} void{c.void_count === 1 ? "" : "s"}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Peak hours heatmap */}
        <ChartCard title="Transaction Volume by Hour" loading={l3}>
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-0.5 h-24 w-full">
              {hourData.map((h) => {
                const pct    = maxCount > 0 ? h.count / maxCount : 0;
                const isHigh = pct > 0.6;
                const isMed  = pct > 0.3;
                return (
                  <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5 group" title={`${h.label} — ${h.count} txns`}>
                    <div className="relative flex-1 flex items-end w-full">
                      <div
                        className={cn(
                          "w-full rounded-t transition-all",
                          isHigh ? "bg-primary" : isMed ? "bg-primary/50" : pct > 0 ? "bg-primary/25" : "bg-muted/20",
                        )}
                        style={{ height: `${Math.max(pct * 100, 4)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between px-0.5">
              {[0, 6, 12, 18, 23].map((h) => (
                <span key={h} className="text-[8px] text-muted-foreground">{h}:00</span>
              ))}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border/30 grid grid-cols-3 gap-2">
            {hourData
              .filter((h) => h.count > 0)
              .sort((a, b) => b.count - a.count)
              .slice(0, 3)
              .map((h) => (
                <div key={h.hour} className="text-center">
                  <p className="text-xs font-bold text-foreground">{h.label}</p>
                  <p className="text-[10px] text-muted-foreground">{h.count} txns</p>
                </div>
              ))}
          </div>
        </ChartCard>

        {/* Returns by cashier */}
        <ChartCard title="Returns & Voids by Cashier" loading={l2}>
          <DataTable
            columns={[
              { key: "cashier_name",       header: "Cashier",    render: (r) => <span className="text-xs font-semibold">{r.cashier_name}</span> },
              { key: "void_count",         header: "Voids",      align: "right",
                render: (r) => <span className={cn("text-xs font-bold tabular-nums", (r.void_count ?? 0) > 0 ? "text-warning" : "text-muted-foreground")}>{r.void_count ?? 0}</span> },
              { key: "refund_count",       header: "Refunds",    align: "right",
                render: (r) => <span className="text-xs tabular-nums">{r.refund_count ?? 0}</span> },
              { key: "total_return_value", header: "Total Value",align: "right", sortable: true,
                render: (r) => <span className="text-xs font-mono tabular-nums text-warning">{formatCurrency(parseFloat(r.total_return_value ?? 0))}</span> },
            ]}
            data={(returns?.by_cashier ?? []).slice(0, 8)}
            isLoading={l2}
            emptyState={<EmptyState icon={RotateCcw} title="No return data" compact />}
          />
        </ChartCard>
      </div>

      {/* Full cashier performance table */}
      <ChartCard title="Full Cashier Performance" loading={l1} error={e1}>
        <DataTable
          columns={[
            { key: "cashier_name",          header: "Cashier",      render: (r) => <span className="text-xs font-semibold">{r.cashier_name}</span> },
            { key: "transaction_count",     header: "Transactions", align: "right", sortable: true,
              render: (r) => <span className="text-xs tabular-nums">{r.transaction_count ?? 0}</span> },
            { key: "total_sales",           header: "Total Sales",  align: "right", sortable: true,
              render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-primary">{formatCurrency(parseFloat(r.total_sales ?? 0))}</span> },
            { key: "avg_transaction_value", header: "Avg Basket",   align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_transaction_value ?? 0))}</span> },
            { key: "total_discounts",       header: "Discounts",    align: "right",
              render: (r) => <span className="text-xs tabular-nums text-warning">{formatCurrency(parseFloat(r.total_discounts ?? 0))}</span> },
            { key: "void_count",            header: "Voids",        align: "right",
              render: (r) => <span className={cn("text-xs font-bold tabular-nums", (r.void_count ?? 0) > 0 ? "text-warning" : "text-muted-foreground")}>{r.void_count ?? 0}</span> },
            { key: "refund_count",          header: "Refunds",      align: "right",
              render: (r) => <span className="text-xs tabular-nums">{r.refund_count ?? 0}</span> },
            { key: "credit_sales_count",    header: "Credits",      align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{r.credit_sales_count ?? 0}</span> },
            { key: "shift_count",           header: "Shifts",       align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{r.shift_count ?? 0}</span> },
          ]}
          data={cashiers ?? []}
          isLoading={l1}
          emptyState={<EmptyState icon={Award} title="No cashier data" compact />}
        />
      </ChartCard>
    </div>
  );
}
