// features/loyalty/LoyaltyBalanceCard.jsx
import { useState } from "react";
import { Star, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import {
  Dialog, DialogContent,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useCustomerLoyalty } from "./useLoyalty";
import { formatCurrency } from "@/lib/format";

// ── Adjust points dialog ──────────────────────────────────────────────────────
function AdjustDialog({ open, onOpenChange, currentPoints, onAdjust }) {
  const [points, setPoints] = useState("");
  const [notes,  setNotes]  = useState("");
  const [busy,   setBusy]   = useState(false);

  const handleOpenChange = (val) => {
    if (!val) { setPoints(""); setNotes(""); }
    onOpenChange(val);
  };

  const handleSave = async () => {
    const pts = parseInt(points, 10);
    if (isNaN(pts) || pts === 0) { toast.error("Enter a non-zero point adjustment."); return; }
    if (!notes.trim())           { toast.error("Reason is required."); return; }
    // Guard: can't deduct more than current balance
    if (pts < 0 && Math.abs(pts) > currentPoints) {
      toast.error(`Cannot deduct ${Math.abs(pts)} pts — balance is only ${currentPoints}.`);
      return;
    }
    setBusy(true);
    try {
      await onAdjust({ points: pts, notes: notes.trim() });
      handleOpenChange(false);
    } catch (e) {
      toast.error(typeof e === "string" ? e : (e?.message ?? "Adjustment failed."));
    } finally {
      setBusy(false);
    }
  };

  const pts     = parseInt(points, 10) || 0;
  const isAdd   = pts > 0;
  const previewBalance = pts !== 0 ? currentPoints + pts : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-warning" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-warning/25 bg-warning/10">
              <Star className="h-5 w-5 text-warning" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Adjust Loyalty Points</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Positive to add, negative to deduct. Current: <strong className="text-foreground">{currentPoints.toLocaleString()} pts</strong>
              </DialogDescription>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Adjustment <span className="text-destructive">*</span>
            </label>
            <Input
              type="number" step="1" value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="e.g. 50 or -20" className="h-8 text-sm" autoFocus
            />
          </div>

          {/* Preview new balance */}
          {previewBalance !== null && (
            <div className={cn(
              "rounded-lg border px-3.5 py-2.5 flex items-center justify-between",
              previewBalance < 0
                ? "border-destructive/25 bg-destructive/8"
                : isAdd ? "border-success/25 bg-success/8" : "border-warning/25 bg-warning/8",
            )}>
              <span className="text-[11px] text-muted-foreground">New Balance</span>
              <span className={cn(
                "text-sm font-bold tabular-nums",
                previewBalance < 0 ? "text-destructive" : isAdd ? "text-success" : "text-warning",
              )}>
                {Math.max(0, previewBalance).toLocaleString()} pts
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Reason <span className="text-destructive">*</span>
            </label>
            <Input
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for adjustment" className="h-8 text-sm"
            />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}
            disabled={busy || !notes.trim() || !points || pts === 0}
            className="gap-1.5">
            {busy
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
              : "Save Adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── LoyaltyBalanceCard ────────────────────────────────────────────────────────
export function LoyaltyBalanceCard({ customerId, canManage = true }) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const { balance, isLoading, adjust } = useCustomerLoyalty(customerId);

  if (isLoading) return (
    <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading loyalty balance…
    </div>
  );

  const points   = parseInt(balance?.points     ?? 0, 10);
  const nairaVal = parseFloat(balance?.naira_value ?? 0);
  const active   = balance?.programme_active ?? true;

  return (
    <div className="space-y-3">
      {/* Balance card */}
      <div className={cn(
        "rounded-xl border-2 px-5 py-4 flex items-center justify-between gap-4",
        points > 0 && active ? "border-warning/30 bg-warning/5" : "border-border bg-muted/10",
      )}>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Loyalty Points Balance
          </p>
          <p className={cn(
            "text-2xl font-bold tabular-nums mt-1",
            points > 0 && active ? "text-warning" : "text-muted-foreground",
          )}>
            {points.toLocaleString()} pts
          </p>
          {nairaVal > 0 && active && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Redeemable value:{" "}
              <span className="font-semibold text-foreground">{formatCurrency(nairaVal)}</span>
            </p>
          )}
          {!active && (
            <p className="text-[11px] text-warning mt-1">
              Loyalty programme is currently inactive for this store.
            </p>
          )}
        </div>
        <Star className={cn(
          "h-8 w-8 shrink-0",
          points > 0 && active ? "text-warning/40" : "text-muted-foreground/20",
        )} />
      </div>

      {/* Adjust button — only shown to managers */}
      {canManage && (
        <Button
          size="sm" variant="outline"
          onClick={() => setAdjustOpen(true)}
          className="gap-1.5"
        >
          <Star className="h-3.5 w-3.5" />
          Adjust Points
        </Button>
      )}

      <AdjustDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        currentPoints={points}
        onAdjust={(p) => adjust.mutateAsync(p)}
      />
    </div>
  );
}
