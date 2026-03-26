// ============================================================================
// features/supplier_payments/SupplierPaymentsPanel.jsx
// ============================================================================
// Store-level overview of all outstanding supplier payables.
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  Summary banner: total outstanding · suppliers with debt · total paid│
//   ├──────────────────────────────────────────────────────────────────────┤
//   │  Payables table — one row per supplier with a balance > 0            │
//   │  Each row: supplier name · total PO value · paid · balance · Pay btn │
//   ├──────────────────────────────────────────────────────────────────────┤
//   │  Recent payment history — last 50 payments across all suppliers      │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Hooks used:
//   useAllSupplierPayables  — suppliers with current_balance > 0
//   useSupplierPayments     — paginated payments for a single supplier
//                             (also used without supplier_id for all-store history)
// Dialog used:
//   SupplierPaymentDialog   — shared record-payment modal (already exists)
// ============================================================================

import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Banknote, AlertTriangle, CheckCircle2, Loader2,
  ArrowUpRight, RefreshCw, Plus,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAllSupplierPayables, useSupplierPayments } from "./useSupplierPayments";
import { SupplierPaymentDialog } from "./SupplierPaymentDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Spinner }    from "@/components/shared/Spinner";
import { Button }     from "@/components/ui/button";
import { cn }         from "@/lib/utils";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useBranchStore } from "@/stores/branch.store";
import { usePermission }  from "@/hooks/usePermission";
import { getSupplierPayments } from "@/commands/supplier_payments";

// ── Constants ─────────────────────────────────────────────────────────────────

const PM_LABELS = {
  cash:          "Cash",
  bank_transfer: "Transfer",
  transfer:      "Transfer",
  cheque:        "Cheque",
  card:          "Card",
  mobile_money:  "Mobile Money",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent = "default" }) {
  const border = {
    default: "border-border/60   bg-card",
    warning: "border-warning/30  bg-warning/[0.05]",
    success: "border-success/25  bg-success/[0.05]",
    primary: "border-primary/25  bg-primary/[0.05]",
  }[accent];
  const valueClass = {
    default: "text-foreground",
    warning: "text-warning",
    success: "text-success",
    primary: "text-primary",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-5 py-4", border)}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", valueClass)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function MethodPill({ method }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
      {PM_LABELS[method] ?? method ?? "—"}
    </span>
  );
}

// ── All-store payment history ─────────────────────────────────────────────────
// Queries getSupplierPayments without a supplier_id filter to get the last
// N payments across all suppliers in the store.

function useStorePaymentHistory() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["supplier-payments-all", storeId],
    queryFn:  () => getSupplierPayments({ store_id: storeId, limit: 50 }),
    enabled:  !!storeId,
    staleTime: 30_000,
  });

  return {
    payments:  data?.data  ?? data ?? [],
    isLoading,
    refetch,
  };
}

// ── Payables table ────────────────────────────────────────────────────────────

function PayablesTable({ payables, canManage }) {
  const [selected, setSelected] = useState(null); // { id, supplier_name, ... }
  const qc      = useQueryClient();
  const storeId = useBranchStore((s) => s.activeStore?.id);

  // Record mutation scoped to the selected supplier
  const { record } = useSupplierPayments(selected?.supplier_id ?? 0);

  const handleRecord = async (payload) => {
    if (!selected) return;
    await record.mutateAsync(payload);
    // Also refresh the all-store history
    qc.invalidateQueries({ queryKey: ["supplier-payments-all", storeId] });
    setSelected(null);
  };

  if (!payables.length) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="All paid up"
        description="No suppliers have an outstanding balance right now."
      />
    );
  }

  return (
    <>
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_130px_130px_130px_96px] gap-3 px-3 pb-2 border-b border-border/40">
        {["Supplier", "PO Value", "Paid", "Outstanding", ""].map((h, i) => (
          <span key={i} className={cn(
            "text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
            i >= 1 && i <= 3 && "text-right",
          )}>{h}</span>
        ))}
      </div>

      {payables.map((s) => {
        const poValue    = parseFloat(s.total_po_value  ?? 0);
        const paid       = parseFloat(s.total_paid      ?? 0);
        const outstanding = parseFloat(s.current_balance ?? 0);
        const paidPct    = poValue > 0 ? Math.min(100, Math.round((paid / poValue) * 100)) : 0;

        return (
          <div key={s.supplier_id}
            className="grid grid-cols-[1fr_130px_130px_130px_96px] gap-3 items-center px-3 py-3 border-b border-border/30 last:border-0 group hover:bg-muted/20 transition-colors rounded-lg">

            {/* Supplier name + link */}
            <div className="min-w-0">
              <Link
                to={`/suppliers/${s.supplier_id}`}
                className="flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary transition-colors group/link"
              >
                {s.supplier_name}
                <ArrowUpRight className="h-3 w-3 opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0" />
              </Link>
              {/* Mini progress bar showing how much of PO value has been paid */}
              {poValue > 0 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        paidPct >= 100 ? "bg-success" : paidPct >= 50 ? "bg-primary" : "bg-warning",
                      )}
                      style={{ width: `${paidPct}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">{paidPct}%</span>
                </div>
              )}
            </div>

            {/* PO Value */}
            <span className="text-xs font-mono tabular-nums text-right text-muted-foreground">
              {formatCurrency(poValue)}
            </span>

            {/* Total Paid */}
            <span className="text-xs font-mono tabular-nums text-right text-success font-semibold">
              {formatCurrency(paid)}
            </span>

            {/* Outstanding */}
            <span className={cn(
              "text-xs font-mono tabular-nums text-right font-bold",
              outstanding > 0 ? "text-warning" : "text-muted-foreground",
            )}>
              {formatCurrency(outstanding)}
            </span>

            {/* Pay button */}
            {canManage && outstanding > 0 ? (
              <Button
                size="sm"
                className="h-7 gap-1 bg-success/90 hover:bg-success text-white text-[11px] px-2.5 w-full"
                onClick={() => setSelected(s)}
              >
                <Banknote className="h-3 w-3" />Pay
              </Button>
            ) : (
              <div />
            )}
          </div>
        );
      })}

      <SupplierPaymentDialog
        open={!!selected}
        onOpenChange={(v) => { if (!v) setSelected(null); }}
        supplier={selected}
        onRecord={handleRecord}
      />
    </>
  );
}

// ── Payment history table ─────────────────────────────────────────────────────

function PaymentHistoryTable({ payments, isLoading, onRefresh }) {
  if (isLoading) return (
    <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />Loading…
    </div>
  );

  if (!payments.length) return (
    <EmptyState
      icon={Banknote}
      title="No payments yet"
      description="Payments made to suppliers will appear here."
      compact
    />
  );

  return (
    <div>
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_110px_120px_120px_140px] gap-3 px-1 pb-2 border-b border-border/40">
        {["Supplier", "Method", "Reference", "Amount", "Date"].map((h, i) => (
          <span key={i} className={cn(
            "text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
            i === 3 && "text-right",
          )}>{h}</span>
        ))}
      </div>

      {payments.map((p, idx) => (
        <div key={p.id ?? idx}
          className="grid grid-cols-[1fr_110px_120px_120px_140px] gap-3 items-center py-2.5 border-b border-border/30 last:border-0">
          <Link
            to={`/suppliers/${p.supplier_id}`}
            className="text-xs font-semibold text-foreground hover:text-primary transition-colors truncate"
          >
            {p.supplier_name ?? "—"}
          </Link>
          <MethodPill method={p.payment_method} />
          <span className="text-xs font-mono text-muted-foreground truncate">{p.reference ?? "—"}</span>
          <span className="text-xs font-mono font-bold text-success text-right tabular-nums">
            {formatCurrency(parseFloat(p.amount ?? 0))}
          </span>
          <span className="text-xs text-muted-foreground">{formatDateTime(p.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, action }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function SupplierPaymentsPanel() {
  const canManage = usePermission("suppliers.update");

  const { payables, isLoading: loadingPayables }      = useAllSupplierPayables();
  const { payments, isLoading: loadingHistory, refetch } = useStorePaymentHistory();

  // Summary figures derived from payables list
  const { totalOutstanding, suppliersWithDebt, totalPoValue } = useMemo(() => ({
    totalOutstanding: payables.reduce((s, p) => s + parseFloat(p.current_balance ?? 0), 0),
    suppliersWithDebt: payables.filter((p) => parseFloat(p.current_balance ?? 0) > 0).length,
    totalPoValue:      payables.reduce((s, p) => s + parseFloat(p.total_po_value  ?? 0), 0),
  }), [payables]);

  const totalPaidAll = useMemo(
    () => payments.reduce((s, p) => s + parseFloat(p.amount ?? 0), 0),
    [payments],
  );

  if (loadingPayables) return <Spinner />;

  return (
    <div className="space-y-5">

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard
          label="Total Outstanding"
          value={formatCurrency(totalOutstanding)}
          sub={`across ${suppliersWithDebt} supplier${suppliersWithDebt !== 1 ? "s" : ""}`}
          accent={totalOutstanding > 0 ? "warning" : "default"}
        />
        <SummaryCard
          label="Suppliers with Debt"
          value={suppliersWithDebt}
          sub="with a current balance > 0"
          accent={suppliersWithDebt > 0 ? "warning" : "success"}
        />
        <SummaryCard
          label="Total PO Value"
          value={formatCurrency(totalPoValue)}
          sub="combined value of all orders"
          accent="primary"
        />
        <SummaryCard
          label="Total Paid (recent)"
          value={formatCurrency(totalPaidAll)}
          sub="last 50 recorded payments"
          accent="success"
        />
      </div>

      {/* Outstanding payables */}
      <Section
        title="Outstanding Payables"
        icon={AlertTriangle}
        action={
          totalOutstanding > 0 ? (
            <span className="flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/5 px-2.5 py-0.5 text-[10px] font-bold text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
              {formatCurrency(totalOutstanding)} owed
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-success">
              <CheckCircle2 className="h-3 w-3" />All paid up
            </span>
          )
        }
      >
        <PayablesTable payables={payables} canManage={canManage} />
      </Section>

      {/* Payment history */}
      <Section
        title="Payment History"
        icon={Banknote}
        action={
          <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3" />Refresh
          </Button>
        }
      >
        <PaymentHistoryTable
          payments={payments}
          isLoading={loadingHistory}
          onRefresh={refetch}
        />
      </Section>

    </div>
  );
}
