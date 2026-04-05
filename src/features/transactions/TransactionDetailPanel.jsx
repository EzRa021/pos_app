// ============================================================================
// features/transactions/TransactionDetailPanel.jsx  — Redesigned
// ============================================================================
import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  AlertTriangle, Ban, RefreshCw, RotateCcw,
  User, CreditCard, Package, FileText,
  Loader2, ChevronRight, Printer, Copy, Check, ArrowUpRight,
  ShieldCheck, Hash, Calendar, Clock, Receipt,
  Banknote, Layers, Tag,
} from "lucide-react";
import { usePrintReceipt } from "@/hooks/usePrintReceipt";
import { toast } from "sonner";

import { useQuery }              from "@tanstack/react-query";
import { useTransaction }        from "./useTransactions";
import { getTransactionReturnedQty } from "@/commands/returns";
import { InitiateReturnModal }   from "@/features/returns/InitiateReturnModal";
import { PageHeader }            from "@/components/shared/PageHeader";
import { StatusBadge }           from "@/components/shared/StatusBadge";
import { Spinner }               from "@/components/shared/Spinner";
import { EmptyState }            from "@/components/shared/EmptyState";
import { Button }                from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input }   from "@/components/ui/input";
import { cn }      from "@/lib/utils";
import {
  formatCurrency, formatDateTime, formatDate, formatRef, formatQuantity, stepForType,
} from "@/lib/format";
import { usePermission }  from "@/hooks/usePermission";
import { useAuthStore }   from "@/stores/auth.store";
import { verifyPosPin }   from "@/commands/security";

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

const isRefundEntry = (p) => p.payment_method?.startsWith("refund_");

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, className, badge }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2.5 px-5 py-3.5 border-b border-border bg-muted/10">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/60">
              <Icon className="h-3 w-3 text-muted-foreground" />
            </div>
          )}
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </h2>
        </div>
        {badge && <div>{badge}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Info row ──────────────────────────────────────────────────────────────────
function InfoRow({ label, value, icon: Icon, mono = false, valueClass, last = false }) {
  return (
    <div className={cn(
      "flex items-start justify-between gap-4 py-2.5",
      !last && "border-b border-border/40",
    )}>
      <div className="flex items-center gap-2 shrink-0">
        {Icon && <Icon className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className={cn(
        "text-xs font-medium text-right flex-1 max-w-[55%]",
        mono && "font-mono tabular-nums",
        valueClass,
      )}>
        {value ?? "—"}
      </span>
    </div>
  );
}

// ── Summary line ──────────────────────────────────────────────────────────────
function SummaryLine({ label, value, large, accent, separator, sub }) {
  return (
    <>
      {separator && <div className="my-2.5 border-t border-border/60" />}
      <div className={cn(
        "flex items-center justify-between",
        large ? "py-1.5" : "py-1",
      )}>
        <div className="flex flex-col">
          <span className={cn(
            "text-xs",
            large ? "font-semibold text-foreground" : "text-muted-foreground",
          )}>
            {label}
          </span>
          {sub && <span className="text-[10px] text-muted-foreground mt-0.5">{sub}</span>}
        </div>
        <span className={cn(
          "font-mono tabular-nums",
          large ? "text-base font-bold" : "text-xs font-medium",
          accent === "success"     && "text-success",
          accent === "destructive" && "text-destructive",
          accent === "primary"     && "text-primary",
          !accent && (large ? "text-foreground" : "text-muted-foreground"),
        )}>
          {value}
        </span>
      </div>
    </>
  );
}

// ── Items table ───────────────────────────────────────────────────────────────
function ItemsTable({ items }) {
  if (!items?.length) return <EmptyState icon={Package} title="No items" compact />;

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left pb-2.5 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Product
            </th>
            <th className="text-right pb-2.5 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Qty
            </th>
            <th className="text-right pb-2.5 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Unit Price
            </th>
            <th className="text-right pb-2.5 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              VAT
            </th>
            <th className="text-right pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {items.map((item, idx) => (
            <tr
              key={item.id}
              className="group hover:bg-muted/20 transition-colors duration-100"
            >
              <td className="py-3 pr-3">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/50 mt-0.5">
                    <Package className="h-3 w-3 text-muted-foreground/60" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground leading-snug">{item.item_name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">{item.sku}</p>
                  </div>
                </div>
              </td>
              <td className="py-3 pr-3 text-right font-mono tabular-nums text-foreground">
                {formatQuantity(parseFloat(item.quantity), item.measurement_type, item.unit_type)}
              </td>
              <td className="py-3 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                {formatCurrency(parseFloat(item.unit_price))}
              </td>
              <td className="py-3 pr-3 text-right font-mono tabular-nums text-muted-foreground/70">
                {formatCurrency(parseFloat(item.tax_amount))}
              </td>
              <td className="py-3 text-right font-mono tabular-nums font-bold text-foreground">
                {formatCurrency(parseFloat(item.line_total))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Action button ─────────────────────────────────────────────────────────────
function ActionButton({ onClick, icon: Icon, label, description, variant = "default", disabled }) {
  const styles = {
    default:     "border-border/40 bg-muted/10 hover:bg-muted/30 text-foreground",
    destructive: "border-destructive/20 bg-destructive/5 hover:bg-destructive/10",
    warning:     "border-warning/20 bg-warning/5 hover:bg-warning/10",
    primary:     "border-primary/20 bg-primary/5 hover:bg-primary/10",
  }[variant];
  const iconColor = {
    default:     "text-muted-foreground",
    destructive: "text-destructive",
    warning:     "text-warning",
    primary:     "text-primary",
  }[variant];
  const labelColor = {
    default:     "text-foreground",
    destructive: "text-destructive",
    warning:     "text-warning",
    primary:     "text-primary",
  }[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border",
        "transition-all duration-150 group",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        styles,
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
          variant === "destructive" ? "border-destructive/20 bg-destructive/10" :
          variant === "warning"     ? "border-warning/20 bg-warning/10" :
          variant === "primary"     ? "border-primary/20 bg-primary/10" :
          "border-border/60 bg-muted/40",
        )}>
          <Icon className={cn("h-4 w-4", iconColor)} />
        </div>
        <div className="text-left">
          <p className={cn("text-xs font-semibold leading-snug", labelColor)}>{label}</p>
          {description && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <ChevronRight className={cn(
        "h-3.5 w-3.5 transition-all duration-150",
        "group-hover:translate-x-0.5",
        variant === "destructive" ? "text-destructive/40 group-hover:text-destructive" :
        variant === "warning"     ? "text-warning/40 group-hover:text-warning" :
        variant === "primary"     ? "text-primary/40 group-hover:text-primary" :
        "text-muted-foreground/40 group-hover:text-muted-foreground",
      )} />
    </button>
  );
}

// ── VoidModal ─────────────────────────────────────────────────────────────────
function VoidModal({ open, onOpenChange, tx, onConfirm, isLoading }) {
  const [reason, setReason]    = useState("");
  const [notes,  setNotes]     = useState("");
  const [step,   setStep]      = useState(1);
  const [pin,    setPin]       = useState("");
  const [pinError, setPinError]= useState("");
  const [verifying, setVerifying] = useState(false);
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (open) { setReason(""); setNotes(""); setStep(1); setPin(""); setPinError(""); }
  }, [open]);

  function handleProceed() {
    if (!reason.trim()) { toast.error("Please provide a void reason"); return; }
    setStep(2); setPin(""); setPinError("");
  }

  async function handlePinSubmit(e) {
    e?.preventDefault();
    if (pin.length !== 4) { setPinError("Enter your 4-digit PIN"); return; }
    setVerifying(true); setPinError("");
    try {
      await verifyPosPin(userId, pin);
      await onConfirm({ reason: reason.trim(), notes: notes.trim() || undefined });
    } catch (err) {
      setPinError(typeof err === "string" ? err : "Incorrect PIN");
      setPin("");
    } finally { setVerifying(false); }
  }

  const busy = isLoading || verifying;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/50">
        <div className="h-[3px] w-full bg-gradient-to-r from-destructive/80 via-destructive to-destructive/80" />
        <div className="px-6 pt-5 pb-6 space-y-4">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/8">
                {step === 2 ? <ShieldCheck className="h-5 w-5 text-destructive" /> : <Ban className="h-5 w-5 text-destructive" />}
              </div>
              <div className="pt-0.5">
                <DialogTitle className="text-[14px] font-bold leading-tight">
                  {step === 2 ? "Confirm with PIN" : "Void Transaction"}
                </DialogTitle>
                <DialogDescription className="text-[11px] mt-1 text-muted-foreground">
                  {formatRef(tx?.reference_no)} · Same-day voids only
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Warning banner */}
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning/6 px-3.5 py-3">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[11px] text-warning/90 leading-relaxed">
              This will permanently void the transaction and restore all stock.
              This action <span className="font-bold">cannot be undone</span>.
            </p>
          </div>

          {step === 1 ? (
            <>
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
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-1 focus:ring-destructive/40 transition-shadow"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
                    Notes <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional context…" className="text-xs" />
                </div>
              </div>
              <DialogFooter className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 text-xs">Cancel</Button>
                <Button onClick={handleProceed} disabled={!reason.trim()} className="flex-1 text-xs bg-destructive hover:bg-destructive/90 text-white">
                  Continue
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Enter your 4-digit POS PIN to authorise this void.
                No PIN? Go to <span className="text-foreground font-semibold">Settings → Security</span>.
              </p>
              <form onSubmit={handlePinSubmit} className="space-y-3">
                <div>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="••••"
                    value={pin}
                    onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
                    className="text-center text-2xl tracking-[0.6em] font-mono h-12 border-border/60 focus:border-destructive/50"
                    autoFocus
                  />
                  {pinError && <p className="text-[11px] text-destructive mt-1.5 font-medium">{pinError}</p>}
                </div>
                <DialogFooter className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={busy} className="flex-1 text-xs">Back</Button>
                  <Button type="submit" disabled={busy || pin.length !== 4} className="flex-1 text-xs bg-destructive hover:bg-destructive/90 text-white">
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Verifying…</> : "Void Transaction"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
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
      <DialogContent className="max-w-md border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/50">
        <div className="h-[3px] w-full bg-gradient-to-r from-warning/80 via-warning to-warning/80" />
        <div className="px-6 pt-5 pb-6 space-y-4">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/8">
                <RotateCcw className="h-5 w-5 text-warning" />
              </div>
              <div className="pt-0.5">
                <DialogTitle className="text-[14px] font-bold leading-tight">Full Refund</DialogTitle>
                <DialogDescription className="text-[11px] mt-1 text-muted-foreground">
                  {formatRef(tx?.reference_no)} · {total}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning/6 px-3.5 py-3">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[11px] text-warning/90 leading-relaxed">
              This will refund <span className="font-bold">{total}</span> and restore all stock.
              The transaction will be marked as fully refunded.
            </p>
          </div>

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
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-1 focus:ring-warning/40 transition-shadow"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional context…" className="text-xs" />
            </div>
          </div>

          <DialogFooter className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading} className="flex-1 text-xs">Cancel</Button>
            <Button onClick={handleSubmit} disabled={isLoading || !reason.trim()} className="flex-1 text-xs bg-warning hover:bg-warning/90 text-warning-foreground">
              {isLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Processing…</> : `Refund ${total}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── PartialRefundModal ────────────────────────────────────────────────────────
function PartialRefundModal({ open, onOpenChange, tx, txItems, onConfirm, isLoading }) {
  const [itemState, setItemState] = useState({});
  const [notes, setNotes]         = useState("");

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

  const { refundTotal, selectedCount } = useMemo(() => {
    let total = 0; let count = 0;
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
      <DialogContent className="max-w-lg border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/50">
        <div className="h-[3px] w-full bg-gradient-to-r from-warning/80 via-warning to-warning/80" />
        <div className="px-6 pt-5 pb-6 space-y-4">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/8">
                <RefreshCw className="h-5 w-5 text-warning" />
              </div>
              <div className="pt-0.5">
                <DialogTitle className="text-[14px] font-bold leading-tight">Partial Refund</DialogTitle>
                <DialogDescription className="text-[11px] mt-1 text-muted-foreground">
                  {formatRef(tx?.reference_no)} · Select items and quantities
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[300px] overflow-y-auto space-y-2 pr-0.5 -mr-0.5">
            {(txItems ?? []).map((item) => {
              const s = itemState[item.item_id] ?? { enabled: false, quantity: 1, reason: "" };
              const maxQty = Math.floor(parseFloat(item.quantity));
              const unitPrice = parseFloat(item.line_total) / parseFloat(item.quantity);
              const lineRef = s.enabled ? formatCurrency(unitPrice * s.quantity) : null;

              return (
                <div
                  key={item.item_id}
                  className={cn(
                    "rounded-lg border p-3 transition-all duration-150",
                    s.enabled ? "border-warning/25 bg-warning/5" : "border-border/50 bg-muted/5",
                  )}
                >
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
                          <p className="text-xs font-semibold text-foreground">{item.item_name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground/60">{item.sku}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-mono font-bold tabular-nums">{formatCurrency(parseFloat(item.line_total))}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatQuantity(parseFloat(item.quantity), item.measurement_type, item.unit_type)} × {formatCurrency(parseFloat(item.unit_price))}
                          </p>
                        </div>
                      </div>

                      {s.enabled && (
                        <div className="mt-2.5 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] text-muted-foreground">Qty:</span>
                            {(() => {
                              const step = stepForType(item.measurement_type, item.min_increment);
                              return (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => updateItem(item.item_id, { quantity: Math.max(step, parseFloat((s.quantity - step).toFixed(3))) })}
                                    disabled={s.quantity <= step}
                                    className="h-6 w-6 rounded-md border border-border bg-muted/50 text-xs font-bold hover:bg-muted disabled:opacity-40 transition-colors"
                                  >−</button>
                                  <span className="w-12 text-center text-xs font-mono font-semibold tabular-nums">
                                    {formatQuantity(s.quantity, item.measurement_type, item.unit_type)}
                                  </span>
                                  <button
                                    onClick={() => updateItem(item.item_id, { quantity: Math.min(maxQty, parseFloat((s.quantity + step).toFixed(3))) })}
                                    disabled={s.quantity >= maxQty}
                                    className="h-6 w-6 rounded-md border border-border bg-muted/50 text-xs font-bold hover:bg-muted disabled:opacity-40 transition-colors"
                                  >+</button>
                                </div>
                              );
                            })()}
                            <span className="text-[10px] text-muted-foreground">of {formatQuantity(maxQty, item.measurement_type, item.unit_type)}</span>
                            <span className="ml-auto text-xs font-mono font-bold text-warning tabular-nums">{lineRef}</span>
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

          <div>
            <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Overall refund notes…" className="text-xs" />
          </div>

          {/* Summary */}
          <div className="flex items-center justify-between rounded-lg border border-warning/20 bg-warning/8 px-4 py-2.5">
            <span className="text-xs text-warning font-medium">
              {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
            </span>
            <span className="text-sm font-mono font-bold text-warning tabular-nums">
              {formatCurrency(refundTotal)}
            </span>
          </div>

          <DialogFooter className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading} className="flex-1 text-xs">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || selectedCount === 0}
              className="flex-1 text-xs bg-warning hover:bg-warning/90 text-warning-foreground"
            >
              {isLoading
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Processing…</>
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

  const isPartiallyRefunded = tx?.status === "partially_refunded";
  const { data: returnedQtyRaw } = useQuery({
    queryKey:  ["tx-returned-qty", tx?.id],
    queryFn:   () => getTransactionReturnedQty(tx.id),
    enabled:   !!tx?.id && isPartiallyRefunded,
    staleTime: 30 * 1000,
  });

  const returnedQtyMap = useMemo(() => {
    const map = {};
    (returnedQtyRaw ?? []).forEach(({ item_id, quantity_returned }) => {
      map[item_id] = parseFloat(quantity_returned ?? 0);
    });
    return map;
  }, [returnedQtyRaw]);

  const { print, isPrinting } = usePrintReceipt();

  async function handleReprint() {
    try { await print(tx?.id); }
    catch { toast.error("Print failed. Please try again."); }
  }

  const [voidOpen,    setVoidOpen]    = useState(false);
  const [fullOpen,    setFullOpen]    = useState(false);
  const [partialOpen, setPartialOpen] = useState(false);
  const [returnOpen,  setReturnOpen]  = useState(false);

  const [copied, setCopied] = useState(false);
  function copyRef() {
    navigator.clipboard.writeText(tx?.reference_no ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const isCompleted       = tx?.status === "completed";
  const isVoidable        = isCompleted;
  const isRefundable      = isCompleted || tx?.status === "partially_refunded";
  const isFullyRefundable = isCompleted;

  async function handleVoid(payload) {
    try {
      await voidTx.mutateAsync(payload);
      toast.success("Transaction voided. Stock has been restored.");
      setVoidOpen(false);
    } catch (err) { toast.error(typeof err === "string" ? err : "Failed to void transaction"); }
  }

  async function handleFullRefund(payload) {
    try {
      const result = await fullRefundTx.mutateAsync(payload);
      toast.success(result?.message ?? "Full refund processed successfully.");
      setFullOpen(false);
    } catch (err) { toast.error(typeof err === "string" ? err : "Failed to process refund"); }
  }

  async function handlePartialRefund(payload) {
    try {
      const result = await partialRefundTx.mutateAsync(payload);
      toast.success(result?.message ?? "Partial refund processed successfully.");
      setPartialOpen(false);
    } catch (err) { toast.error(typeof err === "string" ? err : "Failed to process refund"); }
  }

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

  const subtotal = parseFloat(tx.subtotal        ?? 0);
  const tax      = parseFloat(tx.tax_amount      ?? 0);
  const discount = parseFloat(tx.discount_amount ?? 0);
  const total    = parseFloat(tx.total_amount    ?? 0);
  const tendered = tx.amount_tendered != null ? parseFloat(tx.amount_tendered) : null;
  const change   = tx.change_amount   != null ? parseFloat(tx.change_amount)   : null;

  // Derived payment method label for summary
  const salePayments = payments.filter((p) => !isRefundEntry(p));
  const paymentLabel = salePayments.length > 0
    ? salePayments.map((p) => PAYMENT_LABELS[p.payment_method] ?? p.payment_method).join(" + ")
    : (PAYMENT_LABELS[tx.payment_method] ?? tx.payment_method);

  return (
    <>
      <PageHeader
        title={formatRef(tx.reference_no)}
        description={`Recorded on ${formatDate(tx.created_at)}`}
        backHref="/transactions"
        badge={
          <div className="flex items-center gap-1.5">
            <StatusBadge status={tx.status} size="md" />
            {tx.payment_status !== tx.status && (
              <StatusBadge status={tx.payment_status} size="md" />
            )}
          </div>
        }
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="xs" onClick={copyRef} className="h-8 gap-1.5 text-xs">
              {copied
                ? <><Check className="h-3.5 w-3.5 text-success" />Copied</>
                : <><Copy className="h-3.5 w-3.5" />Copy Ref</>}
            </Button>
            <Button variant="outline" size="xs" onClick={handleReprint} disabled={isPrinting} className="h-8 gap-1.5 text-xs">
              {isPrinting
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Printing…</>
                : <><Printer className="h-3.5 w-3.5" />Print Receipt</>}
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* ── Left column — 2/3 ─────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-5">

              {/* Transaction info */}
              <Section title="Transaction Details" icon={Receipt}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                  <div>
                    <InfoRow
                      label="Reference No."
                      icon={Hash}
                      value={
                        <span className="font-mono text-primary font-bold tracking-wide">
                          {tx.reference_no}
                        </span>
                      }
                    />
                    <InfoRow
                      label="Date"
                      icon={Calendar}
                      value={formatDate(tx.created_at)}
                    />
                    <InfoRow
                      label="Time"
                      icon={Clock}
                      value={new Date(tx.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    />
                    <InfoRow
                      label="Cashier"
                      icon={User}
                      value={tx.cashier_name ?? "—"}
                      last
                    />
                  </div>
                  <div>
                    <InfoRow
                      label="Customer"
                      icon={User}
                      value={
                        tx.customer_id ? (
                          <Link
                            to={`/customers/${tx.customer_id}`}
                            className="text-primary hover:underline flex items-center gap-1 justify-end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {tx.customer_name}
                            <ArrowUpRight className="h-3 w-3 shrink-0" />
                          </Link>
                        ) : (
                          <span className="italic text-muted-foreground/70">Walk-in</span>
                        )
                      }
                    />
                    <InfoRow
                      label="Payment"
                      icon={CreditCard}
                      value={paymentLabel}
                    />
                    <InfoRow
                      label="Status"
                      icon={Tag}
                      value={<StatusBadge status={tx.status} />}
                    />
                    <InfoRow
                      label="Notes"
                      icon={FileText}
                      value={tx.notes ?? <span className="italic text-muted-foreground/60">None</span>}
                      last
                    />
                  </div>
                </div>
              </Section>

              {/* Items */}
              <Section
                title={`Items`}
                icon={Package}
                badge={
                  items.length > 0 ? (
                    <span className="text-[10px] font-semibold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 tabular-nums">
                      {items.length} line{items.length !== 1 ? "s" : ""}
                    </span>
                  ) : null
                }
              >
                <ItemsTable items={items} />
              </Section>
            </div>

            {/* ── Right column — 1/3 ────────────────────────────────── */}
            <div className="space-y-4">

              {/* Financial summary */}
              <Section title="Summary" icon={Banknote}>
                <SummaryLine label="Subtotal (ex-VAT)" value={formatCurrency(subtotal)} />
                <SummaryLine label="VAT (7.5%)"        value={formatCurrency(tax)} />
                {discount > 0 && (
                  <SummaryLine label="Discount" value={`−${formatCurrency(discount)}`} accent="destructive" />
                )}
                <SummaryLine
                  label="Total"
                  value={formatCurrency(total)}
                  large
                  separator
                />
                {/* Payment breakdown */}
                {salePayments.length > 0
                  ? salePayments.map((p) => (
                      <SummaryLine
                        key={p.id}
                        label={PAYMENT_LABELS[p.payment_method] ?? p.payment_method}
                        value={formatCurrency(parseFloat(p.amount))}
                        accent="primary"
                      />
                    ))
                  : tendered != null && (
                      <SummaryLine
                        label={PAYMENT_LABELS[tx.payment_method] ?? tx.payment_method}
                        value={formatCurrency(tendered)}
                        accent="primary"
                      />
                    )
                }
                {change != null && change > 0 && (
                  <SummaryLine label="Change Given" value={formatCurrency(change)} accent="success" />
                )}
              </Section>

              {/* Customer */}
              {tx.customer_name && (
                <Section title="Customer" icon={User}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/8 text-[14px] font-bold text-primary uppercase">
                        {tx.customer_name.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-bold">{tx.customer_name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {tx.customer_id ? `Customer #${tx.customer_id}` : "Customer"}
                        </p>
                      </div>
                    </div>
                    {tx.customer_id && (
                      <Link
                        to={`/customers/${tx.customer_id}`}
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Profile <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  {tx.payment_method === "credit" && (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-warning/20 bg-warning/6 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                        <p className="text-[11px] text-warning font-medium">Credit — payment pending</p>
                      </div>
                      <Link to="/credit-sales" className="text-[10px] text-primary hover:underline flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                        View <ArrowUpRight className="h-2.5 w-2.5" />
                      </Link>
                    </div>
                  )}
                </Section>
              )}

              {/* Actions */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/10">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/60">
                    <Layers className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Actions
                  </h2>
                </div>
                <div className="p-4 space-y-2">
                  <ActionButton
                    onClick={handleReprint}
                    disabled={isPrinting}
                    icon={isPrinting ? Loader2 : Printer}
                    label="Print Receipt"
                    description="Reprint this transaction's receipt"
                  />

                  {canVoid && isVoidable && (
                    <ActionButton
                      onClick={() => setVoidOpen(true)}
                      icon={Ban}
                      label="Void Transaction"
                      description="Same-day only · Restores all stock"
                      variant="destructive"
                    />
                  )}

                  {canRefund && isRefundable && items.length > 0 && (
                    <ActionButton
                      onClick={() => setPartialOpen(true)}
                      icon={RefreshCw}
                      label="Partial Refund"
                      description="Select items & quantities to refund"
                      variant="warning"
                    />
                  )}

                  {canRefund && isFullyRefundable && (
                    <ActionButton
                      onClick={() => setFullOpen(true)}
                      icon={RotateCcw}
                      label="Full Refund"
                      description={`${formatCurrency(total)} · Restores all stock`}
                      variant="warning"
                    />
                  )}

                  {canRefund && isRefundable && items.length > 0 && (
                    <ActionButton
                      onClick={() => setReturnOpen(true)}
                      icon={RotateCcw}
                      label="Return Items"
                      description="Creates a tracked return record"
                      variant="primary"
                    />
                  )}

                  {!isVoidable && !isRefundable && !isFullyRefundable && (
                    <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-muted-foreground/60">
                      <Check className="h-3.5 w-3.5" />
                      Transaction finalised — no further actions
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
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
        returnedQtyMap={returnedQtyMap}
        onSuccess={() => {
          toast.success("Return processed. Transaction status updated.");
        }}
      />
    </>
  );
}
