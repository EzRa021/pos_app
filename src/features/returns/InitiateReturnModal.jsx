// ============================================================================
// features/returns/InitiateReturnModal.jsx
// ============================================================================
// Opens from TransactionDetailPanel. Takes the original transaction and its
// items. Lets the cashier select items, set quantity, condition, restock flag,
// choose refund method, and enter a reason.
// ============================================================================

import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import {
  RotateCcw,
  Loader2,
  Package,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useCreateReturn } from "@/features/returns/useReturns";
// Note: toast.success is NOT called here — useCreateReturn's onSuccess
// handles all success feedback using formatCurrency (no hardcoded symbols).
import { formatCurrency, formatRef, stepForType } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────────────────────────
const REFUND_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "transfer", label: "Bank Transfer" },
  { value: "original_method", label: "Original Payment Method" },
  { value: "store_credit", label: "Store Credit" },
];

const CONDITIONS = [
  {
    value: "good",
    label: "Good",
    cls: "border-success/30 bg-success/10 text-success",
  },
  {
    value: "damaged",
    label: "Damaged",
    cls: "border-warning/30 bg-warning/10 text-warning",
  },
  {
    value: "defective",
    label: "Defective",
    cls: "border-destructive/30 bg-destructive/10 text-destructive",
  },
];

const RETURN_REASONS = [
  "Defective product",
  "Wrong item received",
  "Customer changed mind",
  "Overcharged",
  "Duplicate purchase",
  "Quality issue",
  "Other",
];

// ── ConditionChip ──────────────────────────────────────────────────────────────
function ConditionChip({ value, selected, onClick }) {
  const cond = CONDITIONS.find((c) => c.value === value);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-all duration-100",
        selected
          ? cond.cls
          : "border-border/50 bg-muted/30 text-muted-foreground hover:border-border",
      )}
    >
      {cond?.label}
    </button>
  );
}

// ── ItemRow ────────────────────────────────────────────────────────────────────
function ItemRow({ item, state, onChange, alreadyReturned = 0 }) {
  const soldQty  = parseFloat(item.quantity ?? 1);
  // Cap max returnable qty to what hasn't been returned yet
  const remaining = Math.max(0, soldQty - alreadyReturned);
  const maxQty    = remaining;
  const isFullyReturned = alreadyReturned >= soldQty;
  const unitPrice =
    parseFloat(item.line_total ?? 0) /
    Math.max(soldQty, 1);
  const lineTotal = state.enabled ? unitPrice * state.quantity : 0;
  const unitLabel  = item.unit_type ?? "unit(s)";
  const minIncrement = item.min_increment != null ? parseFloat(item.min_increment) : null;
  const step       = stepForType(item.measurement_type, minIncrement);

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-all duration-150",
        isFullyReturned
          ? "border-border/40 bg-muted/20 opacity-60"
          : state.enabled
            ? "border-primary/25 bg-primary/5 shadow-sm"
            : "border-border/50 bg-muted/10 opacity-80",
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Checkbox — disabled when fully returned */}
        <button
          type="button"
          onClick={() => !isFullyReturned && onChange({ enabled: !state.enabled })}
          disabled={isFullyReturned}
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all",
            isFullyReturned
              ? "border-border/40 bg-muted/30 cursor-not-allowed"
              : state.enabled
                ? "border-primary bg-primary text-white"
                : "border-border/60 hover:border-primary/60",
          )}
        >
          {isFullyReturned
            ? <XCircle className="h-3 w-3 text-muted-foreground/50" />
            : state.enabled && <CheckCircle2 className="h-3 w-3" />}
        </button>

        {/* Item info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={cn(
                "text-sm font-semibold leading-snug",
                isFullyReturned ? "text-muted-foreground line-through decoration-muted-foreground/50" : "text-foreground",
              )}>
                {item.item_name}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                {item.sku}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-mono font-bold tabular-nums">
                {formatCurrency(parseFloat(item.line_total ?? 0))}
              </p>
              {isFullyReturned ? (
                <p className="text-[10px] font-semibold text-success">
                  Fully returned
                </p>
              ) : alreadyReturned > 0 ? (
                <p className="text-[10px] text-warning font-semibold">
                  {remaining} of {soldQty} remaining
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  {maxQty} {unitLabel} × {formatCurrency(unitPrice)}
                </p>
              )}
            </div>
          </div>

          {/* Controls (only when enabled) */}
          {state.enabled && (
            <div className="mt-3 space-y-3">
              {/* Quantity + live total */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  Qty to return:
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ quantity: Math.max(step, state.quantity - step) })
                    }
                    disabled={state.quantity <= step}
                    className="h-7 w-7 rounded-lg border border-border bg-muted/50 text-sm font-bold hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-mono font-bold tabular-nums">
                    {state.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        quantity: Math.min(maxQty, state.quantity + step),
                      })
                    }
                    disabled={state.quantity >= maxQty}
                    className="h-7 w-7 rounded-lg border border-border bg-muted/50 text-sm font-bold hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    +
                  </button>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  of {maxQty}{alreadyReturned > 0 ? ` (${alreadyReturned} already returned)` : ""}
                </span>
                <span className="ml-auto text-sm font-mono font-bold text-primary">
                  {formatCurrency(lineTotal)}
                </span>
              </div>

              {/* Condition */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  Condition:
                </span>
                <div className="flex gap-1.5">
                  {CONDITIONS.map((c) => (
                    <ConditionChip
                      key={c.value}
                      value={c.value}
                      selected={state.condition === c.value}
                      onClick={() =>
                        onChange({
                          condition: c.value,
                          // auto-uncheck restock if not good condition
                          restock: c.value === "good" ? state.restock : false,
                        })
                      }
                    />
                  ))}
                </div>
              </div>

              {/* Restock + item notes on same row */}
              <div className="flex items-center gap-4">
                {/* Restock toggle */}
                <button
                  type="button"
                  onClick={() => onChange({ restock: !state.restock })}
                  disabled={state.condition !== "good"}
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] font-medium transition-colors",
                    state.condition !== "good" &&
                      "opacity-40 cursor-not-allowed",
                    state.restock ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {state.restock ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground/60" />
                  )}
                  Restock item
                </button>

                {/* Item notes */}
                <Input
                  value={state.notes}
                  onChange={(e) => onChange({ notes: e.target.value })}
                  placeholder="Item note (optional)"
                  className="h-7 text-[11px] flex-1"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export function InitiateReturnModal({
  open,
  onOpenChange,
  transaction,
  txItems = [],
  returnedQtyMap = {},   // { [item_id: string]: number } — already returned per item
  onSuccess,
}) {
  const [itemState, setItemState] = useState({});
  const [refundMethod, setRefundMethod] = useState("cash");
  const [refundRef, setRefundRef] = useState("");
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");

  const createReturnMutation = useCreateReturn();

  // Reset when opened
  useEffect(() => {
    if (!open) return;
    const init = {};
    txItems.forEach((item) => {
      const rawQty      = parseFloat(item.quantity ?? 1);
      const isWeighted  = item.measurement_type && item.measurement_type !== "quantity";
      const soldQty     = isWeighted ? rawQty : Math.floor(rawQty);
      const alreadyRet  = returnedQtyMap[item.item_id] ?? 0;
      const remaining   = Math.max(0, soldQty - alreadyRet);
      // Cap initial qty to what's still returnable; default to full remaining
      const initQty     = remaining;
      init[item.item_id] = {
        enabled:   false,
        quantity:  initQty > 0 ? initQty : 1, // avoid 0 default
        condition: "good",
        restock:   true,
        notes:     "",
      };
    });
    setItemState(init);
    setRefundMethod("cash");
    setRefundRef("");
    setReason("");
    setCustomReason("");
    setNotes("");
  }, [open, txItems, returnedQtyMap]);

  const updateItem = (id, patch) =>
    setItemState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Computed totals
  const { selectedCount, returnTotal, selectedItems } = useMemo(() => {
    let total = 0;
    let count = 0;
    const selected = [];

    (txItems ?? []).forEach((item) => {
      const s = itemState[item.item_id];
      if (!s?.enabled) return;
      // Guard: skip if this item's qty has somehow been set above remaining
      const alreadyRet = returnedQtyMap[item.item_id] ?? 0;
      const soldQty    = parseFloat(item.quantity ?? 1);
      if (alreadyRet >= soldQty) return;
      count++;
      const unitPrice =
        parseFloat(item.line_total ?? 0) /
        Math.max(soldQty, 1);
      total += unitPrice * s.quantity;
      selected.push({ item, s });
    });

    return {
      selectedCount: count,
      returnTotal: total,
      selectedItems: selected,
    };
  }, [itemState, txItems, returnedQtyMap]);

  const effectiveReason = reason === "Other" ? customReason : reason;
  const canSubmit =
    selectedCount > 0 && !!refundMethod && !!effectiveReason.trim();

  async function handleSubmit() {
    if (!canSubmit) {
      if (selectedCount === 0)
        toast.error("Select at least one item to return");
      else if (!effectiveReason.trim())
        toast.error("Please enter a return reason");
      return;
    }

    const payload = {
      original_tx_id: transaction.id,
      refund_method: refundMethod,
      refund_reference: refundRef.trim() || undefined,
      reason: effectiveReason.trim(),
      notes: notes.trim() || undefined,
      items: selectedItems.map(({ item, s }) => ({
        item_id: item.item_id,
        quantity_returned: s.quantity,
        condition: s.condition,
        restock: s.restock,
        notes: s.notes.trim() || undefined,
      })),
    };

    try {
      const result = await createReturnMutation.mutateAsync(payload);
      // Success toast is fired by useCreateReturn's onSuccess (uses formatCurrency).
      onOpenChange(false);
      onSuccess?.(result);
    } catch (err) {
      // Error toast is fired by useCreateReturn's onError.
    }
  }

  const isLoading = createReturnMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60 max-h-[90vh] flex flex-col">
        {/* Top accent bar */}
        <div className="h-[3px] w-full bg-warning shrink-0" />

        {/* Header */}
        <div className="px-6 pt-5 pb-0 shrink-0">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/25 bg-warning/10">
                <RotateCcw className="h-5 w-5 text-warning" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">
                  Initiate Return
                </DialogTitle>
                <DialogDescription className="text-xs mt-0.5 text-muted-foreground">
                  {formatRef(transaction?.reference_no)} · Select items to
                  return and set refund details
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Items */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-2">
              <Package className="h-3.5 w-3.5" />
              Select Items to Return
            </p>
            {txItems.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                No items found in this transaction.
              </div>
            ) : (
              <div className="space-y-2">
                {txItems.map((item) => (
                  <ItemRow
                    key={item.item_id}
                    item={item}
                    state={
                      itemState[item.item_id] ?? {
                        enabled: false,
                        quantity: 1,
                        condition: "good",
                        restock: true,
                        notes: "",
                      }
                    }
                    alreadyReturned={returnedQtyMap[item.item_id] ?? 0}
                    onChange={(patch) => updateItem(item.item_id, patch)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Refund method + reference */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
                Refund Method <span className="text-destructive">*</span>
              </label>
              <Select value={refundMethod} onValueChange={setRefundMethod}>
                <SelectTrigger className="text-sm h-9">
                  <SelectValue placeholder="Select method…" />
                </SelectTrigger>
                <SelectContent>
                  {REFUND_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
                Reference{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <Input
                value={refundRef}
                onChange={(e) => setRefundRef(e.target.value)}
                placeholder="e.g. POS-12345, cheque no…"
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
              Return Reason <span className="text-destructive">*</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {RETURN_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={cn(
                    "px-3 py-1 rounded-full border text-[11px] font-medium transition-all duration-100",
                    reason === r
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            {reason === "Other" && (
              <Input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe the return reason…"
                className="text-sm"
                autoFocus
              />
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] font-semibold text-foreground mb-1.5 block">
              Notes{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes about this return…"
              className="text-sm"
            />
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning/8 px-3.5 py-3">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[11px] text-warning/90 leading-relaxed">
              Items marked <span className="font-bold">Good + Restock</span>{" "}
              will be added back to inventory. Damaged or defective items will{" "}
              <span className="font-bold">not</span> be restocked.
            </p>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 bg-card/80 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <span className="text-[11px] text-muted-foreground">
                {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
              </span>
              {selectedCount > 0 && (
                <span className="text-[11px] font-semibold text-warning">
                  Refund: {formatCurrency(returnTotal)}
                </span>
              )}
            </div>
            {(() => {
              const fullyReturnedCount = txItems.filter(
                (it) => (returnedQtyMap[it.item_id] ?? 0) >= parseFloat(it.quantity ?? 1)
              ).length;
              return fullyReturnedCount > 0 ? (
                <span className="text-[10px] text-muted-foreground">
                  {fullyReturnedCount} item{fullyReturnedCount !== 1 ? "s" : ""} already fully returned
                </span>
              ) : null;
            })()}
          </div>
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !canSubmit}
              className="flex-1 bg-warning hover:bg-warning/90 text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4" />
                  Process Return{" "}
                  {selectedCount > 0 && `· ${formatCurrency(returnTotal)}`}
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
