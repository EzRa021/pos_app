// ============================================================================
// features/pos/HoldDrawer.jsx — Held transactions side panel
// ============================================================================
// Opened when the cashier clicks "Hold" on a non-empty cart or the
// "Held (N)" indicator. Shows all held transactions for this store/shift.
// Recalling a transaction restores it to the cart.
// ============================================================================

import { useState } from "react";
import { Clock, ShoppingCart, Trash2, RotateCcw, User, Package } from "lucide-react";

import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export function HoldDrawer({
  open,
  onOpenChange,
  heldTransactions,
  onHoldCurrent,    // () => Promise<void> — saves current cart to hold
  onRecall,         // (id: number) => Promise<void>
  onDelete,         // (id: number) => Promise<void>
  cartIsEmpty,
  isHolding,
}) {
  const [deletingId,  setDeletingId]  = useState(null);
  const [recallingId, setRecallingId] = useState(null);

  async function handleRecall(id) {
    setRecallingId(id);
    try { await onRecall(id); onOpenChange(false); }
    finally { setRecallingId(null); }
  }

  async function handleDelete(id) {
    setDeletingId(id);
    try { await onDelete(id); }
    finally { setDeletingId(null); }
  }

  async function handleHoldCurrent() {
    try { await onHoldCurrent(); onOpenChange(false); }
    catch { /* error shown via toast in parent */ }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[400px] sm:max-w-[400px] bg-card border-border/60 p-0 flex flex-col gap-0"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-warning/25 bg-warning/10">
            <Clock className="h-4 w-4 text-warning" />
          </div>
          <div className="flex-1">
            <SheetTitle className="text-sm font-bold leading-tight">Held Transactions</SheetTitle>
            <SheetDescription className="text-[11px] mt-0.5">
              {heldTransactions.length === 0
                ? "No transactions on hold"
                : `${heldTransactions.length} transaction${heldTransactions.length > 1 ? "s" : ""} waiting`}
            </SheetDescription>
          </div>
          {heldTransactions.length > 0 && (
            <Badge variant="outline" className="border-warning/30 text-warning text-[10px]">
              {heldTransactions.length}
            </Badge>
          )}
        </div>

        {/* Hold current cart — shown when cart is not empty */}
        {!cartIsEmpty && (
          <div className="px-5 py-3 border-b border-border bg-muted/10">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-9 gap-2 text-[12px] border-warning/30 text-warning hover:bg-warning/10 hover:border-warning"
              disabled={isHolding}
              onClick={handleHoldCurrent}
            >
              {isHolding ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-warning border-t-transparent" />
              ) : (
                <Clock className="h-3.5 w-3.5" />
              )}
              Put Current Cart on Hold
            </Button>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-auto">
          {heldTransactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16 px-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted/10">
                <Clock className="h-7 w-7 text-muted-foreground/20" />
              </div>
              <div>
                <p className="text-sm font-semibold text-muted-foreground">No held transactions</p>
                <p className="text-[11px] text-muted-foreground/50 mt-1">
                  Put a cart on hold to continue it later
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {heldTransactions.map((held) => {
                const cartData =
                  held.cart_data && typeof held.cart_data === "object"
                    ? held.cart_data
                    : (() => { try { return JSON.parse(held.cart_data ?? "{}"); } catch { return {}; } })();

                const items   = Array.isArray(cartData.items) ? cartData.items : [];
                const customer = cartData.customer ?? null;
                const note     = cartData.note ?? held.label ?? "";
                const itemCount = items.reduce((s, i) => s + (i.quantity ?? 0), 0);

                // Estimate subtotal for display
                const estTotal = items.reduce(
                  (s, i) => s + i.price * i.quantity - (i.discount ?? 0), 0
                );

                const isRecalling = recallingId === held.id;
                const isDeleting  = deletingId  === held.id;

                return (
                  <div
                    key={held.id}
                    className="px-5 py-4 hover:bg-muted/20 transition-colors"
                  >
                    {/* Label / note */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-foreground truncate">
                          {note || `Hold #${held.id}`}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {formatDateTime(held.created_at)}
                        </p>
                      </div>
                      <span className="text-[12px] font-bold text-foreground tabular-nums font-mono shrink-0">
                        {formatCurrency(estTotal)}
                      </span>
                    </div>

                    {/* Customer + item meta */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <User className="h-2.5 w-2.5" />
                        {customer
                          ? [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.name || "Customer"
                          : "Walk-in"}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Package className="h-2.5 w-2.5" />
                        {items.length} item{items.length !== 1 ? "s" : ""}
                        {itemCount !== items.length && ` (${itemCount} qty)`}
                      </span>
                    </div>

                    {/* Item preview */}
                    {items.length > 0 && (
                      <div className="mb-3 rounded-lg bg-muted/20 px-3 py-2 space-y-0.5">
                        {items.slice(0, 3).map((item, i) => (
                          <div key={i} className="flex items-center justify-between text-[10px]">
                            <span className="text-muted-foreground truncate max-w-[200px]">
                              {item.quantity}× {item.name}
                            </span>
                            <span className="text-muted-foreground font-mono tabular-nums">
                              {formatCurrency(item.price * item.quantity)}
                            </span>
                          </div>
                        ))}
                        {items.length > 3 && (
                          <p className="text-[10px] text-muted-foreground/50 text-right">
                            +{items.length - 3} more…
                          </p>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 gap-1.5 text-[11px] border-primary/30 text-primary hover:bg-primary/10 hover:border-primary"
                        disabled={isRecalling || isDeleting}
                        onClick={() => handleRecall(held.id)}
                      >
                        {isRecalling ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        Recall to Cart
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive/40 hover:text-destructive hover:bg-destructive/10"
                        disabled={isDeleting || isRecalling}
                        onClick={() => handleDelete(held.id)}
                        title="Delete this hold"
                      >
                        {isDeleting ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-destructive border-t-transparent" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[12px]"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
