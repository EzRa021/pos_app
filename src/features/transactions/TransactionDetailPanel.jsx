// ============================================================================
// features/transactions/TransactionDetailPanel.jsx
// ============================================================================
import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  AlertTriangle, Ban, RefreshCw, RotateCcw,
  User, CreditCard, Package, FileText,
  Loader2, ChevronRight, Printer, Copy, Check, ArrowUpRight,
} from "lucide-react";
import { usePrintReceipt } from "@/hooks/usePrintReceipt";
import { toast } from "sonner";

import { useTransaction }        from "./useTransactions";
import { InitiateReturnModal }   from "@/features/returns/InitiateReturnModal";
import { PageHeader }            from "@/components/shared/PageHeader";
import { StatusBadge }      from "@/components/shared/StatusBadge";
import { Spinner }          from "@/components/shared/Spinner";
import { EmptyState }       from "@/components/shared/EmptyState";
import { Button }           from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input }            from "@/components/ui/input";
import { cn }               from "@/lib/utils";
import {
  formatCurrency, formatDateTime, formatDate, formatRef, formatQuantity, stepForType,
} from "@/lib/format";
import { usePermission }    from "@/hooks/usePermission";

// ── Helpers ───────────────────────────────────────────────────────────────────
const PAYMENT_LABELS = {
  cash:         "Cash",
  card:         "Card",
  transfer:     "Bank Transfer",
  mobile_money: "Mobile Money",
  credit:       "Credit",
  wallet:       "Wallet",
  split:        "Split Payment",
};

// Payments whose method starts with "refund_" are bookkeeping entries written
// when a refund/void is processed — they should never appear in the breakdown.
const isRefundEntry = (p) => p.payment_method?.startsWith("refund_");

function Section({ title, icon: Icon, children, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono = false, valueClass }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs font-medium text-right", mono && "font-mono tabular-nums", valueClass)}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function SummaryLine({ label, value, large, accent, separator }) {
  return (
    <>
      {separator && <div className="my-2 border-t border-border/60" />}
      <div className="flex items-center justify-between py-1">
        <span className={cn("text-xs", large ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</span>
        <span className={cn(
          "font-mono tabular-nums",
          large ? "text-base font-bold" : "text-xs",
          accent === "success"     && "text-success",
          accent === "destructive" && "text-destructive",
          !accent                  && (large ? "text-foreground" : "text-muted-foreground"),
        )}>
          {value}
        </span>
      </div>
    </>
  );
}

// ── VoidModal ─────────────────────────────────────────────────────────────────
function VoidModal({ open, onOpenChange, tx, onConfirm, isLoading }) {
  const [reason, setReason] = useState("");
  const [notes,  setNotes]  = useState("");

  useEffect(() => { if (open) { setReason(""); setNotes(""); } }, [open]);

  async function handleSubmit() {
    if (!reason.trim()) { toast.error("Please provide a void reason"); return; }
    await onConfirm({ reason: reason.trim(), notes: notes.trim() || undefined });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="px-6 pt-5 pb-6 space-y-4">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10">
                <Ban className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">Void Transaction</DialogTitle>
                <DialogDescription className="text-xs mt-0.5 text-muted-foreground">
                  {formatRef(tx?.reference_no)} · Same-day voids only
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Warning */}
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning/8 px-3.5 py-3">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[11px] text-warning/90 leading-relaxed">
              This will permanently void the transaction and restore all stock. This action{" "}
              <span className="font-bold">cannot be undone</span>.
            </p>
          </div>

          {/* Fields */}
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
                Void Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Duplicate transaction, customer changed mind…"
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/60"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional context…"
                className="text-sm"
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !reason.trim()}
              className="flex-1 bg-destructive hover:bg-destructive/90 text-white"
            >
              {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Voiding…</> : "Void Transaction"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── FullRefundModal ───────────────────────────────────────────────────────────
function FullRefundModal({ open, onOpenChange, tx, onConfirm, isLoading }) {
  const [reason, setReason] = useState("");
  const [notes,  setNotes]  = useState("");

  useEffect(() => { if (open) { setReason(""); setNotes(""); } }, [open]);

  async function handleSubmit() {
    if (!reason.trim()) { toast.error("Please provide a refund reason"); return; }
    await onConfirm({ reason: reason.trim(), notes: notes.trim() || undefined });
  }

  const total = formatCurrency(parseFloat(tx?.total_amount ?? 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-warning" />
        <div className="px-6 pt-5 pb-6 space-y-4">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/25 bg-warning/10">
                <RotateCcw className="h-5 w-5 text-warning" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">Full Refund</DialogTitle>
                <DialogDescription className="text-xs mt-0.5 text-muted-foreground">
                  {formatRef(tx?.reference_no)} · Refund amount: {total}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Warning */}
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning/8 px-3.5 py-3">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[11px] text-warning/90 leading-relaxed">
              This will refund the full amount of{" "}
              <span className="font-bold">{total}</span> and restore all stock.
              The transaction will be marked as fully refunded.
            </p>
          </div>

          {/* Fields */}
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
                Refund Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Defective product, wrong item delivered…"
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/60"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional context…"
                className="text-sm"
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !reason.trim()}
              className="flex-1 bg-warning hover:bg-warning/90 text-white"
            >
              {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Processing…</> : `Refund ${total}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── PartialRefundModal ────────────────────────────────────────────────────────
function PartialRefundModal({ open, onOpenChange, tx, txItems, onConfirm, isLoading }) {
  // State: { [item_id]: { enabled, quantity, reason } }
  const [itemState, setItemState] = useState({});
  const [notes, setNotes]         = useState("");

  // Initialise when opened
  useEffect(() => {
    if (open && txItems?.length) {
      const init = {};
      txItems.forEach((item) => {
        init[item.item_id] = { enabled: false, quantity: 1, reason: "" };
      });
      setItemState(init);
      setNotes("");
    }
  }, [open, txItems]);

  const updateItem = (id, patch) =>
    setItemState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Live refund total
  const { refundTotal, selectedCount } = useMemo(() => {
    let total = 0;
    let count = 0;
    (txItems ?? []).forEach((item) => {
      const s = itemState[item.item_id];
      if (!s?.enabled) return;
      count++;
      const unitPrice = parseFloat(item.line_total) / parseFloat(item.quantity);
      total += unitPrice * s.quantity;
    });
    return { refundTotal: total, selectedCount: count };
  }, [itemState, txItems]);

  async function handleSubmit() {
    if (selectedCount === 0) { toast.error("Select at least one item to refund"); return; }
    const items = (txItems ?? [])
      .filter((item) => itemState[item.item_id]?.enabled)
      .map((item) => ({
        item_id:  item.item_id,
        quantity: itemState[item.item_id].quantity,
        reason:   itemState[item.item_id].reason.trim() || undefined,
      }));
    await onConfirm({ items, notes: notes.trim() || undefined });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-warning" />
        <div className="px-6 pt-5 pb-6 space-y-4">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/25 bg-warning/10">
                <RefreshCw className="h-5 w-5 text-warning" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">Partial Refund</DialogTitle>
                <DialogDescription className="text-xs mt-0.5 text-muted-foreground">
                  {formatRef(tx?.reference_no)} · Select items and quantities to refund
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Item list */}
          <div className="max-h-[300px] overflow-y-auto space-y-2 pr-0.5">
            {(txItems ?? []).map((item) => {
              const s         = itemState[item.item_id] ?? { enabled: false, quantity: 1, reason: "" };
              const maxQty    = Math.floor(parseFloat(item.quantity));
              const unitPrice = parseFloat(item.line_total) / parseFloat(item.quantity);
              const lineRef   = s.enabled ? formatCurrency(unitPrice * s.quantity) : null;

              return (
                <div
                  key={item.item_id}
                  className={cn(
                    "rounded-lg border p-3 transition-all duration-150",
                    s.enabled
                      ? "border-warning/25 bg-warning/5"
                      : "border-border/60 bg-muted/10",
                  )}
                >
                  {/* Header row */}
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => updateItem(item.item_id, { enabled: e.target.checked })}
                      className="mt-0.5 h-3.5 w-3.5 accent-warning cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-foreground leading-snug">{item.item_name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{item.sku}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-mono font-semibold">{formatCurrency(parseFloat(item.line_total))}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatQuantity(parseFloat(item.quantity), item.measurement_type, item.unit_type)} × {formatCurrency(parseFloat(item.unit_price))}
                          </p>
                        </div>
                      </div>

                      {/* Quantity + reason (only when enabled) */}
                      {s.enabled && (
                        <div className="mt-2.5 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">Refund qty:</span>
                            {(() => {
                              const step = stepForType(item.measurement_type, item.min_increment);
                              return (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => updateItem(item.item_id, { quantity: Math.max(step, parseFloat((s.quantity - step).toFixed(3))) })}
                                    disabled={s.quantity <= step}
                                    className="h-6 w-6 rounded border border-border bg-muted/50 text-xs font-bold hover:bg-muted disabled:opacity-40"
                                  >−</button>
                                  <span className="w-12 text-center text-xs font-mono font-semibold tabular-nums">
                                    {formatQuantity(s.quantity, item.measurement_type, item.unit_type)}
                                  </span>
                                  <button
                                    onClick={() => updateItem(item.item_id, { quantity: Math.min(maxQty, parseFloat((s.quantity + step).toFixed(3))) })}
                                    disabled={s.quantity >= maxQty}
                                    className="h-6 w-6 rounded border border-border bg-muted/50 text-xs font-bold hover:bg-muted disabled:opacity-40"
                                  >+</button>
                                </div>
                              );
                            })()}
                            <span className="text-[10px] text-muted-foreground">of {formatQuantity(maxQty, item.measurement_type, item.unit_type)}</span>
                            <span className="ml-auto text-xs font-mono font-semibold text-warning">
                              {lineRef}
                            </span>
                          </div>
                          <Input
                            value={s.reason}
                            onChange={(e) => updateItem(item.item_id, { reason: e.target.value })}
                            placeholder="Item reason (optional)"
                            className="text-xs h-7"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Overall refund notes…"
              className="text-sm"
            />
          </div>

          {/* Refund summary */}
          <div className="flex items-center justify-between rounded-lg border border-warning/20 bg-warning/8 px-4 py-2.5">
            <span className="text-xs text-warning font-medium">
              {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
            </span>
            <span className="text-sm font-mono font-bold text-warning">
              Refund: {formatCurrency(refundTotal)}
            </span>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || selectedCount === 0}
              className="flex-1 bg-warning hover:bg-warning/90 text-white"
            >
              {isLoading
                ? <><Loader2 className="h-4 w-4 animate-spin" />Processing…</>
                : `Refund ${formatCurrency(refundTotal)}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Detail Panel ─────────────────────────────────────────────────────────
export function TransactionDetailPanel() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const { transaction: tx, items, payments, isLoading, error, voidTx, partialRefundTx, fullRefundTx } =
    useTransaction(id);

  const canVoid   = usePermission("transactions.void");
  const canRefund = usePermission("transactions.refund");

  const { print, isPrinting } = usePrintReceipt();

  async function handleReprint() {
    try {
      await print(tx?.id);
    } catch {
      toast.error("Print failed. Please try again.");
    }
  }

  // Modal state
  const [voidOpen,    setVoidOpen]    = useState(false);
  const [fullOpen,    setFullOpen]    = useState(false);
  const [partialOpen, setPartialOpen] = useState(false);
  const [returnOpen,  setReturnOpen]  = useState(false);

  // Copy ref to clipboard
  const [copied, setCopied] = useState(false);
  function copyRef() {
    navigator.clipboard.writeText(tx?.reference_no ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // Action availability
  // "refunded"           = fully refunded (via full_refund command or create_return full)
  // "partially_refunded" = at least one partial return/refund has been processed
  const BLOCKED_STATUSES     = ["voided", "cancelled", "refunded"];
  const isCompleted          = tx?.status === "completed";
  const isVoidable           = isCompleted; // same-day enforcement is server-side
  // isRefundable: allow Partial Refund and Return Items on completed OR partially_refunded
  const isRefundable         = !BLOCKED_STATUSES.includes(tx?.status);
  // isFullyRefundable: only allow Full Refund on a fresh completed transaction —
  // once any partial return/refund has been processed the amount no longer matches total
  const isFullyRefundable    = !BLOCKED_STATUSES.includes(tx?.status)
                             && tx?.status !== "partially_refunded";

  // Handlers
  async function handleVoid(payload) {
    try {
      await voidTx.mutateAsync(payload);
      toast.success("Transaction voided. Stock has been restored.");
      setVoidOpen(false);
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Failed to void transaction");
    }
  }

  async function handleFullRefund(payload) {
    try {
      const result = await fullRefundTx.mutateAsync(payload);
      toast.success(result?.message ?? "Full refund processed successfully.");
      setFullOpen(false);
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Failed to process refund");
    }
  }

  async function handlePartialRefund(payload) {
    try {
      const result = await partialRefundTx.mutateAsync(payload);
      toast.success(result?.message ?? "Partial refund processed successfully.");
      setPartialOpen(false);
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Failed to process refund");
    }
  }

  // ── Loading / Error ─────────────────────────────────────────────────────────
  if (isLoading) return <Spinner />;

  if (error || !tx) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={FileText}
          title="Transaction not found"
          description={typeof error === "string" ? error : "This transaction does not exist or could not be loaded."}
          action={<Button variant="outline" onClick={() => navigate("/transactions")}>Back to Transactions</Button>}
        />
      </div>
    );
  }

  const subtotal    = parseFloat(tx.subtotal        ?? 0);
  const tax         = parseFloat(tx.tax_amount      ?? 0);
  const discount    = parseFloat(tx.discount_amount ?? 0);
  const total       = parseFloat(tx.total_amount    ?? 0);
  const tendered    = tx.amount_tendered != null ? parseFloat(tx.amount_tendered) : null;
  const change      = tx.change_amount   != null ? parseFloat(tx.change_amount)   : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title={formatRef(tx.reference_no)}
        description={`Recorded on ${formatDate(tx.created_at)}`}
        backHref="/transactions"
        badge={
          <div className="flex items-center gap-2">
            <StatusBadge status={tx.status} size="md" />
            {tx.payment_status !== tx.status && (
              <StatusBadge status={tx.payment_status} size="md" />
            )}
          </div>
        }
        action={
          <div className="flex items-center gap-2">
            {/* Copy ref */}
            <Button variant="outline" size="xs" onClick={copyRef} className="h-8 gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy Ref"}
            </Button>

            {/* Reprint */}
            <Button
              variant="outline"
              size="xs"
              onClick={handleReprint}
              disabled={isPrinting}
              className="h-8 gap-1.5"
            >
              {isPrinting
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Printing…</>
                : <><Printer className="h-3.5 w-3.5" />Print Receipt</>
              }
            </Button>

            {/* Void */}
            {canVoid && isVoidable && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setVoidOpen(true)}
                className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <Ban className="h-3.5 w-3.5" />
                Void
              </Button>
            )}

            {/* Partial Refund */}
            {canRefund && isRefundable && items.length > 0 && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setPartialOpen(true)}
                className="h-8 gap-1.5 border-warning/30 text-warning hover:bg-warning/10"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Partial Refund
              </Button>
            )}

            {/* Full Refund */}
            {canRefund && isFullyRefundable && (
              <Button
                size="xs"
                onClick={() => setFullOpen(true)}
                className="h-8 gap-1.5 bg-warning hover:bg-warning/90 text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Full Refund
              </Button>
            )}

            {/* Initiate Return */}
            {canRefund && isRefundable && items.length > 0 && (
              <Button
                size="xs"
                onClick={() => setReturnOpen(true)}
                className="h-8 gap-1.5 bg-primary hover:bg-primary/90 text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Return Items
              </Button>
            )}
          </div>
        }
      />

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* ── Left column (2/3) ─────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-5">

              {/* Transaction info */}
              <Section title="Transaction Info" icon={FileText}>
                <div className="grid grid-cols-2 gap-x-8">
                  <div>
                    <Row label="Reference"     value={<span className="font-mono text-primary">{tx.reference_no}</span>} />
                    <Row label="Date"          value={formatDateTime(tx.created_at)} />
                    <Row label="Cashier"       value={tx.cashier_name ?? "—"} />
                    <Row
                      label="Customer"
                      value={
                        tx.customer_id ? (
                          <Link
                            to={`/customers/${tx.customer_id}`}
                            className="text-primary hover:underline flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {tx.customer_name}
                            <ArrowUpRight className="h-3 w-3 shrink-0" />
                          </Link>
                        ) : (
                          <span className="italic text-muted-foreground">Walk-in</span>
                        )
                      }
                    />
                  </div>
                  <div>
                    <Row
                      label="Payment"
                      value={
                        (() => {
                          const sale = payments.filter((p) => !isRefundEntry(p));
                          if (sale.length > 0) {
                            return sale
                              .map((p) => PAYMENT_LABELS[p.payment_method] ?? p.payment_method)
                              .join(" + ");
                          }
                          return PAYMENT_LABELS[tx.payment_method] ?? tx.payment_method;
                        })()
                      }
                    />
                    <Row label="Status"        value={<StatusBadge status={tx.status} />} />
                    <Row label="Pmt. Status"   value={<StatusBadge status={tx.payment_status} />} />
                    <Row label="Notes"         value={tx.notes ?? <span className="italic text-muted-foreground">—</span>} />
                  </div>
                </div>
              </Section>

              {/* Items */}
              <Section title={`Items (${items.length})`} icon={Package}>
                {items.length === 0 ? (
                  <EmptyState icon={Package} title="No items" compact />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Item</th>
                          <th className="text-left py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">SKU</th>
                          <th className="text-right py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Qty</th>
                          <th className="text-right py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Unit Price</th>
                          <th className="text-right py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">VAT</th>
                          <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="py-2.5 pr-3">
                              <p className="font-medium text-foreground leading-snug">{item.item_name}</p>
                            </td>
                            <td className="py-2.5 pr-3 font-mono text-muted-foreground">{item.sku}</td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                              {formatQuantity(parseFloat(item.quantity), item.measurement_type, item.unit_type)}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                              {formatCurrency(parseFloat(item.unit_price))}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                              {formatCurrency(parseFloat(item.tax_amount))}
                            </td>
                            <td className="py-2.5 text-right font-mono tabular-nums font-semibold">
                              {formatCurrency(parseFloat(item.line_total))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </div>

            {/* ── Right column (1/3) ────────────────────────────────────── */}
            <div className="space-y-4">

              {/* Financial summary */}
              <Section title="Summary" icon={CreditCard}>
                <SummaryLine label="Subtotal (ex-VAT)"  value={formatCurrency(subtotal)} />
                <SummaryLine label="VAT (7.5%)"         value={formatCurrency(tax)} />
                {discount > 0 && (
                  <SummaryLine label="Discount" value={`−${formatCurrency(discount)}`} accent="destructive" />
                )}
                <SummaryLine
                  label="Total"
                  value={formatCurrency(total)}
                  large
                  separator
                />
                {/* Payment method breakdown — exclude refund bookkeeping rows */}
                {(() => {
                  const salePayments = payments.filter((p) => !isRefundEntry(p));
                  if (salePayments.length > 0) {
                    return salePayments.map((p) => (
                      <SummaryLine
                        key={p.id}
                        label={PAYMENT_LABELS[p.payment_method] ?? p.payment_method}
                        value={formatCurrency(parseFloat(p.amount))}
                      />
                    ));
                  }
                  // Fallback for legacy rows where no Payment record exists
                  if (tendered != null) {
                    return (
                      <SummaryLine
                        label={PAYMENT_LABELS[tx.payment_method] ?? tx.payment_method}
                        value={formatCurrency(tendered)}
                      />
                    );
                  }
                  return null;
                })()}
                {change != null && change > 0 && (
                  <SummaryLine label="Change" value={formatCurrency(change)} accent="success" />
                )}
              </Section>

              {/* Customer card */}
              {tx.customer_name && (
                <Section title="Customer" icon={User}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-[13px] font-bold text-primary uppercase">
                        {tx.customer_name.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{tx.customer_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {tx.customer_id ? `ID #${tx.customer_id}` : "Customer"}
                        </p>
                      </div>
                    </div>
                    {tx.customer_id && (
                      <Link
                        to={`/customers/${tx.customer_id}`}
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Profile
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  {tx.payment_method === "credit" && (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-warning/20 bg-warning/8 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                        <p className="text-[11px] text-warning">Credit sale — payment pending</p>
                      </div>
                      <Link
                        to="/credit-sales"
                        className="flex items-center gap-1 text-[10px] text-primary hover:underline shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </div>
                  )}
                </Section>
              )}

              {/* Actions card */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
                  <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Actions</h2>
                </div>
                <div className="p-4 space-y-2">
                  {/* Reprint */}
                  <button
                    onClick={handleReprint}
                    disabled={isPrinting}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-border/40 bg-muted/10 hover:bg-muted/30 transition-colors group disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2.5">
                      {isPrinting
                        ? <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                        : <Printer className="h-4 w-4 text-muted-foreground" />
                      }
                      <div className="text-left">
                        <p className="text-xs font-semibold text-foreground">Print Receipt</p>
                        <p className="text-[10px] text-muted-foreground">Reprint this transaction's receipt</p>
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                  </button>

                  {/* Void */}
                  {canVoid && isVoidable && (
                    <button
                      onClick={() => setVoidOpen(true)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-destructive/20 bg-destructive/5 hover:bg-destructive/10 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5">
                        <Ban className="h-4 w-4 text-destructive" />
                        <div className="text-left">
                          <p className="text-xs font-semibold text-destructive">Void Transaction</p>
                          <p className="text-[10px] text-muted-foreground">Same-day only · Restores stock</p>
                        </div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-destructive/50 group-hover:text-destructive transition-colors" />
                    </button>
                  )}

                  {/* Partial Refund */}
                  {canRefund && isRefundable && items.length > 0 && (
                    <button
                      onClick={() => setPartialOpen(true)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-warning/20 bg-warning/5 hover:bg-warning/10 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5">
                        <RefreshCw className="h-4 w-4 text-warning" />
                        <div className="text-left">
                          <p className="text-xs font-semibold text-warning">Partial Refund</p>
                          <p className="text-[10px] text-muted-foreground">Select items & quantities</p>
                        </div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-warning/50 group-hover:text-warning transition-colors" />
                    </button>
                  )}

                  {/* Full Refund */}
                  {canRefund && isFullyRefundable && (
                    <button
                      onClick={() => setFullOpen(true)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-warning/20 bg-warning/5 hover:bg-warning/10 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5">
                        <RotateCcw className="h-4 w-4 text-warning" />
                        <div className="text-left">
                          <p className="text-xs font-semibold text-warning">Full Refund</p>
                          <p className="text-[10px] text-muted-foreground">{formatCurrency(total)} · Restores all stock</p>
                        </div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-warning/50 group-hover:text-warning transition-colors" />
                    </button>
                  )}

                  {/* No destructive actions available */}
                  {!isVoidable && !isRefundable && !isFullyRefundable && (
                    <p className="text-center text-[11px] text-muted-foreground pt-1 pb-2">
                      Transaction is finalised — no further actions.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <VoidModal
        open={voidOpen}
        onOpenChange={setVoidOpen}
        tx={tx}
        onConfirm={handleVoid}
        isLoading={voidTx.isPending}
      />
      <FullRefundModal
        open={fullOpen}
        onOpenChange={setFullOpen}
        tx={tx}
        onConfirm={handleFullRefund}
        isLoading={fullRefundTx.isPending}
      />
      <PartialRefundModal
        open={partialOpen}
        onOpenChange={setPartialOpen}
        tx={tx}
        txItems={items}
        onConfirm={handlePartialRefund}
        isLoading={partialRefundTx.isPending}
      />
      <InitiateReturnModal
        open={returnOpen}
        onOpenChange={setReturnOpen}
        transaction={tx}
        txItems={items}
        onSuccess={() => {
          toast.success("Return processed. Transaction status updated.");
        }}
      />
    </>
  );
}
