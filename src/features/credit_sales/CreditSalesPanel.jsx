// ============================================================================
// features/credit_sales/CreditSalesPanel.jsx
// ============================================================================
import { useState, useMemo, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CreditCard, Search, X, Calendar as CalendarIcon, AlertTriangle,
  CheckCircle2, Clock, User, Receipt, ArrowUpRight, Banknote,
  Smartphone, ChevronDown, ChevronUp, Ban, TrendingDown,
  TrendingUp, Wallet, Loader2, CircleDollarSign,
} from "lucide-react";
import { useQuery }       from "@tanstack/react-query";
import { Calendar }       from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { useCreditSales, useCreditSummary, useCreditSale } from "./useCreditSales";
import { getWalletBalance }  from "@/commands/customer_wallet";
import { PageHeader }        from "@/components/shared/PageHeader";
import { DataTable }         from "@/components/shared/DataTable";
import { EmptyState }        from "@/components/shared/EmptyState";
import { Button }            from "@/components/ui/button";
import { Input }             from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }               from "@/lib/utils";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { usePermission }       from "@/hooks/usePermission";
import { usePaginationParams } from "@/hooks/usePaginationParams";
import { toast }              from "sonner";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "",            label: "All"         },
  { key: "outstanding", label: "Outstanding" },
  { key: "partial",     label: "Partial"     },
  { key: "paid",        label: "Paid"        },
  { key: "overdue",     label: "Overdue"     },
];

const STATUS_CFG = {
  outstanding: { cls: "bg-warning/10 text-warning border-warning/20",             dot: "bg-warning"          },
  partial:     { cls: "bg-primary/10 text-primary border-primary/20",             dot: "bg-primary"          },
  paid:        { cls: "bg-success/10 text-success border-success/20",             dot: "bg-success"          },
  overdue:     { cls: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive"      },
  cancelled:   { cls: "bg-muted/50 text-muted-foreground border-border/60",       dot: "bg-muted-foreground" },
};

const PAYMENT_METHODS = [
  { value: "cash",         label: "Cash",            icon: "💵" },
  { value: "card",         label: "Card",            icon: "💳" },
  { value: "transfer",     label: "Bank Transfer",   icon: "🏦" },
  { value: "mobile_money", label: "Mobile Money",   icon: "📱" },
  { value: "wallet",       label: "Customer Wallet", icon: "👛" },
];

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
function toIso(date) {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function toLocalDate(iso) {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ── DateRangePicker ───────────────────────────────────────────────────────────

function DateRangePicker({ dateFrom, dateTo, onDateRangeChange }) {
  const [open, setOpen] = useState(false);
  const range = { from: toLocalDate(dateFrom), to: toLocalDate(dateTo) };

  function handleSelect(sel) {
    onDateRangeChange(toIso(sel?.from), toIso(sel?.to));
    if (sel?.from && sel?.to) setOpen(false);
  }

  const fromLabel = fmtDate(dateFrom);
  const toLabel   = fmtDate(dateTo);
  const label =
    fromLabel && toLabel ? `${fromLabel} – ${toLabel}` :
    fromLabel            ? `From ${fromLabel}` :
    toLabel              ? `To ${toLabel}` :
    "Pick date range";
  const hasDate = !!(dateFrom || dateTo);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
            hasDate
              ? "border-primary/40 bg-primary/8 text-primary hover:bg-primary/15"
              : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[200px] truncate">{label}</span>
          {hasDate && (
            <span
              role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onDateRangeChange("", ""); }}
              onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onDateRangeChange("", ""))}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-primary/60 hover:text-primary hover:bg-primary/20 transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" sideOffset={6}
        className="w-auto p-0 bg-card border-border shadow-xl shadow-black/40">
        <div className="flex flex-wrap gap-1.5 px-3 pt-3 pb-2 border-b border-border/50">
          {[
            { label: "Today",      fn: () => { const t = toIso(new Date()); onDateRangeChange(t, t); setOpen(false); } },
            { label: "Yesterday",  fn: () => { const y = new Date(); y.setDate(y.getDate()-1); const s=toIso(y); onDateRangeChange(s,s); setOpen(false); } },
            { label: "This week",  fn: () => { const n=new Date(),mo=new Date(n); mo.setDate(n.getDate()-((n.getDay()+6)%7)); onDateRangeChange(toIso(mo),toIso(n)); setOpen(false); } },
            { label: "This month", fn: () => { const n=new Date(); onDateRangeChange(toIso(new Date(n.getFullYear(),n.getMonth(),1)),toIso(n)); setOpen(false); } },
            { label: "Last 30 d",  fn: () => { const n=new Date(),a=new Date(); a.setDate(n.getDate()-29); onDateRangeChange(toIso(a),toIso(n)); setOpen(false); } },
          ].map(({ label, fn }) => (
            <button key={label} type="button" onClick={fn}
              className="rounded-md bg-muted/50 border border-border/50 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors">
              {label}
            </button>
          ))}
        </div>
        <Calendar mode="range" selected={range} onSelect={handleSelect}
          numberOfMonths={2} disabled={{ after: new Date() }} initialFocus />
        <div className="flex items-center justify-between px-3 py-2 border-t border-border/50 bg-muted/10">
          <span className="text-[10px] text-muted-foreground">
            {fromLabel && toLabel ? `${fromLabel} → ${toLabel}` : fromLabel ? `From ${fromLabel} — pick end` : "Click a start date"}
          </span>
          {hasDate && (
            <button type="button" onClick={() => onDateRangeChange("", "")}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors">Clear</button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── CreditStatusBadge ─────────────────────────────────────────────────────────

function CreditStatusBadge({ status }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.outstanding;
  const labels = { outstanding: "Unpaid", partial: "Partial", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled" };
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
      cfg.cls,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      {labels[status] ?? status}
    </span>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = "default", icon: Icon }) {
  const styles = {
    default:     { wrap: "border-border/60 bg-card",                      icon: "bg-muted/40 text-muted-foreground",   val: "text-foreground"       },
    primary:     { wrap: "border-primary/20 bg-primary/[0.04]",            icon: "bg-primary/12 text-primary",         val: "text-primary"          },
    success:     { wrap: "border-success/20 bg-success/[0.04]",            icon: "bg-success/12 text-success",         val: "text-success"          },
    warning:     { wrap: "border-warning/20 bg-warning/[0.04]",            icon: "bg-warning/12 text-warning",         val: "text-warning"          },
    destructive: { wrap: "border-destructive/20 bg-destructive/[0.04]",    icon: "bg-destructive/12 text-destructive", val: "text-destructive"      },
    muted:       { wrap: "border-border/60 bg-muted/20",                   icon: "bg-muted/40 text-muted-foreground",  val: "text-muted-foreground" },
  }[accent] ?? {};
  return (
    <div className={cn(
      "relative flex flex-col gap-3 rounded-xl border px-4 py-4 overflow-hidden",
      "transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5",
      styles.wrap,
    )}>
      <div className="flex items-start justify-between">
        {Icon && (
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", styles.icon)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className={cn("text-2xl font-bold tabular-nums leading-none tracking-tight", styles.val)}>{value}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">{label}</span>
        {sub && <span className="text-[11px] text-muted-foreground mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// ── TabBar ────────────────────────────────────────────────────────────────────

function TabBar({ active, onChange, counts = {} }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-1 border border-border/50">
      {STATUS_TABS.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground hover:bg-card/50",
          )}>
          {tab.label}
          {counts[tab.key] != null && (
            <span className={cn(
              "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
              active === tab.key ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground",
            )}>
              {counts[tab.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── RecordPaymentModal ────────────────────────────────────────────────────────

function RecordPaymentModal({ open, onOpenChange, sale, onConfirm }) {
  const [amount,  setAmount]  = useState("");
  const [method,  setMethod]  = useState("cash");
  const [notes,   setNotes]   = useState("");
  const [ref,     setRef]     = useState("");
  const [saving,  setSaving]  = useState(false);

  // Live wallet balance — fetched when the modal is open and a customer is set
  const { data: walletData, isLoading: walletLoading } = useQuery({
    queryKey:  ["wallet-balance", sale?.customer_id],
    queryFn:   () => getWalletBalance(sale.customer_id),
    enabled:   !!(open && sale?.customer_id),
    staleTime: 30_000,
  });
  const walletBalance = parseFloat(walletData?.balance ?? 0);
  const outstanding   = sale ? parseFloat(sale.outstanding) : 0;

  const handleOpenChange = (val) => {
    if (!val) { setAmount(""); setMethod("cash"); setNotes(""); setRef(""); setSaving(false); }
    else if (sale) setAmount(outstanding.toFixed(2));
    onOpenChange(val);
  };

  // Auto-clamp amount when wallet method is chosen
  useEffect(() => {
    if (method === "wallet" && walletBalance > 0) {
      setAmount(Math.min(walletBalance, outstanding).toFixed(2));
    }
  }, [method, walletBalance, outstanding]);

  const parsedAmt   = parseFloat(amount);
  const isWallet    = method === "wallet";
  const walletShort = isWallet && !isNaN(parsedAmt) && walletBalance < parsedAmt;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isNaN(parsedAmt) || parsedAmt <= 0) { toast.error("Enter a valid amount."); return; }
    if (parsedAmt > outstanding + 0.001) {
      toast.error(`Amount exceeds outstanding balance of ${formatCurrency(outstanding)}.`); return;
    }
    if (isWallet && parsedAmt > walletBalance + 0.001) {
      toast.error(`Wallet balance (${formatCurrency(walletBalance)}) is insufficient.`); return;
    }
    setSaving(true);
    try {
      await onConfirm({ creditSaleId: sale.id, amount: parsedAmt, paymentMethod: method, notes, reference: ref });
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
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden bg-card border-border shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-success" />
        <div className="p-6 pb-4">
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-success/25 bg-success/10">
              <CircleDollarSign className="h-5 w-5 text-success" />
            </div>
            <div>
              <DialogTitle className="text-[15px] font-bold">Record Payment</DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                {sale?.customer_name} · Outstanding:{" "}
                <span className="font-semibold text-warning">{formatCurrency(outstanding)}</span>
              </DialogDescription>
            </div>
          </div>

          {/* Wallet banner */}
          {walletLoading && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-3">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking wallet…
            </div>
          )}
          {!walletLoading && walletBalance > 0 && (
            <div className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 mb-4",
              method === "wallet"
                ? "border-violet-500/30 bg-violet-500/8"
                : "border-border/60 bg-muted/20",
            )}>
              <Wallet className="h-4 w-4 text-violet-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-foreground">
                  Wallet available:{" "}
                  <span className="text-violet-400 tabular-nums font-mono">{formatCurrency(walletBalance)}</span>
                </p>
                <p className="text-[10px] text-muted-foreground">Select "Customer Wallet" to debit</p>
              </div>
              {method !== "wallet" && (
                <button type="button" onClick={() => setMethod("wallet")}
                  className="shrink-0 text-[10px] font-semibold text-violet-400 hover:text-violet-300 transition-colors">
                  Use →
                </button>
              )}
            </div>
          )}

          <form id="credit-payment-form" onSubmit={handleSubmit} className="space-y-3.5">
            {/* Amount */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Amount (₦) <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₦</span>
                <Input
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  type="number" min="0.01" step="0.01" placeholder="0.00"
                  className="pl-7 h-10 text-base font-mono tabular-nums bg-background/60"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setAmount(outstanding.toFixed(2))}
                  className="text-[10px] text-primary hover:underline">
                  Full outstanding ({formatCurrency(outstanding)})
                </button>
                {walletBalance > 0 && walletBalance < outstanding && (
                  <>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <button type="button" onClick={() => setAmount(walletBalance.toFixed(2))}
                      className="text-[10px] text-violet-400 hover:underline">
                      Wallet max ({formatCurrency(walletBalance)})
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Payment method */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment Method</label>
              <div className="grid grid-cols-2 gap-1.5">
                {PAYMENT_METHODS
                  .filter((m) => m.value !== "wallet" || walletBalance > 0)
                  .map((m) => (
                    <button key={m.value} type="button" onClick={() => setMethod(m.value)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all text-left",
                        method === m.value
                          ? m.value === "wallet"
                            ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                            : "border-primary/40 bg-primary/8 text-primary"
                          : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                      )}>
                      <span className="text-sm">{m.icon}</span>
                      {m.label}
                    </button>
                  ))}
              </div>
              {walletShort && (
                <p className="text-[10px] text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Wallet balance ({formatCurrency(walletBalance)}) is less than the entered amount.
                </p>
              )}
            </div>

            {/* Reference */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Reference <span className="text-muted-foreground/50 font-normal normal-case">(optional)</span>
              </label>
              <Input value={ref} onChange={(e) => setRef(e.target.value)}
                placeholder="Cheque no., transfer ref…" className="h-8 text-sm" />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Notes <span className="text-muted-foreground/50 font-normal normal-case">(optional)</span>
              </label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Any remarks…" className="h-8 text-sm" />
            </div>
          </form>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="credit-payment-form" size="sm"
            className="bg-success hover:bg-success/90 text-white"
            disabled={saving || walletShort}>
            {saving
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Recording…</>
              : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CancelDialog ──────────────────────────────────────────────────────────────

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
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden bg-card border-border shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10">
              <Ban className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold">Cancel Credit Sale?</DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                {sale?.reference_no} · {sale?.customer_name}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-[11px] text-destructive leading-relaxed">
              This will cancel the credit sale. Sales with{" "}
              <span className="font-bold">partial payments cannot be cancelled</span>.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Reason <span className="text-muted-foreground/50 font-normal normal-case">(optional)</span>
            </label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you cancelling?" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={loading}>Keep</Button>
          <Button variant="destructive" size="sm" disabled={loading} onClick={handleSubmit}>
            {loading
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Cancelling…</>
              : "Cancel Sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CreditSaleDetail ──────────────────────────────────────────────────────────

function CreditSaleDetail({ saleId, open, onOpenChange, onRecordPayment, onCancel, canManage }) {
  const { sale, payments, isLoading } = useCreditSale(open ? saleId : null);

  if (!open) return null;

  const isClosed    = sale?.status === "paid" || sale?.status === "cancelled";
  const outstanding = sale ? parseFloat(sale.outstanding)  : 0;
  const totalAmount = sale ? parseFloat(sale.total_amount) : 0;
  const amountPaid  = sale ? parseFloat(sale.amount_paid)  : 0;
  const pctPaid     = totalAmount > 0 ? Math.round((amountPaid / totalAmount) * 100) : 0;
  const statusColor = {
    paid:        "bg-success", outstanding: "bg-warning",
    partial:     "bg-primary", overdue:     "bg-destructive", cancelled: "bg-muted",
  }[sale?.status] ?? "bg-border";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col bg-card border-border shadow-2xl shadow-black/60">
        <div className={cn("h-[3px] w-full shrink-0", statusColor)} />

        <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold font-mono text-primary">{sale?.reference_no ?? "…"}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {sale?.created_at ? formatDate(sale.created_at) : ""}
              </p>
            </div>
            {sale && <CreditStatusBadge status={sale.status} />}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading && !sale ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sale && (
            <>
              {/* Links */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Customer",    icon: User,    to: `/customers/${sale.customer_id}`,      text: sale.customer_name },
                  { label: "Transaction", icon: Receipt, to: `/transactions/${sale.transaction_id}`, text: sale.reference_no, mono: true },
                ].map(({ label, icon: Icon, to, text, mono }) => (
                  <div key={label} className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
                    <Link to={to} onClick={() => onOpenChange(false)}
                      className={cn("flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline", mono && "font-mono")}>
                      <Icon className="h-3 w-3 shrink-0" />{text}<ArrowUpRight className="h-3 w-3 shrink-0" />
                    </Link>
                  </div>
                ))}
              </div>

              {/* Balance */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                {[
                  { label: "Total Amount", val: formatCurrency(totalAmount), cls: "text-foreground" },
                  { label: "Amount Paid",  val: formatCurrency(amountPaid),  cls: "text-success"    },
                ].map(({ label, val, cls }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className={cn("text-xs font-mono font-semibold tabular-nums", cls)}>{val}</span>
                  </div>
                ))}
                <div className="border-t border-border/60" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">Outstanding</span>
                  <span className={cn("text-sm font-mono font-bold tabular-nums", outstanding > 0 ? "text-warning" : "text-success")}>
                    {formatCurrency(outstanding)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", pctPaid >= 100 ? "bg-success" : "bg-primary")}
                    style={{ width: `${Math.min(100, pctPaid)}%` }} />
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
                            {p.payment_method.replace(/_/g, " ")} · {formatDateTime(p.created_at)}
                          </p>
                          {p.reference && (
                            <p className="text-[10px] text-muted-foreground font-mono">Ref: {p.reference}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-success font-bold">✓ Paid</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sale.notes && (
                <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
                  <p className="text-xs text-muted-foreground">{sale.notes}</p>
                </div>
              )}
            </>
          )}
        </div>

        {sale && canManage && !isClosed && (
          <div className="shrink-0 px-5 py-4 border-t border-border bg-muted/10 flex items-center gap-2">
            <Button size="sm" className="flex-1 bg-success hover:bg-success/90 text-white"
              onClick={() => { onOpenChange(false); onRecordPayment(sale); }}>
              <CircleDollarSign className="h-3.5 w-3.5 mr-1.5" /> Record Payment
            </Button>
            <Button size="sm" variant="outline"
              className="border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={() => { onOpenChange(false); onCancel(sale); }}>
              <Ban className="h-3.5 w-3.5 mr-1.5" /> Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── OutstandingBalancesTable ──────────────────────────────────────────────────

function OutstandingBalancesTable({ outstanding }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? outstanding : outstanding.slice(0, 5);

  if (outstanding.length === 0) return (
    <div className="py-8 text-center">
      <CheckCircle2 className="h-8 w-8 text-success/30 mx-auto mb-2" />
      <p className="text-xs text-muted-foreground">No outstanding balances</p>
    </div>
  );

  return (
    <div className="space-y-1.5">
      {shown.map((row) => {
        const balance = parseFloat(row.outstanding_balance ?? 0);
        const limit   = parseFloat(row.credit_limit ?? 0);
        const used    = limit > 0 ? Math.min(100, Math.round((balance / limit) * 100)) : 0;
        return (
          <button key={row.customer_id} onClick={() => navigate(`/customers/${row.customer_id}`)}
            className="w-full flex items-center gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-[10px] font-bold text-primary uppercase">
              {(row.customer_name ?? "?").slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground truncate">{row.customer_name}</p>
                <span className={cn("text-xs font-mono font-bold tabular-nums shrink-0 ml-2",
                  balance > 0 ? "text-warning" : "text-success")}>
                  {formatCurrency(balance)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1 rounded-full bg-muted/50 overflow-hidden">
                  <div className={cn("h-full rounded-full",
                    used >= 90 ? "bg-destructive" : used >= 60 ? "bg-warning" : "bg-primary")}
                    style={{ width: `${used}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{used}%</span>
              </div>
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          </button>
        );
      })}
      {outstanding.length > 5 && (
        <button onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          {expanded
            ? <><ChevronUp className="h-3 w-3" />Show less</>
            : <><ChevronDown className="h-3 w-3" />{outstanding.length - 5} more customers</>}
        </button>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function CreditSalesPanel({ preFilterCustomerId } = {}) {
  const navigate  = useNavigate();
  const canManage = usePermission("credit_sales.update");

  const { page, search, setPage, setSearch } = usePaginationParams({ defaultPageSize: 25 });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status,       setStatus]      = useState("");
  const [dateFrom,     setDateFrom]    = useState("");
  const [dateTo,       setDateTo]      = useState("");
  const [detailId,     setDetailId]    = useState(null);
  const [payTarget,    setPayTarget]   = useState(null);
  const [cancelTarget, setCancelTarget]= useState(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { sales, total, isLoading, isFetching, recordPayment, cancel } = useCreditSales({
    customerId: preFilterCustomerId,
    search:     debouncedSearch || undefined,
    status:     status          || undefined,
    dateFrom:   dateFrom        || undefined,
    dateTo:     dateTo          || undefined,
    page,
  });

  const { summary, outstanding, overdue } = useCreditSummary();

  const hasFilters = search || status || dateFrom || dateTo;
  const clearFilters = useCallback(() => {
    setSearch(""); setStatus(""); setDateFrom(""); setDateTo("");
  }, [setSearch]);

  const handleDateRangeChange = useCallback((from, to) => {
    setDateFrom(from); setDateTo(to); setPage(1);
  }, [setPage]);

  const handleRecordPayment = useCallback((p) => recordPayment.mutateAsync(p), [recordPayment]);
  const handleCancel        = useCallback((p) => cancel.mutateAsync(p),        [cancel]);

  const tabCounts = useMemo(() => ({
    "":           total,
    outstanding:  summary?.outstanding_count ?? undefined,
    partial:      summary?.partial_count     ?? undefined,
    paid:         summary?.paid_count        ?? undefined,
    overdue:      summary?.overdue_count     ?? undefined,
  }), [total, summary]);

  const columns = useMemo(() => [
    {
      key:    "reference_no",
      header: "Reference",
      render: (row) => (
        <span className="font-mono text-[12px] text-primary font-bold tracking-wide">
          {row.reference_no ?? "—"}
        </span>
      ),
    },
    {
      key:    "customer_name",
      header: "Customer",
      render: (row) => (
        <Link to={`/customers/${row.customer_id}`}
          className="flex items-center gap-2 text-xs font-semibold text-foreground hover:text-primary transition-colors w-fit"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-[9px] font-bold text-primary uppercase">
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
      key:    "outstanding",
      header: "Outstanding",
      align:  "right",
      render: (row) => {
        const ttl  = parseFloat(row.total_amount);
        const owed = parseFloat(row.outstanding);
        const pct  = ttl > 0 ? Math.round((parseFloat(row.amount_paid) / ttl) * 100) : 0;
        return (
          <div className="text-right">
            <span className={cn(
              "text-xs font-mono tabular-nums font-bold",
              owed > 0 ? "text-warning" : "text-muted-foreground",
            )}>
              {formatCurrency(owed)}
            </span>
            <div className="flex items-center gap-1.5 mt-1 justify-end">
              <div className="w-16 h-1 rounded-full bg-muted/50 overflow-hidden">
                <div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-primary")}
                  style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[9px] text-muted-foreground tabular-nums">{pct}%</span>
            </div>
          </div>
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
        <span className="text-[11px] text-muted-foreground tabular-nums">{formatDate(row.created_at)}</span>
      ),
    },
    ...(canManage ? [{
      key:    "_actions",
      header: "",
      align:  "right",
      render: (row) => {
        const isClosed = row.status === "paid" || row.status === "cancelled";
        if (isClosed) return <span className="text-[10px] text-muted-foreground/40">—</span>;
        return (
          <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="xs"
              className="h-7 px-2.5 text-[11px] text-success hover:bg-success/10 hover:text-success gap-1"
              onClick={() => setPayTarget(row)}>
              <CircleDollarSign className="h-3.5 w-3.5" /> Pay
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
        description="Track outstanding balances and collect payments from credit customers."
        badge={overdue.length > 0 && (
          <span className="flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {overdue.length} overdue
          </span>
        )}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total Credit Sales"
              value={(summary?.total_credit_sales ?? 0).toLocaleString()}
              sub={formatCurrency(parseFloat(summary?.total_credit_amount ?? 0))}
              accent="primary" icon={CreditCard} />
            <StatCard label="Outstanding"
              value={formatCurrency(parseFloat(summary?.outstanding_amount ?? 0))}
              sub={`${outstanding.length} customer${outstanding.length !== 1 ? "s" : ""} with balance`}
              accent={parseFloat(summary?.outstanding_amount ?? 0) > 0 ? "warning" : "muted"}
              icon={Clock} />
            <StatCard label="Collected"
              value={formatCurrency(parseFloat(summary?.paid_amount ?? 0))}
              sub="total payments received"
              accent="success" icon={TrendingUp} />
            <StatCard label="Overdue"
              value={(summary?.overdue_count ?? 0).toLocaleString()}
              sub={formatCurrency(parseFloat(summary?.overdue_amount ?? 0))}
              accent={(summary?.overdue_count ?? 0) > 0 ? "destructive" : "muted"}
              icon={TrendingDown} />
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-3 gap-5">

            {/* Table — 2/3 */}
            <div className="col-span-2">
              <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                {/* Card header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/10">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                      <CreditCard className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <h2 className="text-sm font-semibold text-foreground">Credit Sales</h2>
                    {total > 0 && (
                      <span className="text-[10px] font-semibold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 tabular-nums">
                        {total.toLocaleString()} records
                      </span>
                    )}
                  </div>
                  {isFetching && !isLoading && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      <span className="text-[10px] text-muted-foreground">Refreshing</span>
                    </div>
                  )}
                </div>

                <div className="px-5 pt-4">
                  {/* Filter row */}
                  <div className="flex flex-wrap items-center gap-2 pb-3">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="Reference, customer…"
                        className="pl-8 h-8 text-xs bg-muted/30 border-border/60 focus:bg-background"
                      />
                      {search && (
                        <button onClick={() => setSearch("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <DateRangePicker
                      dateFrom={dateFrom} dateTo={dateTo}
                      onDateRangeChange={handleDateRangeChange}
                    />
                    {hasFilters && (
                      <Button variant="ghost" size="xs" onClick={clearFilters}
                        className="h-8 gap-1 text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" /> Clear
                      </Button>
                    )}
                  </div>
                  {/* Status tabs */}
                  <div className="pb-4">
                    <TabBar active={status} counts={tabCounts}
                      onChange={(v) => { setStatus(v); setPage(1); }} />
                  </div>
                </div>

                <div className="px-5 pb-5">
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
                        description={
                          hasFilters
                            ? "Try clearing your filters."
                            : "Credit sales appear when a POS transaction uses Credit as the payment method."
                        }
                        compact
                      />
                    }
                  />
                </div>
              </div>
            </div>

            {/* Sidebar — 1/3 */}
            <div className="space-y-4">
              {/* Outstanding balances */}
              <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-4 py-3.5 border-b border-border bg-muted/10">
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Outstanding Balances
                    </h3>
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5">
                    {outstanding.length}
                  </span>
                </div>
                <div className="p-4">
                  <OutstandingBalancesTable outstanding={outstanding} />
                </div>
              </div>

              {/* Overdue */}
              {overdue.length > 0 && (
                <div className="rounded-xl border border-destructive/20 bg-card overflow-hidden shadow-sm">
                  <div className="flex items-center gap-2 px-4 py-3.5 border-b border-destructive/15 bg-destructive/5">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-destructive/70">Overdue</h3>
                    <span className="ml-auto text-[10px] font-bold text-destructive bg-destructive/10 border border-destructive/20 rounded-full px-2 py-0.5">
                      {overdue.length}
                    </span>
                  </div>
                  <div className="p-4 space-y-1.5">
                    {overdue.slice(0, 5).map((row) => (
                      <button key={row.id} onClick={() => setDetailId(row.id)}
                        className="w-full flex items-center justify-between rounded-lg border border-destructive/15 bg-destructive/5 px-3 py-2.5 hover:bg-destructive/10 transition-colors text-left">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{row.customer_name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {row.days_overdue ?? 0}d overdue · <span className="font-mono">{row.reference_no}</span>
                          </p>
                        </div>
                        <span className="text-xs font-mono font-bold text-destructive tabular-nums ml-2 shrink-0">
                          {formatCurrency(parseFloat(row.outstanding))}
                        </span>
                      </button>
                    ))}
                    {overdue.length > 5 && (
                      <p className="text-[10px] text-muted-foreground text-center pt-1">
                        +{overdue.length - 5} more overdue
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <CreditSaleDetail
        saleId={detailId}
        open={!!detailId}
        onOpenChange={(v) => !v && setDetailId(null)}
        onRecordPayment={setPayTarget}
        onCancel={setCancelTarget}
        canManage={canManage}
      />
      <RecordPaymentModal
        open={!!payTarget}
        onOpenChange={(v) => !v && setPayTarget(null)}
        sale={payTarget}
        onConfirm={handleRecordPayment}
      />
      <CancelDialog
        open={!!cancelTarget}
        onOpenChange={(v) => !v && setCancelTarget(null)}
        sale={cancelTarget}
        onConfirm={handleCancel}
      />
    </>
  );
}
