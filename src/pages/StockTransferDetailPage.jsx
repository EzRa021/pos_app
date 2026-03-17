// pages/StockTransferDetailPage.jsx
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeftRight, Send, PackageCheck, X, Loader2,
  Package, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader }  from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import { cn }          from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useStockTransfer } from "@/features/stock_transfers/useStockTransfers";
import { usePermission }    from "@/hooks/usePermission";
import { formatCurrency, formatDateTime } from "@/lib/format";

// ── Send Dialog ───────────────────────────────────────────────────────────────
function SendDialog({ open, onOpenChange, transfer, onSend }) {
  const [qtys, setQtys] = useState({});
  const [busy, setBusy] = useState(false);

  const handleOpen = (val) => {
    if (val) {
      const init = {};
      (transfer?.items ?? []).forEach((i) => { init[i.item_id] = i.qty_requested; });
      setQtys(init);
    }
    onOpenChange(val);
  };

  const handleSave = async () => {
    const items = (transfer?.items ?? []).map((i) => ({
      item_id: i.item_id,
      qty_sent: parseFloat(qtys[i.item_id] ?? i.qty_requested),
    }));
    setBusy(true);
    try {
      await onSend({ items });
      toast.success("Transfer dispatched.");
      handleOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Send className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Send Transfer</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">Confirm quantities dispatched</DialogDescription>
            </div>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px] gap-2 px-1 mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Item</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase text-right">Qty Sent</span>
            </div>
            {(transfer?.items ?? []).map((item) => (
              <div key={item.item_id} className="grid grid-cols-[1fr_80px] items-center gap-2">
                <span className="text-xs font-semibold truncate">{item.item_name}</span>
                <Input type="number" min="0" step="1"
                  value={qtys[item.item_id] ?? item.qty_requested}
                  onChange={(e) => setQtys((prev) => ({ ...prev, [item.item_id]: e.target.value }))}
                  className="h-7 text-xs text-right" />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy} className="gap-1.5">
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Sending…</> : <><Send className="h-3.5 w-3.5" />Dispatch</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Receive Dialog ────────────────────────────────────────────────────────────
function ReceiveDialog({ open, onOpenChange, transfer, onReceive }) {
  const [qtys, setQtys] = useState({});
  const [busy, setBusy] = useState(false);

  const handleOpen = (val) => {
    if (val) {
      const init = {};
      (transfer?.items ?? []).forEach((i) => { init[i.item_id] = i.qty_sent ?? i.qty_requested; });
      setQtys(init);
    }
    onOpenChange(val);
  };

  const handleSave = async () => {
    const items = (transfer?.items ?? []).map((i) => ({
      item_id:      i.item_id,
      qty_received: parseFloat(qtys[i.item_id] ?? i.qty_sent ?? i.qty_requested),
    }));
    setBusy(true);
    try {
      await onReceive({ items });
      toast.success("Transfer received. Stock updated.");
      handleOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-success" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-success/25 bg-success/10">
              <PackageCheck className="h-5 w-5 text-success" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Receive Transfer</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">Confirm quantities received</DialogDescription>
            </div>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-1 mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Item</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase text-right">Sent</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase text-right">Received</span>
            </div>
            {(transfer?.items ?? []).map((item) => (
              <div key={item.item_id} className="grid grid-cols-[1fr_80px_80px] items-center gap-2">
                <span className="text-xs font-semibold truncate">{item.item_name}</span>
                <span className="text-xs tabular-nums text-right text-muted-foreground">{item.qty_sent ?? "—"}</span>
                <Input type="number" min="0" step="1"
                  value={qtys[item.item_id] ?? ""}
                  onChange={(e) => setQtys((prev) => ({ ...prev, [item.item_id]: e.target.value }))}
                  className="h-7 text-xs text-right" />
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/8 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[11px] text-warning">This action is irreversible and will update stock levels immediately.</p>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy}
            className="gap-1.5 bg-success hover:bg-success/90 text-white">
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Receiving…</> : <><PackageCheck className="h-3.5 w-3.5" />Confirm Receipt</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StockTransferDetailPage() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const canAct   = usePermission("inventory.create");
  const [sendOpen,    setSendOpen]    = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const { transfer, isLoading, error, send, receive, cancel } = useStockTransfer(id);

  const handleCancel = async () => {
    if (!confirm("Cancel this transfer?")) return;
    try {
      await cancel.mutateAsync();
      toast.success("Transfer cancelled.");
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (isLoading) return (
    <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />Loading…
    </div>
  );

  if (error || !transfer) return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Transfer not found.
    </div>
  );

  const isDraft    = transfer.status === "draft";
  const isTransit  = transfer.status === "in_transit";
  const isReceived = transfer.status === "received";

  return (
    <>
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          title={`Transfer ${transfer.reference ?? id.slice(0, 8).toUpperCase()}`}
          description={`${transfer.from_store_name} → ${transfer.to_store_name}`}
          backHref="/stock-transfers"
          badge={<StatusBadge status={transfer.status} size="md" />}
          action={canAct && (
            <div className="flex items-center gap-2">
              {isDraft && (
                <>
                  <Button size="sm" onClick={() => setSendOpen(true)} className="gap-1.5">
                    <Send className="h-3.5 w-3.5" />Dispatch
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleCancel}
                    disabled={cancel.isPending} className="gap-1.5 text-destructive border-destructive/30">
                    <X className="h-3.5 w-3.5" />Cancel
                  </Button>
                </>
              )}
              {isTransit && (
                <Button size="sm" onClick={() => setReceiveOpen(true)}
                  className="gap-1.5 bg-success hover:bg-success/90 text-white">
                  <PackageCheck className="h-3.5 w-3.5" />Receive
                </Button>
              )}
            </div>
          )}
        />

        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-3xl px-6 py-5 space-y-5">

            {/* Meta */}
            <div className="rounded-xl border border-border bg-card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Created",    value: formatDateTime(transfer.created_at) },
                { label: "Created By", value: transfer.created_by_name ?? "—"    },
                { label: "Notes",      value: transfer.notes ?? "—"              },
                { label: "Items",      value: transfer.items?.length ?? 0         },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="text-xs font-semibold text-foreground mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            {/* Items table */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/20">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Items</span>
              </div>
              <div className="divide-y divide-border/40">
                {transfer.items?.map((item) => (
                  <div key={item.item_id} className="flex items-center justify-between px-5 py-3.5">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.item_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{item.sku ?? "—"}</p>
                    </div>
                    <div className="flex items-center gap-6 text-right">
                      <div>
                        <p className="text-[10px] text-muted-foreground">Requested</p>
                        <p className="text-sm font-bold tabular-nums">{item.qty_requested}</p>
                      </div>
                      {item.qty_sent != null && (
                        <div>
                          <p className="text-[10px] text-muted-foreground">Sent</p>
                          <p className="text-sm font-bold tabular-nums text-primary">{item.qty_sent}</p>
                        </div>
                      )}
                      {item.qty_received != null && (
                        <div>
                          <p className="text-[10px] text-muted-foreground">Received</p>
                          <p className={cn("text-sm font-bold tabular-nums",
                            item.qty_received < item.qty_sent ? "text-warning" : "text-success")}>
                            {item.qty_received}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>

      <SendDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        transfer={transfer}
        onSend={(p) => send.mutateAsync(p)}
      />
      <ReceiveDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        transfer={transfer}
        onReceive={(p) => receive.mutateAsync(p)}
      />
    </>
  );
}
