// pages/StockTransfersPage.jsx
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight, Plus, Loader2, X, Search,
  ArrowRight, Package, PackageCheck, Wand2, ChevronRight,
  Store, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { PageHeader }  from "@/components/shared/PageHeader";
import { DataTable }   from "@/components/shared/DataTable";
import { EmptyState }  from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import { cn }          from "@/lib/utils";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useStockTransfers, useExecuteTransfer } from "@/features/stock_transfers/useStockTransfers";
import { usePermission }  from "@/hooks/usePermission";
import { useBranchStore } from "@/stores/branch.store";
import { getStores }      from "@/commands/stores";
import { searchItems }    from "@/commands/items";
import { useQuery }       from "@tanstack/react-query";
import { formatDate }     from "@/lib/format";

// ── Status filter tabs ────────────────────────────────────────────────────────
const STATUS_TABS = [
  { key: "",                 label: "All"              },
  { key: "pending_approval", label: "Pending Approval" },
  { key: "draft",            label: "Draft"            },
  { key: "in_transit",       label: "In Transit"       },
  { key: "received",         label: "Received"         },
  { key: "cancelled",        label: "Cancelled"        },
];

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Store & Notes selection
// ─────────────────────────────────────────────────────────────────────────────
function Step1_Stores({ fromStoreId, stores, toStoreId, setToStoreId, notes, setNotes, onNext }) {
  const destStores = stores.filter((s) => s.id !== fromStoreId);
  const fromStore  = stores.find((s) => s.id === fromStoreId);
  const toStore    = stores.find((s) => s.id === Number(toStoreId));

  return (
    <div className="space-y-5">
      {/* From / To visual */}
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">From</p>
          <p className="text-sm font-semibold text-foreground">{fromStore?.store_name ?? "—"}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">To</p>
          <p className="text-sm font-semibold text-foreground">{toStore?.store_name ?? "Select a store"}</p>
        </div>
      </div>

      {/* Destination picker */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Destination Store *
        </label>
        <div className="grid grid-cols-1 gap-2">
          {destStores.length === 0 && (
            <p className="text-xs text-muted-foreground px-1">No other stores available.</p>
          )}
          {destStores.map((s) => (
            <button
              key={s.id}
              onClick={() => setToStoreId(s.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all",
                toStoreId === s.id
                  ? "border-primary bg-primary/8 shadow-sm"
                  : "border-border bg-card hover:bg-muted/30",
              )}
            >
              <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                toStoreId === s.id ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}>
                <Store className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{s.store_name}</p>
                {s.store_code && (
                  <p className="text-[11px] text-muted-foreground font-mono">{s.store_code}</p>
                )}
              </div>
              {toStoreId === s.id && (
                <CheckCircle2 className="ml-auto h-4 w-4 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Notes <span className="normal-case font-normal">(optional)</span>
        </label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason for transfer, batch reference…"
          className="h-9 text-sm"
        />
      </div>

      <DialogFooter className="pt-2">
        <Button
          size="sm"
          onClick={onNext}
          disabled={!toStoreId}
          className="gap-1.5 ml-auto"
        >
          Select Items <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Item search dropdown (shared sub-component)
// ─────────────────────────────────────────────────────────────────────────────
function ItemSearchDropdown({ storeId, placeholder, onSelect, exclude = [] }) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);

  const { data: results = [] } = useQuery({
    queryKey: ["item-search-transfer", storeId, query],
    queryFn:  () => searchItems(query, storeId, 12),
    enabled:  query.length >= 1 && !!storeId,
    staleTime: 10_000,
  });

  const filtered = results.filter((r) => !exclude.includes(r.id));

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="pl-8 h-8 text-xs"
        />
      </div>
      {open && query.length >= 1 && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
          {filtered.map((r) => (
            <button
              key={r.id}
              onMouseDown={() => { onSelect(r); setQuery(""); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{r.item_name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {r.sku ?? r.barcode ?? ""}
                </p>
              </div>
              <span className="ml-3 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {r.available_quantity ?? "—"} in stock
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Select source items + quantities
// ─────────────────────────────────────────────────────────────────────────────
function Step2_Items({ fromStoreId, items, setItems, onBack, onNext }) {
  const addItem = (result) => {
    if (items.some((i) => i.source_item_id === result.id)) return;
    setItems((prev) => [
      ...prev,
      {
        source_item_id:   result.id,
        source_item_name: result.item_name,
        source_item_sku:  result.sku,
        available:        result.available_quantity,
        qty:              1,
        // Step 3 fields — blank until mapped
        destination_item_id:   null,
        destination_item_name: null,
        auto_create:           false,
      },
    ]);
  };

  const setQty = (id, val) =>
    setItems((prev) =>
      prev.map((i) => i.source_item_id === id ? { ...i, qty: val } : i)
    );

  const removeItem = (id) =>
    setItems((prev) => prev.filter((i) => i.source_item_id !== id));

  const hasError = (item) =>
    item.available != null && parseFloat(item.qty) > item.available;

  const canProceed = items.length > 0 &&
    items.every((i) => parseFloat(i.qty) > 0 && !hasError(i));

  return (
    <div className="space-y-4">
      {/* Item search */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Add Items from Source Store
        </label>
        <ItemSearchDropdown
          storeId={fromStoreId}
          placeholder="Search items to transfer…"
          onSelect={addItem}
          exclude={items.map((i) => i.source_item_id)}
        />
      </div>

      {/* Item list */}
      {items.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_80px_28px] gap-2 px-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Item</span>
            <span className="text-[10px] font-semibold uppercase text-muted-foreground text-right">Qty</span>
            <span />
          </div>
          {items.map((item) => (
            <div key={item.source_item_id}>
              <div className="grid grid-cols-[1fr_80px_28px] items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{item.source_item_name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {item.source_item_sku ?? ""} · {item.available ?? "?"} available
                  </p>
                </div>
                <Input
                  type="number"
                  min="0.001"
                  step="1"
                  value={item.qty}
                  onChange={(e) => setQty(item.source_item_id, e.target.value)}
                  className={cn(
                    "h-7 text-xs text-right",
                    hasError(item) && "border-destructive focus-visible:ring-destructive",
                  )}
                />
                <button
                  onClick={() => removeItem(item.source_item_id)}
                  className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {hasError(item) && (
                <p className="text-[10px] text-destructive mt-0.5 px-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Exceeds available stock ({item.available})
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <Package className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-xs">Search above to add items to the transfer</p>
        </div>
      )}

      <DialogFooter className="pt-2 flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
        <Button size="sm" onClick={onNext} disabled={!canProceed} className="gap-1.5">
          Map to Destination <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Map each source item to a destination item (or auto-create)
// ─────────────────────────────────────────────────────────────────────────────
function Step3_Mapping({ toStoreId, items, setItems, onBack, onSubmit, busy }) {
  const setMapping = (sourceId, destItem) =>
    setItems((prev) =>
      prev.map((i) =>
        i.source_item_id === sourceId
          ? {
              ...i,
              destination_item_id:   destItem?.id ?? null,
              destination_item_name: destItem?.item_name ?? null,
              auto_create:           false,
            }
          : i
      )
    );

  const setAutoCreate = (sourceId) =>
    setItems((prev) =>
      prev.map((i) =>
        i.source_item_id === sourceId
          ? { ...i, destination_item_id: null, destination_item_name: null, auto_create: true }
          : i
      )
    );

  const clearMapping = (sourceId) =>
    setItems((prev) =>
      prev.map((i) =>
        i.source_item_id === sourceId
          ? { ...i, destination_item_id: null, destination_item_name: null, auto_create: false }
          : i
      )
    );

  const allMapped = items.every(
    (i) => i.destination_item_id != null || i.auto_create
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        For each item being transferred, choose which item in the destination store
        should receive the stock. If no match exists, select{" "}
        <span className="font-semibold text-primary">Auto-create</span> to clone
        the item into the destination store.
      </p>

      <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
        {items.map((item) => {
          const isMapped     = item.destination_item_id != null;
          const isAutoCreate = item.auto_create;
          const isSet        = isMapped || isAutoCreate;

          return (
            <div
              key={item.source_item_id}
              className={cn(
                "rounded-xl border p-4 space-y-3 transition-colors",
                isSet ? "border-primary/30 bg-primary/5" : "border-border bg-card",
              )}
            >
              {/* Source item label */}
              <div className="flex items-start gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Package className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{item.source_item_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {item.qty} {item.source_item_sku ? `· ${item.source_item_sku}` : ""}
                  </p>
                </div>
                {isSet && (
                  <button
                    onClick={() => clearMapping(item.source_item_id)}
                    className="ml-auto h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 pl-9">
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] text-muted-foreground">maps to</span>
              </div>

              {/* Destination slot */}
              {!isSet ? (
                <div className="pl-9 space-y-2">
                  {/* Search existing items */}
                  <ItemSearchDropdown
                    storeId={toStoreId}
                    placeholder="Search destination store items…"
                    onSelect={(r) => setMapping(item.source_item_id, r)}
                  />
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[10px] text-muted-foreground">or</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <button
                    onClick={() => setAutoCreate(item.source_item_id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 text-left hover:bg-primary/10 transition-colors"
                  >
                    <Wand2 className="h-3.5 w-3.5 text-primary shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-primary">Auto-create item</p>
                      <p className="text-[10px] text-muted-foreground">
                        Clones "{item.source_item_name}" into the destination store
                      </p>
                    </div>
                  </button>
                </div>
              ) : (
                <div className="pl-9 flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2.5">
                  {isAutoCreate ? (
                    <>
                      <Wand2 className="h-3.5 w-3.5 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-primary">Auto-create</p>
                        <p className="text-[10px] text-muted-foreground">
                          A new item will be created in the destination store
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <PackageCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                      <p className="text-xs font-semibold truncate">{item.destination_item_name}</p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!allMapped && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/8 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
          <p className="text-[11px] text-warning">
            Map all items before completing the transfer.
          </p>
        </div>
      )}

      <DialogFooter className="pt-2 flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={!allMapped || busy}
          className="gap-1.5 bg-success hover:bg-success/90 text-white"
        >
          {busy
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Transferring…</>
            : <><PackageCheck className="h-3.5 w-3.5" />Complete Transfer</>}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIZARD WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
const STEP_LABELS = ["Stores", "Items", "Mapping"];

function NewTransferWizard({ open, onOpenChange }) {
  const storeId    = useBranchStore((s) => s.activeStore?.id);
  const [step, setStep]   = useState(0);
  const [toStoreId, setToStoreId] = useState(null);
  const [notes,     setNotes]     = useState("");
  const [items,     setItems]     = useState([]);

  const executeTransfer = useExecuteTransfer();

  const { data: stores = [] } = useQuery({
    queryKey: ["stores"],
    queryFn:  () => getStores(),
    staleTime: 5 * 60_000,
    enabled:  !!storeId,
  });

  // Reset when dialog closes
  const handleOpenChange = (val) => {
    if (!val) {
      setStep(0); setToStoreId(null); setNotes(""); setItems([]);
    }
    onOpenChange(val);
  };

  const handleSubmit = async () => {
    const payload = {
      from_store_id: storeId,
      to_store_id:   toStoreId,
      notes:         notes || undefined,
      items: items.map((i) => ({
        source_item_id:      i.source_item_id,
        qty:                 parseFloat(i.qty),
        destination_item_id: i.destination_item_id ?? undefined,
      })),
    };
    await executeTransfer.mutateAsync(payload);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        {/* Color bar */}
        <div className="h-[3px] w-full bg-primary" />

        {/* Header */}
        <div className="px-6 pt-5 pb-0 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
          </div>
          <div>
            <DialogTitle className="text-base font-semibold">New Stock Transfer</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Move inventory between branches
            </DialogDescription>
          </div>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-4 flex items-center gap-1">
          {STEP_LABELS.map((label, idx) => (
            <div key={label} className="flex items-center gap-1">
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors",
                  idx < step
                    ? "bg-primary text-primary-foreground"
                    : idx === step
                    ? "bg-primary/15 text-primary border border-primary/40"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {idx < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
              </div>
              <span className={cn(
                "text-[11px] font-semibold",
                idx === step ? "text-foreground" : "text-muted-foreground",
              )}>
                {label}
              </span>
              {idx < STEP_LABELS.length - 1 && (
                <div className={cn(
                  "mx-1 h-px w-8",
                  idx < step ? "bg-primary" : "bg-border",
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 pb-6 max-h-[60vh] overflow-y-auto">
          {step === 0 && (
            <Step1_Stores
              fromStoreId={storeId}
              stores={stores}
              toStoreId={toStoreId}
              setToStoreId={setToStoreId}
              notes={notes}
              setNotes={setNotes}
              onNext={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <Step2_Items
              fromStoreId={storeId}
              items={items}
              setItems={setItems}
              onBack={() => setStep(0)}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <Step3_Mapping
              toStoreId={toStoreId}
              items={items}
              setItems={setItems}
              onBack={() => setStep(1)}
              onSubmit={handleSubmit}
              busy={executeTransfer.isPending}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function StockTransfersPage() {
  const navigate  = useNavigate();
  const canCreate = usePermission("inventory.create");
  const [status,  setStatus]  = useState("");
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState("");
  const [debounced, setDebounced] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const { transfers, total, isLoading, isFetching } = useStockTransfers({
    search: debounced || undefined,
    status,
    page,
    limit: 25,
  });

  const columns = [
    {
      key: "transfer_number",
      header: "Reference",
      render: (r) => (
        <span className="text-xs font-mono font-semibold text-primary">{r.transfer_number}</span>
      ),
    },
    {
      key: "from_store_name",
      header: "From",
      render: (r) => (
        <span className="text-xs text-muted-foreground">{r.from_store_name ?? "—"}</span>
      ),
    },
    {
      key: "to_store_name",
      header: "To",
      render: (r) => (
        <span className="text-xs text-muted-foreground">{r.to_store_name ?? "—"}</span>
      ),
    },
    {
      key: "item_count",
      header: "Items",
      align: "right",
      render: (r) => (
        <span className="text-xs tabular-nums">{r.items?.length ?? "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "requested_at",
      header: "Created",
      render: (r) => (
        <span className="text-xs text-muted-foreground">{formatDate(r.requested_at)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] text-primary"
          onClick={() => navigate(`/stock-transfers/${r.id}`)}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          title="Stock Transfers"
          description="Move inventory between branches."
          action={canCreate && (
            <Button size="sm" onClick={() => setWizardOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />New Transfer
            </Button>
          )}
        />

        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl px-6 py-5 space-y-4">

            {/* Toolbar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search transfer #, store…"
                  className="pl-8 h-8 w-52 text-xs"
                />
                {search && (
                  <button
                    onClick={() => { setSearch(""); setDebounced(""); setPage(1); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 border border-border/60 flex-wrap">
                {STATUS_TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => { setStatus(t.key); setPage(1); }}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all",
                      status === t.key
                        ? "bg-card text-foreground shadow-sm border border-border/60"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
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
                    <Button size="sm" onClick={() => setWizardOpen(true)} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" />New Transfer
                    </Button>
                  )}
                />
              }
            />
          </div>
        </div>
      </div>

      <NewTransferWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </>
  );
}
