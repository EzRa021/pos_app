// ============================================================================
// features/shifts/CloseShiftModal.jsx
// ============================================================================
// ShiftSummary fields from backend (mirrors quantum-pos-app getCashDrawerStatus):
//   shift_id, opening_float, total_sales, total_returns,
//   total_deposits, total_withdrawals, total_payouts, expected_balance
// Shift fields used: opening_float, actual_cash, cash_difference
// ============================================================================

import { useState }              from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { XCircle, Loader2, AlertTriangle, Hash } from "lucide-react";

import {
  Dialog, DialogContent,
  DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";

import { useShiftStore }  from "@/stores/shift.store";
import { getShiftSummary } from "@/commands/cash_movements";
import { queryClient }    from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { cn }             from "@/lib/utils";

function StatRow({ label, value, valueClass, borderTop }) {
  return (
    <div className={cn(
      "flex items-center justify-between py-1.5",
      borderTop && "border-t border-border/50 mt-0.5 pt-2"
    )}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-semibold tabular-nums font-mono", valueClass ?? "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

// Compute shift number (must match useShift.js logic)
function computeShiftNumber(shift) {
  if (!shift) return "—";
  const date = new Date(shift.opened_at).toISOString().slice(0, 10).replace(/-/g, "");
  return `SH-${date}-${String(shift.id).padStart(3, "0")}`;
}

export function CloseShiftModal({ open, onOpenChange }) {
  const [closingBalance, setClosingBalance] = useState("");
  const [notes,          setNotes]          = useState("");

  const activeShift  = useShiftStore((s) => s.activeShift);
  const closeShiftFn = useShiftStore((s) => s.closeShift);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["shift-summary", activeShift?.id],
    queryFn:  () => getShiftSummary(activeShift.id),
    enabled:  open && !!activeShift?.id,
    staleTime: 0,
  });

  const closingNum      = parseFloat(closingBalance) || 0;
  const expectedBalance = parseFloat(summary?.expected_balance ?? "0");
  const variance        = closingNum - expectedBalance;
  const hasClosing      = closingBalance !== "";

  const totalSales       = parseFloat(summary?.total_sales       ?? "0");
  const totalRefunds     = parseFloat(summary?.total_returns     ?? "0");
  const totalDeposits    = parseFloat(summary?.total_deposits    ?? "0");
  const totalWithdrawals = parseFloat(summary?.total_withdrawals ?? "0");
  const totalPayouts     = parseFloat(summary?.total_payouts     ?? "0");

  const mutation = useMutation({
    mutationFn: () =>
      closeShiftFn({ actualCash: closingNum, notes: notes.trim() }),
    onSuccess: () => {
      // Refresh history table and clear summary cache
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      queryClient.invalidateQueries({ queryKey: ["shift-summary"] });
      queryClient.invalidateQueries({ queryKey: ["cash-movements"] });
      setClosingBalance("");
      setNotes("");
      onOpenChange(false);
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    mutation.mutate();
  }

  const shiftNum = computeShiftNumber(activeShift);

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-destructive" />

        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-5">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-[15px] font-bold text-foreground leading-tight">
                  Close Shift
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  {shiftNum}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Shift summary ledger */}
          <div className="rounded-lg border border-border bg-background/60 px-4 py-3 mb-4">
            {summaryLoading ? (
              <div className="space-y-2.5 py-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-3 w-24 rounded skeleton-shimmer" />
                    <div className="h-3 w-16 rounded skeleton-shimmer" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                <StatRow
                  label="Opening Balance"
                  value={formatCurrency(parseFloat(activeShift?.opening_float ?? "0"))}
                />
                <StatRow
                  label="Total Sales"
                  value={formatCurrency(totalSales)}
                  valueClass="text-success"
                />
                {totalRefunds > 0 && (
                  <StatRow
                    label="Refunds"
                    value={`− ${formatCurrency(totalRefunds)}`}
                    valueClass="text-destructive"
                  />
                )}
                {totalDeposits > 0 && (
                  <StatRow
                    label="Cash In (Deposits)"
                    value={`+ ${formatCurrency(totalDeposits)}`}
                    valueClass="text-success"
                  />
                )}
                {totalWithdrawals > 0 && (
                  <StatRow
                    label="Cash Out (Withdrawals)"
                    value={`− ${formatCurrency(totalWithdrawals)}`}
                    valueClass="text-destructive"
                  />
                )}
                {totalPayouts > 0 && (
                  <StatRow
                    label="Payouts"
                    value={`− ${formatCurrency(totalPayouts)}`}
                    valueClass="text-destructive"
                  />
                )}
              </div>
            )}
          </div>

          {/* Expected balance highlight */}
          {!summaryLoading && (
            <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 mb-4">
              <span className="text-xs font-semibold text-foreground">Expected in Drawer</span>
              <span className="text-sm font-bold tabular-nums font-mono text-primary">
                {formatCurrency(expectedBalance)}
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Actual Cash Counted
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
                  value={closingBalance}
                  onChange={(e) => setClosingBalance(e.target.value)}
                  className="pl-7 tabular-nums font-mono"
                  autoFocus
                />
              </div>
            </div>

            {/* Live variance */}
            {hasClosing && !summaryLoading && (
              <div className={cn(
                "flex items-center justify-between rounded-lg border px-4 py-2.5",
                variance >= 0
                  ? "border-success/25 bg-success/8"
                  : "border-destructive/25 bg-destructive/8"
              )}>
                <div className="flex items-center gap-2">
                  {variance < 0 && (
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-foreground">
                    {variance >= 0 ? "Over" : "Short"} by
                  </span>
                </div>
                <span className={cn(
                  "text-sm font-bold tabular-nums font-mono",
                  variance >= 0 ? "text-success" : "text-destructive"
                )}>
                  {variance >= 0 ? "+" : ""}{formatCurrency(variance)}
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Notes{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                placeholder="Any notes about this shift…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
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
                variant="destructive"
                disabled={mutation.isPending || !hasClosing}
                className="flex-1"
              >
                {mutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Closing…</>
                ) : (
                  "Close Shift"
                )}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
