// pages/analytics/TaxPage.jsx
import { Layers, DollarSign, ShoppingCart, TrendingUp } from "lucide-react";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { useTaxReport } from "@/features/analytics/useAnalytics";
import { useAnalyticsDate }  from "@/features/analytics/AnalyticsLayout";
import { CardShell, ChartCard, SectionHeader } from "@/features/analytics/AnalyticsShared";

export default function TaxPage() {
  const { params } = useAnalyticsDate();
  const { data, isLoading } = useTaxReport(params);

  return (
    <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
      <SectionHeader
        icon={Layers}
        title="Tax Report"
        description="VAT collected by period and tax category. Formatted and ready for FIRS submission."
      />

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <CardShell label="Total VAT Collected" value={isLoading ? "—" : formatCurrencyCompact(parseFloat(data?.total_vat ?? 0))}
          sub={`${(data?.transaction_count ?? 0).toLocaleString()} transactions`} icon={DollarSign} accent="primary" />
        <CardShell label="Gross Sales"          value={isLoading ? "—" : formatCurrencyCompact(parseFloat(data?.gross_sales ?? 0))} icon={TrendingUp} />
        <CardShell label="Net Sales (ex-VAT)"   value={isLoading ? "—" : formatCurrencyCompact(parseFloat(data?.net_sales ?? 0))}   icon={ShoppingCart} accent="success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By category */}
        <ChartCard title="VAT by Tax Category" loading={isLoading}>
          <DataTable
            columns={[
              { key: "category_name", header: "Tax Category",  render: (r) => <span className="text-xs font-semibold">{r.category_name}</span> },
              { key: "rate",          header: "Rate",          align: "right",
                render: (r) => <span className="text-xs tabular-nums">{parseFloat(r.rate ?? 0).toFixed(1)}%</span> },
              { key: "taxable_sales", header: "Taxable Sales", align: "right",
                render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.taxable_sales ?? 0))}</span> },
              { key: "vat_amount",    header: "VAT Amount",    align: "right", sortable: true,
                render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-primary">{formatCurrency(parseFloat(r.vat_amount ?? 0))}</span> },
            ]}
            data={data?.vat_by_category ?? []}
            isLoading={isLoading}
            emptyState={<EmptyState icon={DollarSign} title="No tax category data" compact />}
          />
        </ChartCard>

        {/* By period */}
        <ChartCard title="VAT by Period" loading={isLoading}>
          <DataTable
            columns={[
              { key: "period",            header: "Period",        render: (r) => <span className="text-xs font-semibold">{(r.period ?? "").slice(0, 10)}</span> },
              { key: "gross_sales",       header: "Gross Sales",   align: "right",
                render: (r) => <span className="text-xs font-mono tabular-nums">{formatCurrency(parseFloat(r.gross_sales ?? 0))}</span> },
              { key: "vat_collected",     header: "VAT",           align: "right",
                render: (r) => <span className="text-xs font-mono font-bold tabular-nums text-primary">{formatCurrency(parseFloat(r.vat_collected ?? 0))}</span> },
              { key: "transaction_count", header: "Txns",          align: "right",
                render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{r.transaction_count ?? 0}</span> },
            ]}
            data={data?.period_rows ?? []}
            isLoading={isLoading}
            emptyState={<EmptyState icon={DollarSign} title="No period data" compact />}
          />
        </ChartCard>
      </div>

      {/* FIRS-ready export hint */}
      <div className="rounded-xl border border-border/50 bg-muted/10 px-5 py-4">
        <p className="text-xs font-bold text-foreground mb-1">Filing Note</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          VAT figures above reflect completed transactions only. Refunded transactions are not deducted automatically —
          reconcile against your return register before submission. Standard FIRS VAT rate is 7.5%.
          All amounts in Nigerian Naira (₦).
        </p>
      </div>
    </div>
  );
}
