// ============================================================================
// features/shifts/CashMovementModal.jsx
// ============================================================================
// CreateCashMovementDto: { shift_id, movement_type, amount, reason, reference? }
// movement_type: "deposit" | "withdrawal" | "payout" | "adjustment"
//   deposit    → cash added to drawer (float top-up, change fund)
//   withdrawal → cash removed from drawer (bank drop, safe deposit)
//   payout     → expense paid from drawer
// ============================================================================

import { useState }    from "react";
import { useMutation } from "@tanstack/react-query";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { ArrowDownLeft, ArrowUpRight, Loader2, DollarSign } from "lucide-react";

import {
  Dialog, DialogContent,
  DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";

import { useShiftStore }   from "@/stores/shift.store";
import { addCashMovement } from "@/commands/cash_movements";
import { queryClient }     from "@/lib/queryClient";
import { CASH_MOVEMENT_TYPES } from "@/lib/constants";
import { cn }              from "@/lib/utils";

const TYPES = [
  {
    key:      CASH_MOVEMENT_TYPES.DEPOSIT,
    label:    "Deposit",
    sublabel: "Add cash to drawer",
    icon:     ArrowDownLeft,
    activeBg: "bg-success/15 border-success/30 text-success",
    strip:    "bg-success",
    btnVariant: "success",
  },
  {
    key:      CASH_MOVEMENT_TYPES.WITHDRAWAL,
    label:    "Withdrawal",
    sublabel: "Remove cash from drawer",
    icon:     ArrowUpRight,
    activeBg: "bg-destructive/15 border-destructive/30 text-destructive",
    strip:    "bg-destructive",
    btnVariant: "destructive",
  },
  {
    key:      CASH_MOVEMENT_TYPES.PAYOUT,
    label:    "Payout",
    sublabel: "Pay expense from drawer",
    icon:     DollarSign,
    activeBg: "bg-warning/15 border-warning/30 text-warning",
    strip:    "bg-warning",
    btnVariant: "default",
  },
];

export function CashMovementModal({ open, onOpenChange }) {
  const [type,   setType]   = useState(CASH_MOVEMENT_TYPES.DEPOSIT);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const shiftId = useShiftStore((s) => s.activeShift?.id);
  const activeType = TYPES.find((t) => t.key === type);

  const mutation = useMutation({
    mutationFn: () =>
      addCashMovement({
        shift_id:      shiftId,
        movement_type: type,
        amount:        parseFloat(amount),
        reason:        reason.trim() || activeType.label,
      }),
    onSuccess: (_, __, ctx) => {
      const verb = type === "deposit" ? "added to" : "removed from";
      toastSuccess(
        `${activeType.label} Recorded`,
        `₦${Number(amount).toLocaleString()} ${verb} the drawer.`,
      );
      queryClient.invalidateQueries({ queryKey: ["cash-movements", shiftId] });
      queryClient.invalidateQueries({ queryKey: ["shift-summary", shiftId] });
      setAmount("");
      setReason("");
      onOpenChange(false);
    },
    onError: (e) => onMutationError("Cash Movement Failed", e),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className={cn("h-[3px] w-full transition-colors duration-200", activeType.strip)} />

        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-5">
            <DialogTitle className="text-[15px] font-bold text-foreground">
              Cash Movement
            </DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground">
              Record cash going into or out of the drawer.
            </DialogDescription>
          </DialogHeader>

          {/* Type toggle */}
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-background/70 border border-border mb-5">
            {TYPES.map((t) => {
              const Icon     = t.icon;
              const isActive = type === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setType(t.key)}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 px-2 rounded-md border text-center",
                    "transition-all duration-150 text-xs font-semibold",
                    isActive
                      ? t.activeBg
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon className={cn("h-4 w-4", isActive ? "" : "opacity-60")} />
                  {t.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Amount
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                  ₦
                </span>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-7 tabular-nums font-mono text-base"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Reason{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                placeholder={
                  type === CASH_MOVEMENT_TYPES.DEPOSIT
                    ? "e.g. Change fund top-up, float replenishment…"
                    : type === CASH_MOVEMENT_TYPES.WITHDRAWAL
                    ? "e.g. Bank deposit, safe drop…"
                    : "e.g. Supplier payment, cleaning supplies…"
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

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
                variant={activeType.btnVariant}
                disabled={mutation.isPending || !amount || parseFloat(amount) <= 0}
                className="flex-1"
              >
                {mutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                ) : (
                  `Record ${activeType.label}`
                )}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
