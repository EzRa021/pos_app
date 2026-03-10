// features/loyalty/LoyaltyBalanceCard.jsx — Shows points balance + adjust button
import { useState } from "react";
import { Star, SlidersHorizontal, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useLoyaltyBalance, useLoyaltyActions } from "./useLoyalty";
import { formatCurrency } from "@/lib/format";

function AdjustDialog({ open, onOpenChange, onAdjust }) {
  const [points, setPoints] = useState("");
  const [notes,  setNotes]  = useState("");
  const [busy,   setBusy]   = useState(false);

  const handleSave = async () => {
    const pts = parseInt(points, 10);
    if (isNaN(pts) || pts === 0) { toast.error("Enter a non-zero points amount."); return; }
    if (!notes.trim())           { toast.error("Reason is required."); return; }
    setBusy(true);
    try {
      await onAdjust({ points: pts, notes: notes.trim() });
      toast.success(`Points adjusted by ${pts > 0 ? "+" : ""}${pts.toLocaleString()}.`);
      setPoints(""); setNotes("");
      onOpenChange(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-warning" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-warning/25 bg-warning/10">
              <SlidersHorizontal className="h-5 w-5 text-warning" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Adjust Loyalty Points</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Positive to add, negative to deduct
              </DialogDescription>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Points</label>
            <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)}
              placeholder="e.g. 50 or -25" className="h-8 text-sm" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Reason *</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Goodwill adjustment" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy || !notes} className="gap-1.5">
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : "Save Adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LoyaltyBalanceCard({ customerId, canManage = true }) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const { balance, isLoading, error } = useLoyaltyBalance(customerId);
  const { adjust } = useLoyaltyActions(customerId);

  if (isLoading) return (
    <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading points…
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-1.5 text-xs text-destructive py-2">
      <AlertCircle className="h-3.5 w-3.5" /> {String(error)}
    </div>
  );

  const points     = parseFloat(balance?.points     ?? 0);
  const nairaValue = parseFloat(balance?.naira_value ?? 0);

  return (
    <>
      <div className={cn(
        "rounded-xl border-2 px-5 py-4",
        points > 0 ? "border-warning/30 bg-warning/5" : "border-border bg-muted/10",
      )}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Loyalty Points</p>
            <p className={cn("text-2xl font-bold tabular-nums mt-1", points > 0 ? "text-warning" : "text-muted-foreground")}>
              {Math.round(points).toLocaleString()} pts
            </p>
            {nairaValue > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Worth <span className="font-semibold text-foreground">{formatCurrency(nairaValue)}</span> in redemptions
              </p>
            )}
          </div>
          <Star className={cn("h-8 w-8 shrink-0", points > 0 ? "text-warning/40" : "text-muted-foreground/20")} />
        </div>
      </div>
      {canManage && (
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)} className="gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />Adjust Points
          </Button>
        </div>
      )}
      <AdjustDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        onAdjust={(p) => adjust.mutateAsync(p)}
      />
    </>
  );
}
