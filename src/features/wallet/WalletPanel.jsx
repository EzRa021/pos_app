// features/wallet/WalletPanel.jsx — Wallet balance + deposit + adjust
import { useState } from "react";
import { Wallet, Plus, SlidersHorizontal, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useWalletBalance, useWalletActions } from "./useWallet";
import { formatCurrency } from "@/lib/format";

// ── Deposit Dialog ────────────────────────────────────────────────────────────
function DepositDialog({ open, onOpenChange, customerId, onDeposit }) {
  const [amount,    setAmount]    = useState("");
  const [reference, setReference] = useState("");
  const [notes,     setNotes]     = useState("");
  const [busy,      setBusy]      = useState(false);

  const handleSave = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { toast.error("Enter a valid amount."); return; }
    setBusy(true);
    try {
      await onDeposit({ amount: amt, reference: reference || undefined, notes: notes || undefined });
      toast.success(`${formatCurrency(amt)} deposited to wallet.`);
      setAmount(""); setReference(""); setNotes("");
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
        <div className="h-[3px] w-full bg-success" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-success/25 bg-success/10">
              <Plus className="h-5 w-5 text-success" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Deposit to Wallet</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Add advance payment to customer wallet
              </DialogDescription>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Amount (₦) *</label>
            <Input type="number" min="0" step="100" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00" className="h-8 text-sm" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Reference</label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt or payment reference" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy} className="bg-success hover:bg-success/90 text-white gap-1.5">
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : <><Plus className="h-3.5 w-3.5" />Deposit</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Adjust Dialog ─────────────────────────────────────────────────────────────
function AdjustDialog({ open, onOpenChange, onAdjust }) {
  const [amount, setAmount] = useState("");
  const [notes,  setNotes]  = useState("");
  const [busy,   setBusy]   = useState(false);

  const handleSave = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt === 0) { toast.error("Enter a non-zero adjustment amount."); return; }
    setBusy(true);
    try {
      await onAdjust({ amount: amt, notes: notes || undefined });
      toast.success(`Wallet adjusted by ${formatCurrency(Math.abs(amt))}.`);
      setAmount(""); setNotes("");
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
              <DialogTitle className="text-base font-semibold">Adjust Wallet Balance</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Use positive values to add, negative to deduct
              </DialogDescription>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Adjustment (₦)</label>
            <Input type="number" step="100" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500 or -200" className="h-8 text-sm" autoFocus />
            <p className="text-[11px] text-muted-foreground">Positive = add, Negative = deduct</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Reason *</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for adjustment" className="h-8 text-sm" />
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

// ── WalletPanel ───────────────────────────────────────────────────────────────
export function WalletPanel({ customerId, canManage = true }) {
  const [depositOpen, setDepositOpen] = useState(false);
  const [adjustOpen,  setAdjustOpen]  = useState(false);

  const { balance, isLoading, error } = useWalletBalance(customerId);
  const { deposit, adjust }           = useWalletActions(customerId);

  if (isLoading) return (
    <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading wallet…
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-1.5 text-xs text-destructive py-2">
      <AlertCircle className="h-3.5 w-3.5" /> {String(error)}
    </div>
  );

  const bal           = parseFloat(balance?.balance          ?? 0);
  const totalDeposited = parseFloat(balance?.total_deposited ?? 0);
  const totalSpent    = parseFloat(balance?.total_spent      ?? 0);

  return (
    <>
      <div className="space-y-3">
        {/* Balance hero */}
        <div className={cn(
          "rounded-xl border-2 px-5 py-4",
          bal > 0 ? "border-success/30 bg-success/5" : "border-border bg-muted/10",
        )}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Balance</p>
              <p className={cn("text-2xl font-bold tabular-nums mt-1", bal > 0 ? "text-success" : "text-muted-foreground")}>
                {formatCurrency(bal)}
              </p>
              <div className="flex items-center gap-4 mt-1.5">
                <span className="text-[11px] text-muted-foreground">
                  Deposited: <span className="font-semibold text-foreground">{formatCurrency(totalDeposited)}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Spent: <span className="font-semibold text-foreground">{formatCurrency(totalSpent)}</span>
                </span>
              </div>
            </div>
            <Wallet className={cn("h-8 w-8 shrink-0", bal > 0 ? "text-success/40" : "text-muted-foreground/20")} />
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setDepositOpen(true)} className="gap-1.5 bg-success hover:bg-success/90 text-white">
              <Plus className="h-3.5 w-3.5" />Deposit
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)} className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />Adjust
            </Button>
          </div>
        )}
      </div>

      <DepositDialog
        open={depositOpen}
        onOpenChange={setDepositOpen}
        customerId={customerId}
        onDeposit={(p) => deposit.mutateAsync(p)}
      />
      <AdjustDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        onAdjust={(p) => adjust.mutateAsync(p)}
      />
    </>
  );
}
