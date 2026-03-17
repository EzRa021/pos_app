// ============================================================================
// features/items/AdjustStockDialog.jsx
// ============================================================================
// Quick stock adjustment modal — used from both the items list and detail page.
//
// Adjustment types:
//   ADJUSTMENT   — generic manual correction
//   RESTOCK      — received new stock
//   DAMAGE       — damaged / write-off
//   THEFT        — lost to theft
//   LOSS         — shrinkage / unaccounted loss
//   CORRECTION   — count correction (audit)
// ============================================================================

import { useState, useEffect } from "react";
import {
  TrendingUp, TrendingDown, RotateCcw,
  ShieldAlert, Minus, ClipboardCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatQuantity, stepForType } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Adjustment type config ────────────────────────────────────────────────────
const TYPES = [
  { key: "RESTOCK",    label: "Restock",    icon: TrendingUp,    sign: +1, accent: "success", hint: "Stock received from supplier or transfer." },
  { key: "ADJUSTMENT", label: "Correction", icon: RotateCcw,     sign:  0, accent: "primary", hint: "Arbitrary + or - correction to system qty." },
  { key: "DAMAGE",     label: "Damage",     icon: ShieldAlert,   sign: -1, accent: "destructive", hint: "Write off damaged or expired stock." },
  { key: "THEFT",      label: "Theft",      icon: Minus,         sign: -1, accent: "destructive", hint: "Stock lost due to theft or pilfering." },
  { key: "LOSS",       label: "Loss",       icon: TrendingDown,  sign: -1, accent: "warning",     hint: "General shrinkage or unaccounted loss." },
  { key: "CORRECTION", label: "Audit",      icon: ClipboardCheck,sign:  0, accent: "primary",     hint: "Post-count correction after stock audit." },
];

const ACCENT_CLASSES = {
  success:     { pill: "border-success/30 bg-success/10 text-success",         btn: "bg-success hover:bg-success/90 text-white" },
  primary:     { pill: "border-primary/30 bg-primary/10 text-primary",         btn: "" },
  warning:     { pill: "border-warning/30 bg-warning/10 text-warning",         btn: "bg-warning hover:bg-warning/90 text-white" },
  destructive: { pill: "border-destructive/30 bg-destructive/10 text-destructive", btn: "" },
};

export function AdjustStockDialog({ open, onOpenChange, item, storeId, mutation }) {
  const [adjType, setAdjType] = useState("RESTOCK");
  const [qty,     setQty]     = useState("");
  const [notes,   setNotes]   = useState("");

  useEffect(() => {
    if (!open) { setAdjType("RESTOCK"); setQty(""); setNotes(""); }
  }, [open]);

  const typeConfig    = TYPES.find((t) => t.key === adjType) ?? TYPES[0];
  const currentQty    = parseFloat(item?.quantity ?? 0);
  const measureType   = item?.measurement_type ?? null;
  const unitType      = item?.unit_type ?? null;
  const minIncrement  = item?.min_increment != null ? parseFloat(item.min_increment) : null;
  const step          = stepForType(measureType, minIncrement);
  const qtyNum        = parseFloat(qty) || 0;

  // Compute actual signed delta
  const delta = typeConfig.sign === 1 ? Math.abs(qtyNum)
    : typeConfig.sign === -1 ? -Math.abs(qtyNum)
    : qtyNum; // sign === 0 means user controls sign (can be negative)

  const newQty = currentQty + delta;

  function handleConfirm() {
    if (!qty || qtyNum === 0) return;
    mutation.mutate(
      {
        item_id:         item.id,
        store_id:        storeId,
        adjustment:      delta,
        adjustment_type: adjType,
        notes:           notes.trim() || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const canSubmit = qty && qtyNum !== 0 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-md border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-primary" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-[15px] font-bold text-foreground">
              Adjust Stock
            </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
              <span className="font-semibold text-foreground">{item?.item_name}</span>
              {" "}— SKU: {item?.sku} · Current: {formatQuantity(currentQty, measureType, unitType)}
              </DialogDescription>
          </DialogHeader>

          {/* Type selector */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-foreground mb-2">Adjustment Type</p>
            <div className="grid grid-cols-3 gap-1.5">
              {TYPES.map((t) => {
                const Icon = t.icon;
                const selected = adjType === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setAdjType(t.key)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-[10px] font-semibold transition-all duration-150",
                      selected
                        ? ACCENT_CLASSES[t.accent]?.pill ?? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/50",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">{typeConfig.hint}</p>
          </div>

          {/* Quantity input */}
          <div className="mb-3">
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Quantity
              <span className="ml-1 font-normal text-muted-foreground">
                ({typeConfig.sign === 1 ? "add" : typeConfig.sign === -1 ? "remove" : "signed delta"})
              </span>
            </label>
            <Input
              type="number"
              min={typeConfig.sign === 0 ? undefined : step}
              step={step}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={typeConfig.sign === 0 ? "e.g. -5 or +10" : "e.g. 50"}
              autoFocus
            />
          </div>

          {/* Notes */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason or reference number"
            />
          </div>

          {/* Preview */}
          {qty && qtyNum !== 0 && (
            <div className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2.5 mb-4 text-[11px]",
              newQty < 0
                ? "border-destructive/25 bg-destructive/10"
                : "border-border/60 bg-muted/30",
            )}>
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Current → New Stock</p>
                <p className="font-bold text-foreground">
                  {formatQuantity(currentQty, measureType, unitType)} → {formatQuantity(newQty, measureType, unitType)}
                  <span className={cn(
                    "ml-2 font-semibold",
                    delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-foreground",
                  )}>
                    ({delta > 0 ? "+" : ""}{formatQuantity(delta, measureType, unitType)})
                  </span>
                </p>
              </div>
              {newQty < 0 && (
                <p className="text-destructive font-semibold flex items-center gap-1">
                  ⚠ Negative stock
                </p>
              )}
            </div>
          )}

          {mutation.error && (
            <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {String(mutation.error)}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1"
              disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={!canSubmit} onClick={handleConfirm}>
              {mutation.isPending ? "Applying…" : "Apply Adjustment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
