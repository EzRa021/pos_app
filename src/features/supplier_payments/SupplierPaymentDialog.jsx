// features/supplier_payments/SupplierPaymentDialog.jsx
import { useState } from "react";
import { Loader2, Banknote, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const PAYMENT_METHODS = [
  { value: "cash",     label: "Cash"          },
  { value: "transfer", label: "Bank Transfer" },
  { value: "cheque",   label: "Cheque"        },
  { value: "card",     label: "Card"          },
];

export function SupplierPaymentDialog({ open, onOpenChange, supplier, onRecord }) {
  const [amount,    setAmount]    = useState("");
  const [method,    setMethod]    = useState("cash");
  const [reference, setReference] = useState("");
  const [notes,     setNotes]     = useState("");
  const [busy,      setBusy]      = useState(false);

  const handleSave = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { toast.error("Enter a valid payment amount."); return; }
    setBusy(true);
    try {
      await onRecord({ amount: amt, payment_method: method, reference: reference || undefined, notes: notes || undefined });
      toast.success("Supplier payment recorded.");
      setAmount(""); setMethod("cash"); setReference(""); setNotes("");
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
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Banknote className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Record Payment</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {supplier?.supplier_name ?? "Supplier"}
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
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Payment Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Reference</label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="Cheque no. or bank reference" className="h-8 text-sm" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy} className="gap-1.5">
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : <><Plus className="h-3.5 w-3.5" />Record</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
