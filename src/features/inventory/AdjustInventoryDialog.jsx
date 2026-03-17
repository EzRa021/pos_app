// ============================================================================
// features/inventory/AdjustInventoryDialog.jsx
// ============================================================================

import { useState, useEffect } from "react";
import { BarChart3 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatQuantity, stepForType } from "@/lib/format";
import { cn }       from "@/lib/utils";

const REASONS = [
  { value: "damage",     label: "Damage" },
  { value: "theft",      label: "Theft" },
  { value: "audit",      label: "Audit Correction" },
  { value: "correction", label: "Data Correction" },
  { value: "loss",       label: "Loss" },
  { value: "other",      label: "Other" },
];

export function AdjustInventoryDialog({ open, onOpenChange, item, mutation }) {
  const [adj,    setAdj]    = useState("");
  const [reason, setReason] = useState("");
  const [notes,  setNotes]  = useState("");

  useEffect(() => {
    if (!open) { setAdj(""); setReason(""); setNotes(""); }
  }, [open]);

  function handleSubmit(e) {
    e.preventDefault();
    const q = parseFloat(adj);
    if (isNaN(q) || !reason) return;
    mutation.mutate(
      {
        itemId: item?.id ?? item?.item_id,
        adjustmentQuantity: q,
        reason,
        notes: notes || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const currentQty   = parseFloat(item?.quantity ?? 0);
  const measureType  = item?.measurement_type ?? null;
  const unitType     = item?.unit_type ?? null;
  const minIncrement = item?.min_increment != null ? parseFloat(item.min_increment) : null;
  const step         = stepForType(measureType, minIncrement);
  const adjVal       = parseFloat(adj);
  const newQty     = !isNaN(adjVal) ? currentQty + adjVal : null;
  const isNeg      = !isNaN(adjVal) && adjVal < 0;
  const isPos      = !isNaN(adjVal) && adjVal > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-amber-500" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10">
                <BarChart3 className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">Adjust Inventory</DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground">
                  {item?.item_name ?? "—"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="mb-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Current Stock</span>
            <span className="text-sm font-bold tabular-nums">
              {formatQuantity(currentQty, measureType, unitType)}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Adjustment <span className="text-destructive">*</span>
                <span className="ml-1 font-normal text-muted-foreground">(positive or negative)</span>
              </label>
              <Input
                type="number" step={step}
                value={adj} onChange={(e) => setAdj(e.target.value)}
                placeholder="-5 or +10" autoFocus required
              />
              {newQty !== null && (
                <p className="text-[11px] mt-1">
                  New total:{" "}
                  <strong className={cn(
                    "tabular-nums",
                    isNeg ? "text-rose-400" : isPos ? "text-emerald-400" : "text-foreground",
                  )}>
                    {formatQuantity(newQty, measureType, unitType)}
                  </strong>
                  {newQty < 0 && <span className="text-rose-400 ml-1">⚠ negative</span>}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Reason <span className="text-destructive">*</span>
              </label>
              <Select value={reason} onValueChange={setReason} required>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select reason…" />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Notes</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional additional notes" />
            </div>

            {mutation.error && (
              <p className="text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">{String(mutation.error)}</p>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending || !adj || !reason}>
                {mutation.isPending ? "Adjusting…" : "Apply Adjustment"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
