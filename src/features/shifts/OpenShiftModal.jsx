// ============================================================================
// features/shifts/OpenShiftModal.jsx
// ============================================================================
import { useState }    from "react";
import { useMutation } from "@tanstack/react-query";
import { Timer, Loader2, Banknote, AlertTriangle } from "lucide-react";

import {
  Dialog, DialogContent,
  DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";

import { useShiftStore }  from "@/stores/shift.store";
import { useBranchStore } from "@/stores/branch.store";
import { queryClient }    from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { cn }             from "@/lib/utils";

export function OpenShiftModal({ open, onOpenChange }) {
  const [balance, setBalance] = useState("");
  const [notes,   setNotes]   = useState("");

  const openShiftFn = useShiftStore((s) => s.openShift);
  const storeId     = useBranchStore((s) => s.activeStore?.id);

  const mutation = useMutation({
    mutationFn: () =>
      openShiftFn({
        storeId,
        openingFloat: parseFloat(balance) || 0,
        notes:        notes.trim(),
      }),
    onSuccess: () => {
      // Refresh shift history and summary
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      queryClient.invalidateQueries({ queryKey: ["shift-summary"] });
      queryClient.invalidateQueries({ queryKey: ["cash-movements"] });
      setBalance("");
      setNotes("");
      onOpenChange(false);
    },
  });

  const [zeroConfirmed, setZeroConfirmed] = useState(false);

  const parsedBalance = parseFloat(balance) || 0;
  const isZero        = parsedBalance === 0;
  // Can submit if: amount > 0, OR amount is 0 and cashier confirmed it
  const canSubmit     = !isZero || zeroConfirmed;

  // Reset zero-confirmation whenever the amount changes
  function handleBalanceChange(e) {
    setBalance(e.target.value);
    setZeroConfirmed(false);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-success" />

        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-5">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-success/25 bg-success/10">
                <Timer className="h-5 w-5 text-success" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold text-foreground leading-tight">
                  Open Shift
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  Count your drawer and start accepting sales.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Opening Float
                <span className="ml-1 text-destructive">*</span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                  ₦
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={balance}
                  onChange={handleBalanceChange}
                  className="pl-7 tabular-nums font-mono"
                  autoFocus
                />
              </div>
              {parsedBalance > 0 && (
                <p className="mt-1.5 text-[11px] font-semibold text-success">
                  Opening float: {formatCurrency(parsedBalance)}
                </p>
              )}
              {isZero && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Enter the cash in the drawer, or leave at ₦0 for card/transfer-only shifts.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Notes{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                placeholder="Any notes for this shift…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Zero-float confirmation — shown only when amount is ₦0 */}
            {isZero && (
              <button
                type="button"
                onClick={() => setZeroConfirmed((v) => !v)}
                className={cn(
                  "w-full flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors cursor-pointer",
                  zeroConfirmed
                    ? "border-warning/40 bg-warning/8"
                    : "border-border bg-muted/30 hover:bg-muted/50",
                )}
              >
                {/* Custom checkbox */}
                <div className={cn(
                  "mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                  zeroConfirmed
                    ? "border-warning bg-warning/20"
                    : "border-border bg-background",
                )}>
                  {zeroConfirmed && (
                    <svg className="h-2.5 w-2.5 text-warning" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
                    <span className="text-[11px] font-bold text-warning">
                      Opening with no float
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    No cash in the drawer. This is fine for card/transfer-only shifts.
                    Confirm to proceed.
                  </p>
                </div>
              </button>
            )}

            {mutation.error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {String(mutation.error)}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => onOpenChange(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="success"
                disabled={mutation.isPending || !canSubmit}
                className="flex-1"
              >
                {mutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Opening…</>
                ) : (
                  <><Banknote className="h-4 w-4" /> Open Shift</>
                )}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
