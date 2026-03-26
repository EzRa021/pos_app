// ============================================================================
// features/credit_sales/CreditSalesPanel.jsx
// ============================================================================
import { useState, useMemo, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CreditCard, Search, X, Calendar, AlertTriangle, CheckCircle2,
  Clock, User, Receipt, ArrowUpRight, Banknote, Smartphone,
  ChevronDown, ChevronUp, Ban,
} from "lucide-react";

import { useCreditSales, useCreditSummary, useCreditSale } from "./useCreditSales";
import { PageHeader }     from "@/components/shared/PageHeader";
import { DataTable }      from "@/components/shared/DataTable";
import { EmptyState }     from "@/components/shared/EmptyState";
import { StatusBadge }    from "@/components/shared/StatusBadge";
import { Button }         from "@/components/ui/button";
import { Input }          from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }             from "@/lib/utils";
import { formatCurrency, formatDate, formatDateTime, formatRef } from "@/lib/format";
import { usePermission }  from "@/hooks/usePermission";
import { toast }          from "sonner";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "",            label: "All"         },
  { key: "outstanding", label: "Outstanding" },
  { key: "partial",     label: "Partial"     },
  { key: "paid",        label: "Paid"        },
  { key: "overdue",     label: "Overdue"     },
];

const STATUS_STYLES = {
  outstanding: { cls: "bg-warning/10 text-warning border-warning/20",     dot: "bg-warning"     },
  partial:     { cls: "bg-primary/10 text-primary border-primary/20",     dot: "bg-primary"     },
  paid:        { cls: "bg-success/10 text-success border-success/20",     dot: "bg-success"     },
  overdue:     { cls: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive" },
  cancelled:   { cls: "bg-muted/50 text-muted-foreground border-border/60", dot: "bg-muted-foreground" },
};

const PAYMENT_METHODS = [
  { value: "cash",         label: "Cash"         },
  { value: "card",         label: "Card"         },
  { value: "transfer",     label: "Bank Transfer" },
  { value: "mobile_money", label: "Mobile Money" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function CreditStatusBadge({ status }) {
  const cfg = STATUS_STYLES[status] ?? STATUS_STYLES.outstanding;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
      cfg.cls,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      {status === "outstanding" ? "Unpaid" : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, action, children, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent = "default" }) {
  const ring = {
    default:     "border-border/60   bg-card",
    primary:     "border-primary/25  bg-primary/[0.06]",
    success:     "border-success/25  bg-success/[0.06]",
    warning:     "border-warning/25  bg-warning/[0.06]",
    destructive: "border-destructive/25 bg-destructive/[0.06]",
    muted:       "border-border/60   bg-muted/30",
  }[accent];
  const val = {
    default:     "text-foreground",
    primary:     "text-primary",
    success:     "text-success",
    warning:     "text-warning",
    destructive: "text-destructive",
    muted:       "text-muted-foreground",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function TabBar({ active, onChange }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60 flex-wrap">
      {STATUS_TABS.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Record Payment Modal ───────────────────────────────────────────────────────

function RecordPaymentModal({ open, onOpenChange, sale, onConfirm }) {
  const [amount,  setAmount]  = useState("");
  const [method,  setMethod]  = useState("cash");
  const [notes,   setNotes]   = useState("");
  const [ref,     setRef]     = useState("");
  const [saving,  setSaving]  = useState(false);

  const outstanding = sale ? parseFloat(sale.outstanding) : 0;

  const handleOpenChange = (val) => {
    if (!val) { setAmount(""); setMethod("cash"); setNotes(""); setRef(""); setSaving(false); }
    else if (sale) setAmount(outstanding.toFixed(2));
    onOpenChange(val);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { toast.error("Enter a valid amount."); return; }
    if (amt > outstanding + 0.001) { toast.error(`Amount exceeds outstanding balance of ${formatCurrency(outstanding)}.`); return; }
    setSaving(true);
    try {
      await onConfirm({ creditSaleId: sale.id, amount: amt, paymentMethod: method, notes, reference: ref });
      toast.success("Payment recorded.");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-success" />
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-success/25 bg-success/10">
              <Banknote className="h-5 w-5 text-success" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Record Payment</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {sale?.customer_name} · Outstanding: {formatCurrency(outstanding)}
              </DialogDescription>
            </div>
          </div>
          <form id="payment-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Amount (₦) <span className="text-destructive">*</span>
              </label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number" min="0.01" step="0.01"
                placeholder="0.00"
                className="h-8 text-sm font-mono"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setAmount(outstanding.toFixed(2))}
                className="text-[10px] text-primary hover:underline"
              >
                Pay full outstanding ({formatCurrency(outstanding)})
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment Method</label>
              <select
                value={method} onChange={(e) => setMethod(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reference</label>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Cheque no., transfer ref…" className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" className="h-8 text-sm" />
            </div>
          </form>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="payment-form" size="sm" variant="success" disabled={saving}>
            {saving ? "Recording…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Cancel Credit Sale Dialog ──────────────────────────────────────────────────

function CancelDialog({ open, onOpenChange, sale, onConfirm }) {
  const [reason,  setReason]  = useState("");
  const [loading, setLoading] = useState(false);

  const handleOpenChange = (val) => {
    if (!val) { setReason(""); setLoading(false); }
    onOpenChange(val);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onConfirm({ id: sale.id, reason });
      toast.success("Credit sale cancelled.");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Failed to cancel.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
              <Ban className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">Cancel Credit Sale?</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {sale?.reference_no} · {sale?.customer_name}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-[11px] text-destructive leading-relaxed">
              This will cancel the credit sale and restore the customer's outstanding balance.
              Sales with <span className="font-bold">partial payments cannot be cancelled</span>.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reason (optional)</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you cancelling?" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={loading}>Keep</Button>
          <Button variant="destructive" size="sm" disabled={loading} onClick={handleSubmit}>
            {loading ? "Cancelling…" : "Cancel Credit Sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Credit Sale Detail Slide-over ─────────────────────────────────────────────

function CreditSaleDetail({ saleId, open, onOpenChange, onRecordPayment, onCancel, canManage }) {
  const navigate = useNavigate();
  const { sale, payments, isLoading } = useCreditSale(open ? saleId : null);

  if (!open) return null;

  const isClosed     = sale?.status === "paid" || sale?.status === "cancelled";
  const outstanding  = sale ? parseFloat(sale.outstanding)  : 0;
  const totalAmount  = sale ? parseFloat(sale.total_amount) : 0;
  const amountPaid   = sale ? parseFloat(sale.amount_paid)  : 0;
  const pctPaid      = totalAmount > 0 ? Math.round((amountPaid / totalAmount) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <div className={cn("h-[3px] w-full shrink-0", {
          "bg-success":     sale?.status === "paid",
          "bg-warning":     sale?.status === "outstanding",
          "bg-primary":     sale?.status === "partial",
          "bg-destructive": sale?.status === "overdue" || sale?.status === "cancelled",
        })} />

        <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold font-mono text-primary">{sale?.reference_no ?? "…"}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{sale?.created_at ? formatDate(sale.created_at) : ""}</p>
            </div>
            {sale && <CreditStatusBadge status={sale.status} />}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading && !sale ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : sale && (
            <>
              {/* Customer + Transaction links */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Customer</p>
                  <Link
                    to={`/customers/${sale.customer_id}`}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <User className="h-3 w-3 shrink-0" />
                    {sale.customer_name}
                    <ArrowUpRight className="h-3 w-3 shrink-0" />
                  </Link>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Transaction</p>
                  <Link
                    to={`/transactions/${sale.transaction_id}`}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline font-mono"
                  >
                    <Receipt className="h-3 w-3 shrink-0" />
                    {sale.reference_no}
                    <ArrowUpRight className="h-3 w-3 shrink-0" />
                  </Link>
                </div>
              </div>

              {/* Balance summary */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Total Amount</span>
                  <span className="text-xs font-mono font-semibold tabular-nums">{formatCurrency(totalAmount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Amount Paid</span>
                  <span className="text-xs font-mono tabular-nums text-success">{formatCurrency(amountPaid)}</span>
                </div>
                <div className="my-1.5 border-t border-border/60" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">Outstanding</span>
                  <span className={cn(
                    "text-sm font-mono font-bold tabular-nums",
                    outstanding > 0 ? "text-warning" : "text-success",
                  )}>
                    {formatCurrency(outstanding)}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", pctPaid >= 100 ? "bg-success" : "bg-primary")}
                    style={{ width: `${Math.min(100, pctPaid)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-right">{pctPaid}% paid</p>
              </div>

              {/* Payment history */}
              {payments.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Payment History</p>
                  <div className="space-y-1.5">
                    {payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
                        <div>
                          <p className="text-xs font-semibold">{formatCurrency(parseFloat(p.amount))}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {p.payment_method.replace("_", " ")} · {formatDateTime(p.created_at)}
                          </p>
                          {p.reference && <p className="text-[10px] text-muted-foreground font-mono">Ref: {p.reference}</p>}
                        </div>
                        <span className="text-[10px] text-success font-semibold">Paid</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {sale.notes && (
                <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
                  <p className="text-xs text-muted-foreground">{sale.notes}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions footer */}
        {sale && canManage && !isClosed && (
          <div className="shrink-0 px-5 py-4 border-t border-border bg-muted/10 flex items-center gap-2">
            <Button
              size="sm"
              variant="success"
              className="flex-1"
              onClick={() => { onOpenChange(false); onRecordPayment(sale); }}
            >
              <Banknote className="h-3.5 w-3.5 mr-1.5" />
              Record Payment
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={() => { onOpenChange(false); onCancel(sale); }}
            >
              <Ban className="h-3.5 w-3.5 mr-1.5" />
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Outstanding Balances Mini-Table ───────────────────────────────────────────

function OutstandingBalancesTable({ outstanding }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? outstanding : outstanding.slice(0, 5);

  if (outstanding.length === 0) return (
    <div className="py-6 text-center">
      <CheckCircle2 className="h-8 w-8 text-success/30 mx-auto mb-2" />
      <p className="text-xs text-muted-foreground">No outstanding balances</p>
    </div>
  );

  return (
    <div className="space-y-1.5">
      {shown.map((row) => {
        const balance    = parseFloat(row.outstanding_balance ?? 0);
        const limit      = parseFloat(row.credit_limit ?? 0);
        const used       = limit > 0 ? Math.min(100, Math.round((balance / limit) * 100)) : 0;
        return (
          <button
            key={row.customer_id}
            onClick={() => navigate(`/customers/${row.customer_id}`)}
            className="w-full flex items-center gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-[10px] font-bold text-primary uppercase">
              {(row.customer_name ?? "?").slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground truncate">{row.customer_name}</p>
                <span className={cn(
                  "text-xs font-mono font-bold tabular-nums shrink-0",
                  balance > 0 ? "text-warning" : "text-success",
                )}>
                  {formatCurrency(balance)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1 rounded-full bg-muted/50 overflow-hidden">
                  <div className={cn("h-full rounded-full", used >= 90 ? "bg-destructive" : used >= 60 ? "bg-warning" : "bg-primary")}
                    style={{ width: `${used}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{used}% of {formatCurrency(limit)}</span>
              </div>
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          </button>
        );
      })}
      {outstanding.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <><ChevronUp className="h-3 w-3" />Show less</> : <><ChevronDown className="h-3 w-3" />{outstanding.length - 5} more customers</>}
        </button>
      )}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function CreditSalesPanel({ preFilterCustomerId } = {}) {
  const navigate   = useNavigate();
  const canManage  = usePermission("credit_sales.update");

  const [search,      setSearch]      = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status,      setStatus]      = useState("");
  const [dateFrom,    setDateFrom]    = useState("");
  const [dateTo,      setDateTo]      = useState("");
  const [page,        setPage]        = useState(1);
  const [detailId,    setDetailId]    = useState(null);
  const [payTarget,   setPayTarget]   = useState(null);
  const [cancelTarget,setCancelTarget]= useState(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { sales, total, totalPages, isLoading, isFetching, recordPayment, cancel } = useCreditSales({
    customerId: preFilterCustomerId,
    search:     debouncedSearch || undefined,
    status:     status          || undefined,
    dateFrom:   dateFrom        || undefined,
    dateTo:     dateTo          || undefined,
    page,
  });

  const { summary, outstanding, overdue } = useCreditSummary();

  const hasFilters = search || status || dateFrom || dateTo;
  const clearFilters = useCallback(() => { setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setPage(1); }, []);

  const handleRecordPayment = useCallback((p) => recordPayment.mutateAsync(p), [recordPayment]);
  const handleCancel        = useCallback((p) => cancel.mutateAsync(p),        [cancel]);

  const columns = useMemo(() => [
    {
      key:    "reference_no",
      header: "Reference",
      render: (row) => (
        <span className="font-mono text-xs text-primary font-semibold">{row.reference_no ?? "—"}</span>
      ),
    },
    {
      key:    "customer_name",
      header: "Customer",
      render: (row) => (
        <Link
          to={`/customers/${row.customer_id}`}
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors w-fit"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-primary/25 bg-primary/10 text-[9px] font-bold text-primary uppercase">
            {(row.customer_name ?? "?").slice(0, 2)}
          </div>
          {row.customer_name}
        </Link>
      ),
    },
    {
      key:    "total_amount",
      header: "Total",
      align:  "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums font-semibold">
          {formatCurrency(parseFloat(row.total_amount))}
        </span>
      ),
    },
    {
      key:    "amount_paid",
      header: "Paid",
      align:  "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums text-success">
          {formatCurrency(parseFloat(row.amount_paid))}
        </span>
      ),
    },
    {
      key:    "outstanding",
      header: "Outstanding",
      align:  "right",
      render: (row) => {
        const amt = parseFloat(row.outstanding);
        return (
          <span className={cn(
            "text-xs font-mono tabular-nums font-bold",
            amt > 0 ? "text-warning" : "text-muted-foreground",
          )}>
            {formatCurrency(amt)}
          </span>
        );
      },
    },
    {
      key:    "status",
      header: "Status",
      render: (row) => <CreditStatusBadge status={row.status} />,
    },
    {
      key:    "created_at",
      header: "Date",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
      ),
    },
    ...(canManage ? [{
      key:    "actions",
      header: "",
      align:  "right",
      render: (row) => {
        const isClosed = row.status === "paid" || row.status === "cancelled";
        if (isClosed) return null;
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost" size="xs"
              className="h-7 px-2 text-[10px] text-success hover:bg-success/10"
              onClick={() => setPayTarget(row)}
            >
              <Banknote className="h-3 w-3 mr-1" />
              Pay
            </Button>
          </div>
        );
      },
    }] : []),
  ], [canManage]);

  return (
    <>
      <PageHeader
        title="Credit Sales"
        description="Track outstanding credit balances and record payments."
        badge={overdue.length > 0 && (
          <span className="flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {overdue.length} overdue
          </span>
        )}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-5 space-y-5">

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Total Credit Sales"
              value={(summary?.total_credit_sales ?? 0).toLocaleString()}
              sub={formatCurrency(parseFloat(summary?.total_credit_amount ?? 0))}
              accent="primary"
            />
            <StatCard
              label="Outstanding"
              value={formatCurrency(parseFloat(summary?.outstanding_amount ?? 0))}
              sub={`${outstanding.length} customer${outstanding.length !== 1 ? "s" : ""} with balance`}
              accent={parseFloat(summary?.outstanding_amount ?? 0) > 0 ? "warning" : "muted"}
            />
            <StatCard
              label="Collected"
              value={formatCurrency(parseFloat(summary?.paid_amount ?? 0))}
              sub="total payments received"
              accent="success"
            />
            <StatCard
              label="Overdue"
              value={(summary?.overdue_count ?? 0).toLocaleString()}
              sub={formatCurrency(parseFloat(summary?.overdue_amount ?? 0))}
              accent={(summary?.overdue_count ?? 0) > 0 ? "destructive" : "muted"}
            />
          </div>

          <div className="grid grid-cols-3 gap-5">
            {/* Main table (2/3) */}
            <div className="col-span-2 space-y-4">
              <Section
                title="Credit Sales"
                icon={CreditCard}
                action={isFetching && !isLoading && (
                  <span className="text-[10px] text-muted-foreground animate-pulse">Refreshing…</span>
                )}
              >
                {/* Filters */}
                <div className="space-y-3 mb-4">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                      placeholder="Search reference, customer…"
                      className="pl-9 h-8 text-xs"
                    />
                    {search && (
                      <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                        className="h-8 text-xs w-[130px]" />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                        className="h-8 text-xs w-[130px]" />
                    </div>
                    {hasFilters && (
                      <Button variant="ghost" size="xs" onClick={clearFilters} className="h-8 gap-1">
                        <X className="h-3 w-3" />Clear
                      </Button>
                    )}
                  </div>
                  <TabBar active={status} onChange={(v) => { setStatus(v); setPage(1); }} />
                </div>

                <DataTable
                  columns={columns}
                  data={sales}
                  isLoading={isLoading}
                  onRowClick={(row) => setDetailId(row.id)}
                  pagination={{ page, pageSize: 25, total, onPageChange: setPage }}
                  emptyState={
                    <EmptyState
                      icon={CreditCard}
                      title={hasFilters ? "No matching credit sales" : "No credit sales yet"}
                      description={hasFilters ? "Try clearing filters." : "Credit sales are created when payment method is set to Credit in POS."}
                      compact
                    />
                  }
                />
              </Section>
            </div>

            {/* Outstanding balances sidebar (1/3) */}
            <div className="space-y-4">
              <Section title="Outstanding Balances" icon={User}
                action={
                  <span className="text-[11px] text-muted-foreground">{outstanding.length} customers</span>
                }
              >
                <OutstandingBalancesTable outstanding={outstanding} />
              </Section>

              {overdue.length > 0 && (
                <Section title="Overdue Sales" icon={AlertTriangle} className="border-destructive/20">
                  <div className="space-y-1.5">
                    {overdue.slice(0, 4).map((row) => (
                      <button
                        key={row.id}
                        onClick={() => setDetailId(row.id)}
                        className="w-full flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 hover:bg-destructive/10 transition-colors text-left"
                      >
                        <div>
                          <p className="text-xs font-semibold text-foreground">{row.customer_name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {row.days_overdue ?? 0}d overdue · {row.reference_no}
                          </p>
                        </div>
                        <span className="text-xs font-mono font-bold text-destructive tabular-nums">
                          {formatCurrency(parseFloat(row.outstanding))}
                        </span>
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Detail slide-over */}
      <CreditSaleDetail
        saleId={detailId}
        open={!!detailId}
        onOpenChange={(v) => !v && setDetailId(null)}
        onRecordPayment={setPayTarget}
        onCancel={setCancelTarget}
        canManage={canManage}
      />

      {/* Record payment modal */}
      <RecordPaymentModal
        open={!!payTarget}
        onOpenChange={(v) => !v && setPayTarget(null)}
        sale={payTarget}
        onConfirm={handleRecordPayment}
      />

      {/* Cancel dialog */}
      <CancelDialog
        open={!!cancelTarget}
        onOpenChange={(v) => !v && setCancelTarget(null)}
        sale={cancelTarget}
        onConfirm={handleCancel}
      />
    </>
  );
}
