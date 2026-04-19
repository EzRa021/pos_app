// pages/analytics/PaymentsPage.jsx
import { useMemo } from "react";
import { CreditCard, DollarSign, Tag } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn }         from "@/lib/utils";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { CHART_COLORS } from "@/components/ui/chart";
import { usePaymentMethodSummary, useDiscountAnalytics } from "@/features/analytics/useAnalytics";
import { useAnalyticsDate }  from "@/features/analytics/AnalyticsLayout";
import {
  CardShell, ChartCard, SectionHeader, getPaymentMeta,
} from "@/features/analytics/AnalyticsShared";

export default function PaymentsPage() {
  const { params } = useAnalyticsDate();

  const { data: payments,  isLoading: l1, error: e1 } = usePaymentMethodSummary(params);
  const { data: discounts, isLoading: l2 }             = useDiscountAnalytics(params);

  const payData = useMemo(() => {
    const list  = payments ?? [];
    const total = list.reduce((acc, p) => acc + parseFloat(p.total ?? 0), 0);
    return list.map((p) => ({
      ...p,
      label: getPaymentMeta(p.payment_method).label,
      color: getPaymentMeta(p.payment_method).color,
      value: parseFloat(p.total ?? 0),
      count: Number(p.count ?? 0),
      pct:   total > 0 ? parseFloat(p.total ?? 0) / total * 100 : 0,
    }));
  }, [payments]);

  const totalCollected = payData.reduce((a, p) => a + p.value, 0);

  return (
    <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
      <SectionHeader
        icon={CreditCard}
        title="Payments & Cash Flow"
        description="How customers pay — cash, card, transfer, credit, and wallet. Full breakdown with transaction counts and share percentages."
      />

      {/* Per-method stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {payData.map((p) => {
          const { icon: Icon } = getPaymentMeta(p.payment_method);
          return (
            <div key={p.payment_method} className="rounded-xl border border-border/50 bg-muted/10 px-3 py-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                <Icon className="h-3 w-3 text-muted-foreground" />
              </div>
              <p className="text-[10px] text-muted-foreground font-semibold leading-tight">{p.label}</p>
              <p className="text-sm font-bold tabular-nums text-foreground">{formatCurrencyCompact(p.value)}</p>
              <p className="text-[9px] text-muted-foreground">{p.count} txns · {p.pct.toFixed(0)}%</p>
            </div>
          );
        })}
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 flex flex-col gap-1.5">
          <DollarSign className="h-3.5 w-3.5 text-primary" />
          <p className="text-[10px] text-muted-foreground font-semibold leading-tight">Total Collected</p>
          <p className="text-sm font-bold tabular-nums text-primary">{formatCurrencyCompact(totalCollected)}</p>
        </div>
      </div>

      {/* Donut + legend side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Payment Method Breakdown" loading={l1} error={e1}>
          {payData.length === 0 ? <EmptyState icon={CreditCard} title="No payment data" compact /> : (
            <div className="flex items-center gap-6">
              <div className="shrink-0">
                <ResponsiveContainer width={150} height={150}>
                  <PieChart>
                    <Pie data={payData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={66} paddingAngle={2}>
                      {payData.map((p, i) => <Cell key={i} fill={p.color ?? CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl text-[11px]">
                          <p className="font-bold">{d.label}</p>
                          <p className="text-muted-foreground">{formatCurrency(d.value)}</p>
                          <p className="text-muted-foreground">{d.count} transactions</p>
                          <p className="text-muted-foreground">{d.pct.toFixed(1)}% share</p>
                        </div>
                      );
                    }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2.5 min-w-0">
                {payData.map((p) => {
                  const { icon: Icon } = getPaymentMeta(p.payment_method);
                  return (
                    <div key={p.payment_method} className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: p.color }} />
                        <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-[11px] text-foreground font-semibold flex-1 truncate">{p.label}</span>
                        <span className="text-[11px] font-bold tabular-nums shrink-0">{formatCurrencyCompact(p.value)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 ml-5">
                        <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.color }} />
                        </div>
                        <span className="text-[9px] text-muted-foreground tabular-nums w-8 text-right">{p.pct.toFixed(0)}%</span>
                      </div>
                      <p className="text-[9px] text-muted-foreground ml-5">{p.count} transactions</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </ChartCard>

        {/* Discount summary */}
        <ChartCard title="Discount Overview" loading={l2}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Total Given</p>
              <p className="text-base font-bold tabular-nums text-warning mt-1">{formatCurrencyCompact(parseFloat(discounts?.total_discounts_given ?? 0))}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Discounted Txns</p>
              <p className="text-base font-bold tabular-nums text-foreground mt-1">{(discounts?.transactions_with_discounts ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Avg Discount</p>
              <p className="text-base font-bold tabular-nums text-foreground mt-1">{formatCurrency(parseFloat(discounts?.avg_discount_per_transaction ?? 0))}</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "cashier_name",       header: "Cashier",   render: (r) => <span className="text-xs font-semibold">{r.cashier_name}</span> },
              { key: "discount_count",     header: "Count",     align: "right", render: (r) => <span className="text-xs tabular-nums">{r.discount_count ?? 0}</span> },
              { key: "avg_discount_amount",header: "Avg",       align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_discount_amount ?? 0))}</span> },
              { key: "total_discounts",    header: "Total",     align: "right", sortable: true,
                render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-warning">{formatCurrency(parseFloat(r.total_discounts ?? 0))}</span> },
            ]}
            data={(discounts?.by_cashier ?? []).slice(0, 7)}
            isLoading={l2}
            emptyState={<EmptyState icon={Tag} title="No discount data" compact />}
          />
        </ChartCard>
      </div>

      {/* Most discounted items */}
      <ChartCard title="Most Discounted Items" loading={l2}>
        <DataTable
          columns={[
            { key: "item_name",           header: "Item",          render: (r) => <span className="text-xs font-semibold">{r.item_name}</span> },
            { key: "tx_count",            header: "Transactions",  align: "right", render: (r) => <span className="text-xs tabular-nums">{r.tx_count ?? 0}</span> },
            { key: "qty_sold",            header: "Qty Sold",      align: "right", render: (r) => <span className="text-xs tabular-nums">{String(r.qty_sold ?? "0")}</span> },
            { key: "avg_discount_amount", header: "Avg Discount",  align: "right", render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_discount_amount ?? 0))}</span> },
            { key: "total_discount",      header: "Total Discount",align: "right", sortable: true,
              render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-warning">{formatCurrency(parseFloat(r.total_discount ?? 0))}</span> },
          ]}
          data={discounts?.by_item ?? []}
          isLoading={l2}
          emptyState={<EmptyState icon={Tag} title="No item discount data" compact />}
        />
      </ChartCard>
    </div>
  );
}
