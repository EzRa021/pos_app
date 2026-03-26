// ============================================================================
// features/returns/ReturnDetailPanel.jsx
// ============================================================================

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  RotateCcw, FileText, User, CreditCard, Package,
  CheckCircle2, XCircle, ArrowLeft, Copy, Check,
  Ban, AlertTriangle, Loader2,
} from "lucide-react";

import { useReturn, useVoidReturn } from "@/features/returns/useReturns";
import { PageHeader }  from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Spinner }     from "@/components/shared/Spinner";
import { EmptyState }  from "@/components/shared/EmptyState";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  formatCurrency, formatDateTime, formatDate,
  formatRef, formatQuantity,
} from "@/lib/format";

// ── Constants ─────────────────────────────────────────────────────────────────
const REFUND_METHOD_LABELS = {
  cash:            "Cash",
  card:            "Card",
  transfer:        "Bank Transfer",
  original_method: "Original Payment Method",
  store_credit:    "Store Credit",
};

const CONDITION_STYLES = {
  good:      { label: "Good",      cls: "border-success/30 bg-success/10 text-success" },
  damaged:   { label: "Damaged",   cls: "border-warning/30 bg-warning/10 text-warning" },
  defective: { label: "Defective", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
};

// ── Atom components ───────────────────────────────────────────────────────────
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

function Row({ label, value, mono, valueClass }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn(
        "text-xs font-medium text-right",
        mono && "font-mono tabular-nums",
        valueClass,
      )}>
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
        <span className={cn(
          "text-xs",
          large ? "font-semibold text-foreground" : "text-muted-foreground",
        )}>
          {label}
        </span>
        <span className={cn(
          "font-mono tabular-nums",
          large ? "text-base font-bold" : "text-xs",
          accent === "success"     && "text-success",
          accent === "destructive" && "text-destructive",
          !accent && (large ? "text-foreground" : "text-muted-foreground"),
        )}>
          {value}
        </span>
      </div>
    </>
  );
}

function ConditionBadge({ condition }) {
  const style = CONDITION_STYLES[condition] ?? CONDITION_STYLES.good;
  return (
    <span className={cn(
      "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold",
      style.cls,
    )}>
      {style.label}
    </span>
  );
}

function RestockIndicator({ restocked }) {
  return restocked ? (
    <span className="flex items-center gap-1 text-[11px] font-medium text-success">
      <CheckCircle2 className="h-3 w-3" />
      Restocked
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <XCircle className="h-3 w-3" />
      Not restocked
    </span>
  );
}

function ReturnTypePill({ type }) {
  const full = type === "full";
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
      full
        ? "bg-primary/15 text-primary border border-primary/20"
        : "bg-warning/15 text-warning border border-warning/20",
    )}>
      {full ? "Full Return" : "Partial Return"}
    </span>
  );
}

// ── Void Confirm Dialog ───────────────────────────────────────────────────────
function VoidReturnDialog({ open, onOpenChange, returnRef, onConfirm, isLoading }) {
  const [reason, setReason] = useState("");

  function handleConfirm() {
    onConfirm(reason.trim() || undefined);
    setReason("");
  }

  function handleClose(v) {
    if (!v) setReason("");
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md border-border bg-card p-0 overflow-hidden">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="p-6">
          <DialogHeader className="mb-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10">
                <Ban className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">Void Return</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Void <span className="font-mono font-bold">{formatRef(returnRef)}</span>?
                  This will reverse any stock that was restocked.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 mb-5">
            {/* Warning */}
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/8 px-3.5 py-3">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              <p className="text-[11px] text-destructive/90 leading-relaxed">
                This action <span className="font-bold">cannot be undone</span>.
                Any restocked inventory will be removed from stock again.
                The original transaction status will be recalculated.
              </p>
            </div>

            {/* Reason */}
            <div>
              <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
                Void Reason{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Return processed in error"
                className="text-sm"
                autoFocus
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isLoading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Voiding…
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4" />
                  Void Return
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Detail Panel ─────────────────────────────────────────────────────────
export function ReturnDetailPanel() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const { ret, items, isLoading, error, invalidate } = useReturn(id);
  const voidMutation = useVoidReturn();

  const [copied,      setCopied]      = useState(false);
  const [voidOpen,    setVoidOpen]    = useState(false);

  function copyRef() {
    navigator.clipboard.writeText(ret?.reference_no ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function handleVoid(reason) {
    try {
      await voidMutation.mutateAsync({ id: parseInt(id, 10), reason });
      setVoidOpen(false);
      invalidate();
    } catch {
      // error toast already fired by onMutationError
    }
  }

  if (isLoading) return <Spinner />;

  if (error || !ret) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={FileText}
          title="Return not found"
          description={
            typeof error === "string"
              ? error
              : "This return does not exist or could not be loaded."
          }
          action={
            <Button variant="outline" onClick={() => navigate("/returns")}>
              Back to Returns
            </Button>
          }
        />
      </div>
    );
  }

  const subtotal    = parseFloat(ret.subtotal     ?? 0);
  const tax         = parseFloat(ret.tax_amount   ?? 0);
  const totalAmount = parseFloat(ret.total_amount ?? 0);
  const isFull      = ret.return_type === "full";
  const isVoided    = ret.status === "voided";

  return (
    <>
      <PageHeader
        title={formatRef(ret.reference_no)}
        description={`Return processed on ${formatDate(ret.created_at)}`}
        backHref="/returns"
        badge={
          <div className="flex items-center gap-2">
            <ReturnTypePill type={ret.return_type} />
            <StatusBadge status={ret.status} size="md" />
          </div>
        }
        action={
          <div className="flex items-center gap-2">
            {/* Copy ref */}
            <Button
              variant="outline"
              size="xs"
              onClick={copyRef}
              className="h-8 gap-1.5"
            >
              {copied
                ? <Check className="h-3.5 w-3.5 text-success" />
                : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy Ref"}
            </Button>
            {/* Void — only for non-voided returns */}
            {!isVoided && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setVoidOpen(true)}
                className="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Ban className="h-3.5 w-3.5" />
                Void Return
              </Button>
            )}
          </div>
        }
      />

      {/* Type / void stripe */}
      <div className={cn(
        "h-[3px] w-full shrink-0",
        isVoided
          ? "bg-destructive"
          : isFull ? "bg-primary" : "bg-warning",
      )} />

      {/* Voided banner */}
      {isVoided && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3">
          <Ban className="h-4 w-4 text-destructive shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-destructive">
              This return has been voided
            </p>
            {ret.void_reason && (
              <p className="text-xs text-destructive/80 mt-0.5">{ret.void_reason}</p>
            )}
          </div>
          {ret.voided_at && (
            <p className="text-[11px] text-muted-foreground shrink-0">
              {formatDateTime(ret.voided_at)}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* ── Left: 2/3 ──────────────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-5">

              {/* Return Details */}
              <Section title="Return Details" icon={RotateCcw}>
                <div className="grid grid-cols-2 gap-x-8">
                  <div>
                    <Row
                      label="Return Reference"
                      value={
                        <span className="font-mono font-bold">
                          {formatRef(ret.reference_no)}
                        </span>
                      }
                    />
                    <Row
                      label="Original Transaction"
                      value={
                        <button
                          onClick={() => navigate(`/transactions/${ret.original_tx_id}`)}
                          className="font-mono font-bold text-primary hover:underline"
                        >
                          {formatRef(ret.original_ref_no)}
                        </button>
                      }
                    />
                    <Row
                      label="Return Type"
                      value={<ReturnTypePill type={ret.return_type} />}
                    />
                    <Row label="Date" value={formatDateTime(ret.created_at)} />
                  </div>
                  <div>
                    <Row
                      label="Refund Method"
                      value={REFUND_METHOD_LABELS[ret.refund_method] ?? ret.refund_method}
                    />
                    {ret.refund_reference && (
                      <Row
                        label="Refund Reference"
                        value={<span className="font-mono">{ret.refund_reference}</span>}
                      />
                    )}
                    <Row
                      label="Status"
                      value={<StatusBadge status={ret.status} size="sm" />}
                    />
                  </div>
                </div>
              </Section>

              {/* Cashier + Customer */}
              <div className="grid grid-cols-2 gap-5">
                <Section title="Cashier" icon={User}>
                  {ret.cashier_name ? (
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-[11px] font-bold text-primary uppercase">
                        {ret.cashier_name.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {ret.cashier_name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Processed return
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Unknown cashier</p>
                  )}
                </Section>

                <Section title="Customer" icon={User}>
                  {ret.customer_name ? (
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-[11px] font-bold text-muted-foreground uppercase">
                        {ret.customer_name.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {ret.customer_name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Customer ID #{ret.customer_id}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Walk-in customer
                    </p>
                  )}
                </Section>
              </div>

              {/* Returned Items */}
              <Section title={`Returned Items (${items.length})`} icon={Package}>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No items found.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-border bg-muted/10 p-4 space-y-2"
                      >
                        {/* Item header */}
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground leading-snug">
                              {item.item_name}
                            </p>
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                              {item.sku}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={cn(
                              "text-sm font-mono font-bold tabular-nums",
                              isVoided
                                ? "line-through text-muted-foreground"
                                : "text-destructive",
                            )}>
                              −{formatCurrency(parseFloat(item.line_total ?? 0))}
                            </p>
                            <p className="text-[10px] text-muted-foreground tabular-nums">
                              {formatQuantity(
                                parseFloat(item.quantity_returned ?? 0),
                                item.measurement_type,
                                item.unit_type,
                              )} × {formatCurrency(parseFloat(item.unit_price ?? 0))}
                            </p>
                          </div>
                        </div>

                        {/* Condition + restock */}
                        <div className="flex items-center justify-between pt-2 border-t border-border/40">
                          <div className="flex items-center gap-3">
                            <ConditionBadge condition={item.condition} />
                            <RestockIndicator restocked={item.restocked && !isVoided} />
                          </div>
                          {item.notes && (
                            <span className="text-[10px] text-muted-foreground italic max-w-xs truncate">
                              {item.notes}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Reason & Notes */}
              {(ret.reason || ret.notes) && (
                <Section title="Notes & Reason" icon={FileText}>
                  <div className="space-y-3">
                    {ret.reason && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          Return Reason
                        </p>
                        <p className="text-sm text-foreground">{ret.reason}</p>
                      </div>
                    )}
                    {ret.notes && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          Additional Notes
                        </p>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {ret.notes}
                        </p>
                      </div>
                    )}
                  </div>
                </Section>
              )}

            </div>

            {/* ── Right: 1/3 ─────────────────────────────────────────────── */}
            <div className="space-y-5">

              {/* Financial Summary */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className={cn(
                  "h-[3px] w-full",
                  isVoided ? "bg-destructive" : isFull ? "bg-primary" : "bg-warning",
                )} />
                <div className="px-5 py-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
                    Refund Summary
                  </p>
                  <SummaryLine label="Subtotal" value={formatCurrency(subtotal)} />
                  <SummaryLine label="Tax"      value={formatCurrency(tax)} />
                  <SummaryLine
                    label="Total Refunded"
                    value={formatCurrency(totalAmount)}
                    large
                    accent={isVoided ? undefined : "destructive"}
                    separator
                  />
                  {isVoided && (
                    <p className="mt-2 text-[10px] font-semibold text-destructive uppercase tracking-wide">
                      Voided — refund reversed
                    </p>
                  )}
                </div>
              </div>

              {/* Quick Info */}
              <div className="rounded-xl border border-border bg-card px-5 py-4 space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Quick Info
                </p>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Return Type</span>
                    <ReturnTypePill type={ret.return_type} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Items</span>
                    <span className="text-[11px] font-semibold text-foreground">
                      {items.length} item{items.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Restocked</span>
                    <span className={cn(
                      "text-[11px] font-semibold",
                      isVoided ? "text-muted-foreground line-through" : "text-success",
                    )}>
                      {items.filter((i) => i.restocked).length} item
                      {items.filter((i) => i.restocked).length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {ret.refund_reference && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">Ref #</span>
                      <span className="text-[11px] font-mono font-semibold text-foreground">
                        {ret.refund_reference}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Navigation */}
              <Button
                variant="outline"
                className="w-full gap-2 text-xs"
                onClick={() => navigate(`/transactions/${ret.original_tx_id}`)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                View Original Transaction
              </Button>

              {/* Void button (sidebar position) */}
              {!isVoided && (
                <Button
                  variant="outline"
                  className="w-full gap-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => setVoidOpen(true)}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Void This Return
                </Button>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Void confirmation dialog */}
      <VoidReturnDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        returnRef={ret.reference_no}
        onConfirm={handleVoid}
        isLoading={voidMutation.isPending}
      />
    </>
  );
}
