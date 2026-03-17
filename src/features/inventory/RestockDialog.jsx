// ============================================================================
// features/inventory/RestockDialog.jsx
// ============================================================================

import { useState, useEffect } from "react";
import { Package, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { formatQuantity, stepForType } from "@/lib/format";

export function RestockDialog({ open, onOpenChange, item, mutation }) {
  const [qty,  setQty]  = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setQty(item?.default_qty != null ? String(parseFloat(item.default_qty)) : "");
      setNote("");
    } else {
      setQty(""); setNote("");
    }
  }, [open, item?.default_qty]);

  function handleSubmit(e) {
    e.preventDefault();
    const q = parseFloat(qty);
    if (!q || q <= 0) return;
    mutation.mutate(
      { itemId: item?.id ?? item?.item_id, quantity: q, note: note || null },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const currentQty     = parseFloat(item?.quantity ?? 0);
  const measureType    = item?.measurement_type ?? null;
  const unitType       = item?.unit_type ?? null;
  const minIncrement   = item?.min_increment != null ? parseFloat(item.min_increment) : null;
  const step           = stepForType(measureType, minIncrement);

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-emerald-500" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10">
                <Plus className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold text-foreground">Restock Item</DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground">
                  {item?.item_name ?? "—"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="mb-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Current Stock</span>
            <span className="text-sm font-bold text-foreground tabular-nums">
              {formatQuantity(currentQty, measureType, unitType)}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Quantity to Add <span className="text-destructive">*</span>
              </label>
              <Input
                type="number" min={step} step={step}
                value={qty} onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 50" autoFocus required
              />
              {qty && parseFloat(qty) > 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  New total:{" "}
                  <strong className="text-emerald-400">
                    {formatQuantity(currentQty + parseFloat(qty), measureType, unitType)}
                  </strong>
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Note <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Supplier delivery #123" />
            </div>
            {mutation.error && (
              <p className="text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">{String(mutation.error)}</p>
            )}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white" disabled={mutation.isPending || !qty || parseFloat(qty) <= 0}>
                {mutation.isPending ? "Restocking…" : "Add Stock"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
