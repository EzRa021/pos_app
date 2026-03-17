// ============================================================================
// features/purchase_orders/PurchaseOrderDetailPanel.jsx
// PO detail, workflow actions, and receive-goods modal (updates item stock)
// ============================================================================
import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Package, Truck, ChevronLeft, AlertTriangle, CheckCircle2,
  Clock, Ban, ArrowUpRight, Edit3, Send, ThumbsUp, ThumbsDown,
  ReceiptText, ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";

import { usePurchaseOrder } from "./usePurchaseOrders";
import { PageHeader }    from "@/components/shared/PageHeader";
import { Spinner }       from "@/components/shared/Spinner";
import { EmptyState }    from "@/components/shared/EmptyState";
import { Button }        from "@/components/ui/button";
import { Input }         from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }            from "@/lib/utils";
import { formatCurrency, formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import { usePermission } from "@/hooks/usePermission";

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending:   { cls: "bg-warning/10 text-warning border-warning/20",             label: "Pending",   icon: Clock        },
  approved:  { cls: "bg-primary/10 text-primary border-primary/20",             label: "Approved",  icon: CheckCircle2 },
  received:  { cls: "bg-success/10 text-success border-success/20",             label: "Received",  icon: CheckCircle2 },
  cancelled: { cls: "bg-muted/50 text-muted-foreground border-border/60",       label: "Cancelled", icon: Ban          },
  rejected:  { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Rejected",  icon: Ban          },
  draft:     { cls: "bg-muted/50 text-muted-foreground border-border/60",       label: "Draft",     icon: Edit3        },
};

function POStatusBadge({ status }) {
  const s = STATUS_CFG[status] ?? STATUS_CFG.pending;
  const Icon = s.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase",
      s.cls,
    )}>
      <Icon className="h-3 w-3" />{s.label}
    </span>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, className, action }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono = false, valueClass }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs font-medium text-right break-all", mono && "font-mono tabular-nums", valueClass)}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function StatCard({ label, value, sub, accent = "default" }) {
  const ring = {
    default: "border-border/60   bg-card",
    primary: "border-primary/25  bg-primary/[0.06]",
    success: "border-success/25  bg-success/[0.06]",
    warning: "border-warning/25  bg-warning/[0.06]",
    muted:   "border-border/60   bg-muted/30",
  }[accent];
  const val = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    muted:   "text-muted-foreground",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── Receive Goods Modal ───────────────────────────────────────────────────────

function ReceiveGoodsModal({ open, onOpenChange, poItems, onConfirm }) {
  const [quantities, setQuantities] = useState({});
  const [notes,      setNotes]      = useState("");
  const [saving,     setSaving]     = useState(false);

  // Reset when opened
  const handleOpenChange = (val) => {
    if (val) {
      const init = {};
      poItems.forEach((item) => {
        init[item.id] = String(parseFloat(item.quantity_ordered));
      });
      setQuantities(init);
      setNotes("");
    }
    if (!val) setSaving(false);
    onOpenChange(val);
  };

  const handleConfirm = async () => {
    const items = poItems.map((item) => ({
      po_item_id:        item.id,
      quantity_received: parseFloat(quantities[item.id] ?? 0),
    }));

    const invalid = items.find((i) => !(i.quantity_received >= 0));
    if (invalid) { toast.error("All quantities must be 0 or more."); return; }

    setSaving(true);
    try {
      await onConfirm({ items, notes: notes.trim() || undefined });
      toast.success("Goods received. Stock has been updated.");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Failed to receive goods.");
    } finally {
      setSaving(false);
    }
  };

  const grandTotal = poItems.reduce((s, item) => {
    const qty  = parseFloat(quantities[item.id] ?? 0) || 0;
    const cost = parseFloat(item.unit_cost);
    return s + qty * cost;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-success" />
        <div className="px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-success/25 bg-success/10">
              <Package className="h-5 w-5 text-success" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Receive Goods</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Enter the actual quantities received. Stock will be updated automatically.
              </DialogDescription>
            </div>
          </div>

          {/* Info banner */}
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <p className="text-[11px] text-primary leading-relaxed">
              Receiving goods will mark this PO as <strong>received</strong> and add the quantities to your stock.
              This action cannot be undone.
            </p>
          </div>

          {/* Item quantities */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_100px_100px] gap-2 px-1 pb-1 border-b border-border/40">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Item</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Ordered</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Received</span>
            </div>

            {poItems.map((item) => {
              const received = parseFloat(quantities[item.id] ?? 0) || 0;
              const ordered  = parseFloat(item.quantity_ordered);
              const short    = received < ordered;
              return (
                <div key={item.id} className="grid grid-cols-[1fr_100px_100px] gap-2 items-center py-1.5 border-b border-border/30 last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{item.item_name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{item.sku}</p>
                  </div>
                  <div className="text-center">
                    <span className="text-xs font-mono text-muted-foreground">{ordered}</span>
                  </div>
                  <div>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={quantities[item.id] ?? ""}
                      onChange={(e) =>
                        setQuantities((p) => ({ ...p, [item.id]: e.target.value }))
                      }
                      className={cn(
                        "h-7 text-center text-xs",
                        short && "border-warning/40 bg-warning/5",
                      )}
                    />
                    {short && (
                      <p className="text-[9px] text-warning text-center mt-0.5">short</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total */}
          <div className="mt-3 flex justify-between items-center pt-3 border-t border-border">
            <span className="text-xs text-muted-foreground">Total received value</span>
            <span className="text-sm font-bold font-mono tabular-nums text-foreground">
              {formatCurrency(grandTotal)}
            </span>
          </div>

          {/* Notes */}
          <div className="mt-3">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. 3 units damaged, partial delivery…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" className="bg-success hover:bg-success/90 text-white flex-1" onClick={handleConfirm} disabled={saving}>
            {saving ? "Receiving…" : "Confirm Receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reject Modal ──────────────────────────────────────────────────────────────

function RejectModal({ open, onOpenChange, poNumber, onConfirm }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirm(reason.trim() || undefined);
      toast.success("Purchase order rejected.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Failed to reject.");
    } finally {
      setSaving(false);
      setReason("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setReason(""); onOpenChange(v); }}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
              <ThumbsDown className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">Reject PO?</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">{poNumber}</DialogDescription>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Reason (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why is this order being rejected?"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" className="flex-1" onClick={handleConfirm} disabled={saving}>
            {saving ? "Rejecting…" : "Reject Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function PurchaseOrderDetailPanel() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const poId     = parseInt(id, 10);

  const canUpdate  = usePermission("purchase_orders.update");
  const canReceive = usePermission("purchase_orders.receive");

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [rejectOpen,  setRejectOpen]  = useState(false);

  const { order, items, isLoading, error, receive, cancel, submit, approve, reject, remove } =
    usePurchaseOrder(poId);

  if (isLoading) return <Spinner />;
  if (error || !order) return (
    <div className="flex flex-1 items-center justify-center gap-3">
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <span className="text-sm text-destructive">{error?.message ?? "Purchase order not found."}</span>
    </div>
  );

  const status       = order.status;
  const isDraft      = status === "draft";
  const isPending    = status === "pending";
  const isApproved   = status === "approved";
  const isReceived   = status === "received";
  const isClosed     = isReceived || status === "cancelled" || status === "rejected";
  const canReceiveNow = canReceive && (isPending || isApproved) && !isReceived;

  const totalOrdered  = items.reduce((s, i) => s + parseFloat(i.quantity_ordered),           0);
  const totalReceived = items.reduce((s, i) => s + parseFloat(i.quantity_received ?? 0),     0);
  const totalValue    = parseFloat(order.total_amount ?? 0);

  const handleCancel = async () => {
    if (!window.confirm("Cancel this purchase order?")) return;
    try {
      await cancel.mutateAsync();
      toast.success("Purchase order cancelled.");
    } catch (err) {
      toast.error(err?.message ?? "Failed to cancel.");
    }
  };

  const handleSubmit = async () => {
    try {
      await submit.mutateAsync();
      toast.success("Purchase order submitted for approval.");
    } catch (err) {
      toast.error(err?.message ?? "Failed to submit.");
    }
  };

  const handleApprove = async () => {
    try {
      await approve.mutateAsync();
      toast.success("Purchase order approved.");
    } catch (err) {
      toast.error(err?.message ?? "Failed to approve.");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this draft purchase order permanently?")) return;
    try {
      await remove.mutateAsync();
      toast.success("Purchase order deleted.");
      navigate("/purchase-orders");
    } catch (err) {
      toast.error(err?.message ?? "Failed to delete.");
    }
  };

  return (
    <>
      <PageHeader
        title={order.po_number}
        description={
          <span className="flex items-center gap-2">
            <POStatusBadge status={status} />
            {order.supplier_name && (
              <Link
                to={`/suppliers/${order.supplier_id}`}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Truck className="h-3 w-3" />
                {order.supplier_name}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            {/* Draft → Submit */}
            {canUpdate && isDraft && (
              <>
                <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={handleDelete} disabled={remove.isPending}>
                  Delete Draft
                </Button>
                <Button size="sm" onClick={handleSubmit} disabled={submit.isPending}>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Submit for Approval
                </Button>
              </>
            )}
            {/* Pending → Approve / Reject */}
            {canUpdate && isPending && (
              <>
                <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => setRejectOpen(true)}>
                  <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                  Reject
                </Button>
                <Button size="sm" className="bg-success hover:bg-success/90 text-white"
                  onClick={handleApprove} disabled={approve.isPending}>
                  <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                  Approve
                </Button>
              </>
            )}
            {/* Approved / Pending → Receive */}
            {canReceiveNow && (
              <Button size="sm" className="bg-success hover:bg-success/90 text-white"
                onClick={() => setReceiveOpen(true)}>
                <Package className="h-3.5 w-3.5 mr-1.5" />
                Receive Goods
              </Button>
            )}
            {/* Cancel (non-received) */}
            {canUpdate && !isClosed && !isDraft && (
              <Button variant="outline" size="sm" className="text-warning border-warning/30 hover:bg-warning/10"
                onClick={handleCancel} disabled={cancel.isPending}>
                <Ban className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
            )}
          </div>
        }
      >
        <Link to="/purchase-orders"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-3 w-3" />
          Back to Purchase Orders
        </Link>
      </PageHeader>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* KPI row */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Value"    value={formatCurrency(totalValue)} sub={`${items.length} line item${items.length !== 1 ? "s" : ""}`} accent="primary" />
            <StatCard label="Qty Ordered"    value={totalOrdered}               sub="total units"               accent="default" />
            <StatCard label="Qty Received"   value={totalReceived}
              sub={isReceived ? "fully received" : "awaiting delivery"}
              accent={isReceived ? "success" : totalReceived > 0 ? "warning" : "muted"}
            />
            <StatCard label="Status"         value={STATUS_CFG[status]?.label ?? status}
              sub={order.received_at ? `Received ${formatDate(order.received_at)}` : `Ordered ${formatDate(order.ordered_at)}`}
              accent={status === "received" ? "success" : status === "pending" || status === "approved" ? "warning" : "muted"}
            />
          </div>

          <div className="grid grid-cols-3 gap-5">
            {/* Left — PO Info */}
            <div className="space-y-5">
              <Section title="Order Info" icon={ReceiptText}>
                <Row label="PO Number"  value={order.po_number} mono />
                <Row label="Status"     value={<POStatusBadge status={status} />} />
                <Row label="Supplier"   value={
                  <Link to={`/suppliers/${order.supplier_id}`}
                    className="text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}>
                    {order.supplier_name} <ArrowUpRight className="h-3 w-3" />
                  </Link>
                } />
                <Row label="Ordered"    value={formatDateTime(order.ordered_at)} />
                {order.received_at && (
                  <Row label="Received"  value={formatDateTime(order.received_at)} valueClass="text-success" />
                )}
                {order.notes && <Row label="Notes"     value={order.notes} />}
              </Section>

              <Section title="Financial" icon={ShoppingCart}>
                <Row label="Subtotal"  value={formatCurrency(parseFloat(order.subtotal     ?? 0))} mono />
                <Row label="Tax"       value={formatCurrency(parseFloat(order.tax_amount   ?? 0))} mono />
                <Row label="Shipping"  value={formatCurrency(parseFloat(order.shipping_cost ?? 0))} mono />
                <div className="flex items-center justify-between pt-2 border-t border-border mt-1">
                  <span className="text-xs font-semibold text-foreground">Total</span>
                  <span className="text-sm font-bold font-mono text-primary tabular-nums">
                    {formatCurrency(totalValue)}
                  </span>
                </div>
              </Section>
            </div>

            {/* Right — Line Items */}
            <div className="col-span-2">
              <Section
                title="Items"
                icon={Package}
                action={
                  isReceived ? (
                    <span className="flex items-center gap-1 text-[10px] text-success font-semibold">
                      <CheckCircle2 className="h-3 w-3" />
                      Received
                    </span>
                  ) : canReceiveNow ? (
                    <Button size="xs" className="h-6 px-2.5 text-[10px] bg-success hover:bg-success/90 text-white"
                      onClick={() => setReceiveOpen(true)}>
                      <Package className="h-3 w-3 mr-1" />
                      Receive
                    </Button>
                  ) : null
                }
              >
                {items.length === 0 ? (
                  <EmptyState icon={Package} title="No items" description="This purchase order has no line items." />
                ) : (
                  <div className="space-y-0">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_80px_80px_100px_90px] gap-2 px-1 pb-2 border-b border-border/40">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Item</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Ordered</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Received</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Unit Cost</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Total</span>
                    </div>

                    {items.map((item) => {
                      const ordered  = parseFloat(item.quantity_ordered);
                      const received = parseFloat(item.quantity_received ?? 0);
                      const isShort  = isReceived && received < ordered;
                      const isFullRx = isReceived && received >= ordered;
                      return (
                        <div key={item.id}
                          className="grid grid-cols-[1fr_80px_80px_100px_90px] gap-2 items-center py-3 border-b border-border/30 last:border-0">
                          <div className="min-w-0 flex items-center gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-primary/20 bg-primary/8 text-[9px] font-bold text-primary uppercase">
                              {(item.item_name ?? "").slice(0, 2)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">{item.item_name}</p>
                              <p className="text-[10px] font-mono text-muted-foreground">{item.sku}</p>
                            </div>
                          </div>
                          <div className="text-center">
                            <span className="text-xs font-mono text-foreground">{formatQuantity(ordered, item.measurement_type, item.unit_type)}</span>
                          </div>
                          <div className="text-center">
                            {isReceived ? (
                              <span className={cn(
                                "text-xs font-mono font-semibold",
                                isFullRx ? "text-success" : isShort ? "text-warning" : "text-muted-foreground",
                              )}>
                                {formatQuantity(received, item.measurement_type, item.unit_type)}
                                {isShort && <span className="text-[9px] text-warning ml-0.5">▼</span>}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">—</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-mono text-muted-foreground">
                              {formatCurrency(parseFloat(item.unit_cost))}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-mono font-semibold text-foreground">
                              {formatCurrency(parseFloat(item.line_total))}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Total row */}
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <span className="text-xs font-semibold text-foreground">Order Total</span>
                      <span className="text-sm font-bold font-mono tabular-nums text-primary">
                        {formatCurrency(totalValue)}
                      </span>
                    </div>
                  </div>
                )}
              </Section>
            </div>
          </div>

        </div>
      </div>

      {/* Receive Goods Modal */}
      <ReceiveGoodsModal
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        poItems={items}
        onConfirm={({ items: rxItems, notes }) => receive.mutateAsync({ items: rxItems, notes })}
      />

      {/* Reject Modal */}
      <RejectModal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        poNumber={order.po_number}
        onConfirm={(reason) => reject.mutateAsync(reason)}
      />
    </>
  );
}
