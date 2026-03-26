// ============================================================================
// features/bulk_operations/BulkStockAdjustDialog.jsx
// ============================================================================
// Adjust stock for a specific set of selected items.
// Each item gets an individual delta (positive = add, negative = deduct).
// Backend: bulk_stock_adjustment({ store_id, items: [{ item_id, adjustment, reason? }] })
// ============================================================================
import { useState, useMemo } from "react";
import { Loader2, PackagePlus, AlertTriangle, Plus, Minus } from "lucide-react";
import { toast }   from "sonner";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { cn }      from "@/lib/utils";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useBulkOperations }                  from "./useBulkOperations";
import { formatCurrency, formatDecimal }      from "@/lib/format";

// ── ItemRow ───────────────────────────────────────────────────────────────────
function ItemRow({ item, delta, reason, onDelta, onReason }) {
  const d     = parseFloat(delta) || 0;
  const color = d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="grid grid-cols-[1fr_100px_120px] items-center gap-2 py-2 border-b border-border/40 last:border-0">
      {/* Item info */}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{item.item_name}</p>
        <p className="text-[10px] text-muted-foreground font-mono">
          {item.sku ?? "—"} · Stock: <span className="text-foreground">{formatDecimal(parseFloat(item.quantity ?? 0))}</span>
        </p>
      </div>

      {/* Delta */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onDelta(String((parseFloat(delta) || 0) - 1))}
          className="h-6 w-6 shrink-0 flex items-center justify-center rounded border border-border hover:bg-muted/60 transition-colors"
        >
          <Minus className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
        <Input
          type="number" step="1" value={delta}
          onChange={(e) => onDelta(e.target.value)}
          className={cn("h-6 text-xs text-center px-1 tabular-nums font-bold", color)}
        />
        <button
          onClick={() => onDelta(String((parseFloat(delta) || 0) + 1))}
          className="h-6 w-6 shrink-0 flex items-center justify-center rounded border border-border hover:bg-muted/60 transition-colors"
        >
          <Plus className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
      </div>

      {/* Reason */}
      <Input
        value={reason} onChange={(e) => onReason(e.target.value)}
        placeholder="Reason…" className="h-6 text-xs"
      />
    </div>
  );
}

// ── BulkStockAdjustDialog ─────────────────────────────────────────────────────
export function BulkStockAdjustDialog({ open, onOpenChange, selectedItems = [] }) {
  const { stockAdjust } = useBulkOperations();

  // Per-item delta and reason state — keyed by item ID
  const [deltas,  setDeltas]  = useState({});
  const [reasons, setReasons] = useState({});

  const setDelta  = (id, val) => setDeltas((p)  => ({ ...p, [id]: val }));
  const setReason = (id, val) => setReasons((p) => ({ ...p, [id]: val }));

  const reset = () => { setDeltas({}); setReasons({}); };
  const handleOpenChange = (val) => { if (!val) reset(); onOpenChange(val); };

  // Build the payload items — only include items with a non-zero delta
  const payloadItems = useMemo(() => selectedItems
    .map((item) => ({
      item_id:    item.id,
      adjustment: parseFloat(deltas[item.id] ?? 0) || 0,
      reason:     reasons[item.id]?.trim() || undefined,
    }))
    .filter((i) => i.adjustment !== 0),
  [selectedItems, deltas, reasons]);

  const canSubmit = payloadItems.length > 0;

  const handleSave = async () => {
    if (!canSubmit) return;
    try {
      const result = await stockAdjust.mutateAsync({ items: payloadItems });
      toast.success(result?.message ?? `Stock adjusted for ${result?.affected ?? 0} item(s).`);
      handleOpenChange(false);
    } catch (e) {
      toast.error(typeof e === "string" ? e : e?.message ?? "Bulk stock adjustment failed.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 pb-3 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <PackagePlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Bulk Stock Adjustment</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {selectedItems.length} item{selectedItems.length !== 1 ? "s" : ""} selected · Positive = add, negative = deduct
              </DialogDescription>
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_100px_120px] gap-2 pb-1 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Item</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Delta</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reason</span>
          </div>
        </div>

        {/* Item list */}
        <div className="max-h-72 overflow-y-auto px-6">
          {selectedItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              delta={deltas[item.id] ?? "0"}
              reason={reasons[item.id] ?? ""}
              onDelta={(val) => setDelta(item.id, val)}
              onReason={(val) => setReason(item.id, val)}
            />
          ))}
        </div>

        <div className="px-6 pt-3 pb-2">
          {/* Summary */}
          {payloadItems.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">{payloadItems.length}</span> item{payloadItems.length !== 1 ? "s" : ""} with non-zero adjustments will be updated.
            </div>
          )}
          {!canSubmit && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <AlertTriangle className="h-3 w-3 text-warning" />
              Set a non-zero delta for at least one item.
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={stockAdjust.isPending || !canSubmit} className="gap-1.5">
            {stockAdjust.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Adjusting…</>
              : "Apply Adjustments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
