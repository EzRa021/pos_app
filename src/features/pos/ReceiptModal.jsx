// ============================================================================
// features/pos/ReceiptModal.jsx — Post-charge success screen
// ============================================================================
// Shown after a successful create_transaction call.
//
// Print flow:
//   1. On open: if receipt_settings.auto_print === true, print automatically.
//   2. On "Print" click: call generate_receipt_html(transactionId) on the
//      backend → backend builds full styled HTML (with QR, logo, settings)
//      → frontend injects into hidden <iframe> → triggers window.print()
//      scoped to that frame only → iframe removed after dialog closes.
//
// This is the correct architecture: backend owns the HTML, frontend triggers
// the print dialog only.
// ============================================================================

import { useEffect } from "react";
import { toast }     from "sonner";
import {
  CheckCircle2, Printer, ShoppingBag, Loader2, AlertCircle,
} from "lucide-react";

import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
import { Button }    from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { usePrintReceipt }          from "@/hooks/usePrintReceipt";
import { getReceiptSettings }        from "@/commands/receipts";
import { formatCurrency, formatDateTime, formatRef } from "@/lib/format";
import { PAYMENT_METHOD_LABELS }    from "@/lib/constants";
import { useBranchStore }           from "@/stores/branch.store";
import { useQuery }                 from "@tanstack/react-query";

export function ReceiptModal({ open, onClose, transaction, storeName }) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const { print, isPrinting, error: printError } = usePrintReceipt();

  // Load receipt settings to check auto_print flag
  const { data: receiptSettings } = useQuery({
    queryKey: ["receipt-settings", storeId],
    queryFn:  () => getReceiptSettings(storeId),
    enabled:  !!storeId,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  const tx    = transaction?.transaction ?? transaction;
  const items = transaction?.items ?? [];

  const transactionId = tx?.id;
  const autoPrint     = receiptSettings?.auto_print === true;

  // ── Auto-print on successful transaction ───────────────────────────────────
  useEffect(() => {
    if (open && autoPrint && transactionId && !isPrinting) {
      print(transactionId).catch(() => {
        toast.error("Auto-print failed. Click Print to try again.");
      });
    }
    // Only fire when the modal first opens for this transaction
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transactionId, autoPrint]);

  // ── Print handler ──────────────────────────────────────────────────────────
  const handlePrint = async () => {
    if (!transactionId || isPrinting) return;
    try {
      await print(transactionId);
    } catch {
      toast.error("Print failed. Please try again.");
    }
  };

  if (!tx) return null;

  const payLabel = PAYMENT_METHOD_LABELS[tx.payment_method] ?? tx.payment_method;
  const change   = tx.change_amount   ? parseFloat(tx.change_amount)   : 0;
  const tendered = tx.amount_tendered ? parseFloat(tx.amount_tendered) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm p-0 overflow-hidden bg-card border-border gap-0">

        {/* ── Success header ───────────────────────────────────────────── */}
        <div className="bg-success/10 border-b border-success/20 px-6 pt-6 pb-5 text-center">
          <div className="flex justify-center mb-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/20 border border-success/30">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
          </div>
          <p className="text-base font-bold text-foreground">Sale Complete!</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {formatDateTime(tx.created_at)}
          </p>
          <div className="mt-2 inline-flex items-center rounded-full border border-border bg-background/60 px-3 py-1">
            <span className="text-[11px] font-mono font-bold text-foreground tracking-wider">
              {formatRef(tx.reference_no)}
            </span>
          </div>

          {/* Auto-print indicator */}
          {autoPrint && isPrinting && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Printing automatically…
            </div>
          )}
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="px-5 py-4 space-y-3">

          {/* Items */}
          <div className="rounded-lg border border-border/60 divide-y divide-border/40 overflow-hidden">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-3 py-2 text-[11px]">
                <span className="text-foreground font-medium truncate max-w-[180px]">
                  {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)}×{" "}
                  {item.item_name}
                </span>
                <span className="text-foreground font-semibold tabular-nums font-mono shrink-0 ml-2">
                  {formatCurrency(parseFloat(item.line_total))}
                </span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="rounded-lg border border-border/60 px-3 py-2 space-y-1 text-[11px]">
            {parseFloat(tx.discount_amount) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span className="text-success font-mono">
                  −{formatCurrency(parseFloat(tx.discount_amount))}
                </span>
              </div>
            )}
            {parseFloat(tx.tax_amount) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT</span>
                <span className="text-muted-foreground font-mono">
                  {formatCurrency(parseFloat(tx.tax_amount))}
                </span>
              </div>
            )}
            <Separator className="!my-1.5 bg-border/50" />
            <div className="flex justify-between text-[13px] font-bold">
              <span className="text-foreground">Total</span>
              <span className="text-foreground font-mono">
                {formatCurrency(parseFloat(tx.total_amount))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{payLabel}</span>
              <span className="text-foreground font-mono">{formatCurrency(tendered)}</span>
            </div>
            {change > 0.001 && (
              <div className="flex justify-between font-bold text-success">
                <span>Change</span>
                <span className="font-mono">{formatCurrency(change)}</span>
              </div>
            )}
          </div>

          {/* Customer + cashier */}
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex justify-between">
              <span>Customer</span>
              <span className="text-foreground">{tx.customer_name ?? "Walk-in"}</span>
            </div>
            <div className="flex justify-between">
              <span>Cashier</span>
              <span className="text-foreground">{tx.cashier_name ?? "—"}</span>
            </div>
            {storeName && (
              <div className="flex justify-between">
                <span>Store</span>
                <span className="text-foreground">{storeName}</span>
              </div>
            )}
          </div>

          {/* Print error */}
          {printError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {printError}
            </div>
          )}
        </div>

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div className="px-5 pb-5 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-[11px] min-w-[80px]"
            disabled={isPrinting}
            onClick={handlePrint}
          >
            {isPrinting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Printing…</>
            ) : (
              <><Printer className="h-3.5 w-3.5" /> Print</>
            )}
          </Button>
          <Button
            variant="success"
            size="sm"
            className="flex-1 h-9 gap-1.5 text-[12px] font-bold"
            onClick={onClose}
          >
            <ShoppingBag className="h-4 w-4" />
            New Sale
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}
