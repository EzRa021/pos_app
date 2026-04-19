// pages/analytics/CustomersPage.jsx
import { useState } from "react";
import { Users, DollarSign, TrendingUp, AlertTriangle, Clock } from "lucide-react";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn }         from "@/lib/utils";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { useCustomerAnalytics } from "@/features/analytics/useAnalytics";
import { useAnalyticsDate }     from "@/features/analytics/AnalyticsLayout";
import {
  CardShell, ChartCard, SectionHeader, TopNSelector,
} from "@/features/analytics/AnalyticsShared";

export default function CustomersPage() {
  const { params }      = useAnalyticsDate();
  const [topN, setTopN] = useState(10);
  const limit           = topN === 9999 ? 500 : topN;

  const { data, isLoading, error } = useCustomerAnalytics({ ...params, limit, lapsed_days: 60 });

  return (
    <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
      <SectionHeader
        icon={Users}
        title="Customer Insights"
        description="Lifetime value, visit frequency, purchase recency, and outstanding credit exposure per customer."
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CardShell label="Total Customers"    value={isLoading ? "—" : (data?.total_customers   ?? 0).toLocaleString()} icon={Users}         />
        <CardShell label="Active (60d)"       value={isLoading ? "—" : (data?.active_customers  ?? 0).toLocaleString()} icon={TrendingUp}     accent="success" />
        <CardShell label="Lapsed (60–365d)"   value={isLoading ? "—" : (data?.lapsed_customers  ?? 0).toLocaleString()} icon={AlertTriangle}
          accent={(data?.lapsed_customers ?? 0) > 0 ? "warning" : "default"} />
        <CardShell label="Avg Lifetime Value" value={isLoading ? "—" : formatCurrency(parseFloat(data?.avg_lifetime_value ?? 0))} icon={DollarSign} accent="primary" />
      </div>

      {/* Top customers table */}
      <ChartCard
        title="Top Customers by Lifetime Spend"
        loading={isLoading}
        error={error}
        action={<TopNSelector value={topN} onChange={setTopN} />}
      >
        <DataTable
          columns={[
            { key: "customer_name",            header: "Customer",    render: (r) => <span className="text-xs font-semibold">{r.customer_name || "—"}</span> },
            { key: "phone",                    header: "Phone",       render: (r) => <span className="text-[10px] font-mono text-muted-foreground">{r.phone ?? "—"}</span> },
            { key: "transaction_count",        header: "Visits",      align: "right", sortable: true,
              render: (r) => <span className="text-xs tabular-nums">{r.transaction_count ?? 0}</span> },
            { key: "avg_basket_size",          header: "Avg Basket",  align: "right",
              render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(parseFloat(r.avg_basket_size ?? 0))}</span> },
            { key: "total_spent",              header: "Total Spent", align: "right", sortable: true,
              render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-primary">{formatCurrency(parseFloat(r.total_spent ?? 0))}</span> },
            { key: "outstanding_balance",      header: "Credit Owed", align: "right",
              render: (r) => {
                const bal = parseFloat(r.outstanding_balance ?? 0);
                return <span className={cn("text-xs font-mono tabular-nums", bal > 0 ? "text-destructive font-bold" : "text-muted-foreground")}>{bal > 0 ? formatCurrency(bal) : "—"}</span>;
              }},
            { key: "days_since_last_purchase", header: "Last Visit",  align: "right",
              render: (r) => {
                const d = r.days_since_last_purchase;
                return <span className={cn("text-xs tabular-nums", d == null ? "text-muted-foreground" : d > 60 ? "text-warning font-bold" : "text-foreground")}>{d == null ? "—" : `${d}d ago`}</span>;
              }},
          ]}
          data={data?.top_customers ?? []}
          isLoading={isLoading}
          emptyState={<EmptyState icon={Users} title="No customer data" description="Transactions linked to customer accounts will appear here." compact />}
        />
      </ChartCard>

      {/* Credit exposure summary */}
      {(data?.top_customers ?? []).some((c) => parseFloat(c.outstanding_balance ?? 0) > 0) && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-3.5 w-3.5 text-destructive" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-destructive">Credit Exposure</span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {(data?.top_customers ?? [])
              .filter((c) => parseFloat(c.outstanding_balance ?? 0) > 0)
              .sort((a, b) => parseFloat(b.outstanding_balance ?? 0) - parseFloat(a.outstanding_balance ?? 0))
              .slice(0, 8)
              .map((c) => (
                <div key={c.customer_id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{c.customer_name || "—"}</span>
                    {c.phone && <span className="text-[10px] text-muted-foreground">{c.phone}</span>}
                  </div>
                  <span className="text-xs font-bold tabular-nums font-mono text-destructive">
                    {formatCurrency(parseFloat(c.outstanding_balance ?? 0))}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
