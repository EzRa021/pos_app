// pages/StockTransfersPage.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, Plus, Loader2, Send, PackageCheck, X, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader }  from "@/components/shared/PageHeader";
import { DataTable }   from "@/components/shared/DataTable";
import { EmptyState }  from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import { cn }          from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useStockTransfers }   from "@/features/stock_transfers/useStockTransfers";
import { usePermission }       from "@/hooks/usePermission";
import { useBranchStore }      from "@/stores/branch.store";
import { getStores }           from "@/commands/stores";
import { searchItems }         from "@/commands/items";
import { useQuery }            from "@tanstack/react-query";
import { formatDate, formatDateTime } from "@/lib/format";

// ── Status filter tabs ────────────────────────────────────────────────────────
const STATUS_TABS = [
  { key: "",           label: "All"        },
  { key: "draft",      label: "Draft"      },
  { key: "in_transit", label: "In Transit" },
  { key: "received",   label: "Received"   },
  { key: "cancelled",  label: "Cancelled"  },
];

// ── Create Transfer Dialog ────────────────────────────────────────────────────
function CreateTransferDialog({ open, onOpenChange, onCreate }) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const [toStoreId, setToStoreId] = useState("");
  const [notes,     setNotes]     = useState("");
  const [items,     setItems]     = useState([{ item_id: "", item_name: "", qty_requested: 1 }]);
  const [search,    setSearch]    = useState("");
  const [busy,      setBusy]      = useState(false);

  const { data: stores = [] } = useQuery({
    queryKey: ["stores"],
    queryFn:  () => getStores(),
    staleTime: 5 * 60_000,
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ["item-search-transfer", search],
    queryFn:  () => searchItems(search, storeId, 10),
    enabled:  search.length >= 2 && !!storeId,
    staleTime: 10_000,
  });

  const handleSave = async () => {
    if (!toStoreId) { toast.error("Select a destination store."); return; }
    const validItems = items.filter((i) => i.item_id && i.qty_requested > 0);
    if (validItems.length === 0) { toast.error("Add at least one item."); return; }
    setBusy(true);
    try {
      await onCreate({
        from_store_id: storeId,
        to_store_id:   toStoreId,
        notes:         notes || undefined,
        items:         validItems.map((i) => ({ item_id: i.item_id, qty_requested: parseFloat(i.qty_requested) })),
      });
      toast.success("Transfer created.");
      setToStoreId(""); setNotes(""); setItems([{ item_id: "", item_name: "", qty_requested: 1 }]);
      onOpenChange(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const setItemField = (idx, field, val) => setItems((prev) =>
    prev.map((item, i) => i === idx ? { ...item, [field]: val } : item)
  );

  const selectItem = (idx, result) => {
    setItemField(idx, "item_id", result.id);
    setItemField(idx, "item_name", result.item_name);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">New Stock Transfer</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Move stock between branches
              </DialogDescription>
            </div>
          </div>

          {/* Destination */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Destination Store *</label>
            <select value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">— Select store —</option>
              {stores.filter((s) => s.id !== storeId).map((s) => (
                <option key={s.id} value={s.id}>{s.store_name}</option>
              ))}
            </select>
          </div>

          {/* Items */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Items *</label>
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex-1 relative">
                  {item.item_name ? (
                    <div className="flex items-center gap-2 h-8 rounded-md border border-input bg-muted/20 px-3">
                      <span className="text-xs truncate flex-1">{item.item_name}</span>
                      <button onClick={() => setItemField(idx, "item_id", "") || setItemField(idx, "item_name", "")}>
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  ) : (
                    <Input
                      placeholder="Search item…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-8 text-sm"
                    />
                  )}
                  {!item.item_name && search.length >= 2 && searchResults.length > 0 && (
                    <div className="absolute z-50 top-full mt-1 w-full rounded-lg border border-border bg-card shadow-lg">
                      {searchResults.map((r) => (
                        <div key={r.id} onClick={() => selectItem(idx, r)}
                          className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-muted/50">
                          <span className="font-semibold">{r.item_name}</span>
                          <span className="text-muted-foreground font-mono">{r.sku ?? r.barcode ?? ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Input type="number" min="0.01" step="1" value={item.qty_requested}
                  onChange={(e) => setItemField(idx, "qty_requested", parseFloat(e.target.value) || 1)}
                  className="h-8 text-sm w-20" />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={items.length === 1}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5 text-[11px]"
              onClick={() => setItems((prev) => [...prev, { item_id: "", item_name: "", qty_requested: 1 }])}>
              <Plus className="h-3 w-3" />Add Item
            </Button>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional transfer notes" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy} className="gap-1.5">
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating…</> : <><Plus className="h-3.5 w-3.5" />Create Transfer</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StockTransfersPage() {
  const navigate   = useNavigate();
  const canCreate  = usePermission("inventory.create");
  const [status, setStatus]   = useState("");
  const [page,   setPage]     = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const { transfers, total, isLoading, isFetching, create } = useStockTransfers({ status, page, limit: 25 });

  const columns = [
    { key: "reference",    header: "Reference", render: (r) => <span className="text-xs font-mono font-semibold text-primary">{r.reference ?? r.id?.slice(0, 8).toUpperCase()}</span> },
    { key: "from_store",   header: "From",      render: (r) => <span className="text-xs text-muted-foreground">{r.from_store_name}</span> },
    { key: "to_store",     header: "To",        render: (r) => <span className="text-xs text-muted-foreground">{r.to_store_name}</span> },
    { key: "item_count",   header: "Items",     align: "right", render: (r) => <span className="text-xs tabular-nums">{r.item_count ?? "—"}</span> },
    { key: "status",       header: "Status",    render: (r) => <StatusBadge status={r.status} /> },
    { key: "created_at",   header: "Created",   render: (r) => <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span> },
    { key: "actions",      header: "",          align: "right", render: (r) => (
      <Button variant="ghost" size="sm" className="h-7 text-[11px] text-primary" onClick={() => navigate(`/stock-transfers/${r.id}`)}>
        View
      </Button>
    )},
  ];

  return (
    <>
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          title="Stock Transfers"
          description="Move inventory between branches."
          action={canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />New Transfer
            </Button>
          )}
        />

        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl px-6 py-5 space-y-4">

            {/* Status tabs */}
            <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 border border-border/60 w-fit flex-wrap">
              {STATUS_TABS.map((t) => (
                <button key={t.key} onClick={() => { setStatus(t.key); setPage(1); }}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all",
                    status === t.key ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground",
                  )}>
                  {t.label}
                </button>
              ))}
            </div>

            <DataTable
              columns={columns}
              data={transfers}
              isLoading={isLoading || isFetching}
              pagination={{ page, pageSize: 25, total, onPageChange: setPage }}
              emptyState={
                <EmptyState
                  icon={ArrowLeftRight}
                  title="No transfers found"
                  description="Create a new transfer to move stock between stores."
                  action={canCreate && (
                    <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" />New Transfer
                    </Button>
                  )}
                />
              }
            />
          </div>
        </div>
      </div>

      <CreateTransferDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(p) => create.mutateAsync(p)}
      />
    </>
  );
}
