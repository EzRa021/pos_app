// ============================================================================
// features/items/ItemDetailView.jsx — Full item detail page component
// ============================================================================

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package, Edit3, Archive, Power, PowerOff, ArrowLeft,
  BarChart3, History, Boxes, Hash, Tag, DollarSign, ClipboardList,
  CheckCircle2, XCircle, AlertTriangle, TrendingDown, Clock,
  RefreshCw, Filter, X, User, Hash as HashIcon, Printer, ZoomIn, Star,
} from "lucide-react";

import { PageHeader }       from "@/components/shared/PageHeader";
import { Spinner }          from "@/components/shared/Spinner";
import { DateRangePicker }  from "@/components/shared/DateRangePicker";
import { DataTable }        from "@/components/shared/DataTable";
import { EmptyState }       from "@/components/shared/EmptyState";
import { Button }           from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Separator }   from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useItem, useItemHistory }  from "@/features/items/useItems";
import { useFavourites }            from "@/features/pos/useFavourites";
import { ItemFormDialog }           from "@/features/items/ItemFormDialog";
import { useInventoryItem }         from "@/features/inventory/useInventory";
import { ItemImage }                from "@/components/shared/ItemImage";
import { AdjustInventoryDialog }    from "@/features/inventory/AdjustInventoryDialog";
import { RestockDialog }            from "@/features/inventory/RestockDialog";
import { PrintLabelsDialog }        from "@/features/labels/PrintLabelsDialog";
import {
  formatCurrency, formatDecimal, formatQuantity,
  formatDateTime, formatDate, measurementTypeLabel,
} from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Detail field ──────────────────────────────────────────────────────────────
function Field({ label, value, mono }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</dt>
      <dd className={cn("text-sm text-foreground", mono && "font-mono")}>{value ?? "—"}</dd>
    </div>
  );
}

// ── Bool pill ─────────────────────────────────────────────────────────────────
function BoolPill({ value, trueLabel = "Yes", falseLabel = "No" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
      value
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
        : "border-border/60 bg-muted/40 text-muted-foreground",
    )}>
      {value ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
      {value ? trueLabel : falseLabel}
    </span>
  );
}

// ── Event type badge ──────────────────────────────────────────────────────────
const EVENT_BADGE_STYLES = {
  SALE:          { cls: "border-rose-500/25 bg-rose-500/10 text-rose-400",           label: "Sale"           },
  RETURN:        { cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",  label: "Return"         },
  RESTOCK:       { cls: "border-teal-500/25 bg-teal-500/10 text-teal-400",           label: "Restock"        },
  ADJUSTMENT:    { cls: "border-amber-500/25 bg-amber-500/10 text-amber-400",        label: "Adjustment"     },
  MANUAL_ADJUST: { cls: "border-amber-500/25 bg-amber-500/10 text-amber-400",        label: "Manual Adjust"  },
  STOCK_COUNT:   { cls: "border-indigo-500/25 bg-indigo-500/10 text-indigo-400",     label: "Stock Count"    },
  PURCHASE:      { cls: "border-teal-500/25 bg-teal-500/10 text-teal-400",           label: "Purchase"       },
  TRANSFER_IN:   { cls: "border-sky-500/25 bg-sky-500/10 text-sky-400",              label: "Transfer In"    },
  TRANSFER_OUT:  { cls: "border-orange-500/25 bg-orange-500/10 text-orange-400",     label: "Transfer Out"   },
  CREATE:        { cls: "border-primary/25 bg-primary/10 text-primary",              label: "Created"        },
  UPDATE:        { cls: "border-sky-500/25 bg-sky-500/10 text-sky-400",              label: "Updated"        },
  PRICE_CHANGE:  { cls: "border-violet-500/25 bg-violet-500/10 text-violet-400",     label: "Price Change"   },
  STATUS_CHANGE: { cls: "border-border/60 bg-muted/40 text-muted-foreground",        label: "Status Change"  },
  DAMAGE:        { cls: "border-orange-500/25 bg-orange-500/10 text-orange-400",     label: "Damage"         },
  THEFT:         { cls: "border-red-500/25 bg-red-500/10 text-red-400",              label: "Theft"          },
};

function EventBadge({ type }) {
  const def = EVENT_BADGE_STYLES[type];
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap",
      def?.cls ?? "border-border/60 bg-muted/40 text-muted-foreground",
    )}>
      {def?.label ?? (type ?? "Unknown").replace(/_/g, " ")}
    </span>
  );
}

// ── Qty change display ────────────────────────────────────────────────────────
function QtyChange({ change, measurementType, unitType }) {
  if (change == null) return <span className="text-xs text-muted-foreground">—</span>;
  const v = parseFloat(change);
  if (v === 0) return <span className="text-xs text-muted-foreground">±0</span>;
  return (
    <span className={cn("text-xs font-semibold tabular-nums", v > 0 ? "text-emerald-400" : "text-rose-400")}>
      {v > 0 ? "+" : ""}{formatQuantity(v, measurementType, unitType)}
    </span>
  );
}

// ── All event types ───────────────────────────────────────────────────────────
const EVENT_TYPES = [
  { value: "SALE",          label: "Sale"           },
  { value: "RETURN",        label: "Return"         },
  { value: "RESTOCK",       label: "Restock"        },
  { value: "ADJUSTMENT",    label: "Adjustment"     },
  { value: "MANUAL_ADJUST", label: "Manual Adjust"  },
  { value: "STOCK_COUNT",   label: "Stock Count"    },
  { value: "PURCHASE",      label: "Purchase Order" },
  { value: "TRANSFER_IN",   label: "Transfer In"    },
  { value: "TRANSFER_OUT",  label: "Transfer Out"   },
  { value: "CREATE",        label: "Created"        },
  { value: "UPDATE",        label: "Updated"        },
  { value: "PRICE_CHANGE",  label: "Price Change"   },
  { value: "STATUS_CHANGE", label: "Status Change"  },
];

// ── History event detail drawer ───────────────────────────────────────────────
function HistoryEventDrawer({ event, open, onClose, measurementType, unitType }) {
  if (!event) return null;
  const def      = EVENT_BADGE_STYLES[event.event_type];
  const qtyChange = event.quantity_change != null ? parseFloat(event.quantity_change) : null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md bg-card border-l border-border p-0 flex flex-col">
        <div className={cn("h-[3px] w-full shrink-0", def ? "" : "bg-primary")}
          style={def ? { background: "var(--color-primary)" } : undefined} />
        <div className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <SheetHeader className="gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <EventBadge type={event.event_type} />
                <SheetTitle className="text-[15px] font-bold leading-tight">
                  {event.event_description ?? "Event Details"}
                </SheetTitle>
              </div>
            </div>
            <SheetDescription className="text-[11px] text-muted-foreground tabular-nums">
              {formatDateTime(event.performed_at)}
            </SheetDescription>
          </SheetHeader>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {event.notes && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Notes</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-line bg-muted/30 rounded-lg px-3 py-2.5 border border-border/60">
                {event.notes}
              </p>
            </div>
          )}
          {qtyChange !== null && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Quantity</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">Change</p>
                  <p className={cn("text-base font-bold tabular-nums",
                    qtyChange > 0 ? "text-emerald-400" : qtyChange < 0 ? "text-rose-400" : "text-muted-foreground")}>
                    {qtyChange > 0 ? "+" : ""}{formatQuantity(qtyChange, measurementType, unitType)}
                  </p>
                </div>
                {event.quantity_before != null && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-1">Before</p>
                    <p className="text-base font-bold tabular-nums text-foreground">
                      {formatQuantity(parseFloat(event.quantity_before), measurementType, unitType)}
                    </p>
                  </div>
                )}
                {event.quantity_after != null && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-1">After</p>
                    <p className="text-base font-bold tabular-nums text-foreground">
                      {formatQuantity(parseFloat(event.quantity_after), measurementType, unitType)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          {(event.price_before != null || event.price_after != null) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Price Change</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">Before</p>
                  <p className="text-base font-bold tabular-nums text-foreground">
                    {formatCurrency(parseFloat(event.price_before ?? 0))}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">After</p>
                  <p className="text-base font-bold tabular-nums text-violet-400">
                    {formatCurrency(parseFloat(event.price_after ?? 0))}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Metadata</p>
            <div className="rounded-lg border border-border/60 bg-muted/20 divide-y divide-border/40">
              {event.reference_id && (
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground">{event.reference_type ?? "Reference"}</span>
                  <span className="font-mono text-[11px] text-foreground">{event.reference_id}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[11px] text-muted-foreground">Performed by</span>
                <span className="text-[11px] font-medium text-foreground">{event.user_name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[11px] text-muted-foreground">Date & time</span>
                <span className="text-[11px] tabular-nums text-foreground">{formatDateTime(event.performed_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── History tab ───────────────────────────────────────────────────────────────
function HistoryTab({ itemId, measurementType, unitType }) {
  const [page,      setPage]      = useState(1);
  const [dateFrom,  setDateFrom]  = useState("");
  const [dateTo,    setDateTo]    = useState("");
  const [eventType, setEventType] = useState("");
  const [selected,  setSelected]  = useState(null);

  const handleFromChange = (v) => { setDateFrom(v); setPage(1); };
  const handleToChange   = (v) => { setDateTo(v);   setPage(1); };
  const handleTypeChange = (v) => { setEventType(v === "ALL" ? "" : v); setPage(1); };
  const clearAll         = ()  => { setDateFrom(""); setDateTo(""); setEventType(""); setPage(1); };
  const hasFilter = dateFrom || dateTo || eventType;

  const { history, total, isLoading, error } = useItemHistory(itemId, {
    page, limit: 15,
    dateFrom:  dateFrom  || undefined,
    dateTo:    dateTo    || undefined,
    eventType: eventType || undefined,
  });

  const columns = useMemo(() => [
    {
      key: "performed_at", header: "Date & Time", sortable: true, width: "148px",
      render: (row) => (
        <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
          {formatDateTime(row.performed_at)}
        </span>
      ),
    },
    {
      key: "event_type", header: "Event", width: "126px",
      render: (row) => <EventBadge type={row.event_type} />,
    },
    {
      key: "event_description", header: "Description",
      render: (row) => (
        <span className="text-xs text-foreground truncate block max-w-[260px]">
          {row.event_description ?? "—"}
        </span>
      ),
    },
    {
      key: "quantity_change", header: "Qty Δ", align: "right", width: "90px",
      render: (row) => (
        <QtyChange change={row.quantity_change} measurementType={measurementType} unitType={unitType} />
      ),
    },
    {
      key: "user_name", header: "By", width: "100px",
      render: (row) => (
        <span className="text-xs text-muted-foreground truncate block">{row.user_name ?? "—"}</span>
      ),
    },
  ], [measurementType, unitType]);

  return (
    <>
      <div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border bg-muted/10">
          <DateRangePicker
            from={dateFrom} to={dateTo}
            onFromChange={handleFromChange}
            onToChange={handleToChange}
            onClear={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
          />
          <Select value={eventType || "ALL"} onValueChange={handleTypeChange}>
            <SelectTrigger className="h-7 w-44 text-[11px]">
              <Filter className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
              <SelectValue placeholder="All Events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Events</SelectItem>
              {EVENT_TYPES.map((et) => (
                <SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilter && (
            <button type="button" onClick={clearAll}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3 w-3" /> Clear all
            </button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {total} event{total !== 1 ? "s" : ""}
          </span>
        </div>
        {error && (
          <div className="px-4 py-3 text-xs text-destructive border-b border-border">{String(error)}</div>
        )}
        <DataTable
          columns={columns} data={history} isLoading={isLoading} rowKey="id"
          onRowClick={(row) => setSelected(row)}
          pagination={{ page, pageSize: 15, total, onPageChange: setPage }}
          emptyState={
            <EmptyState icon={History}
              title={hasFilter ? "No matching events" : "No history recorded yet"}
              description={hasFilter ? "Try adjusting or clearing the filters." : "Activity on this item will appear here."}
              compact
            />
          }
        />
      </div>
      <HistoryEventDrawer
        event={selected} open={!!selected} onClose={() => setSelected(null)}
        measurementType={measurementType} unitType={unitType}
      />
    </>
  );
}

// ── Stock tab ─────────────────────────────────────────────────────────────────
function StockTab({ item, storeId, onRestock, onAdjust }) {
  const { detail } = useInventoryItem(item?.id, storeId);

  if (!item?.track_stock) return (
    <div className="py-12 text-center text-sm text-muted-foreground">
      Stock tracking is disabled for this item.
    </div>
  );

  const mt       = item?.measurement_type ?? "quantity";
  const ut       = item?.unit_type        ?? null;
  const qty      = parseFloat(detail?.quantity           ?? item?.quantity           ?? 0);
  const avail    = parseFloat(detail?.available_quantity  ?? item?.available_quantity  ?? 0);
  const reserved = parseFloat(detail?.reserved_quantity   ?? item?.reserved_quantity   ?? 0);
  const minLevel = detail?.min_stock_level ?? item?.min_stock_level ?? 0;
  const maxLevel = detail?.max_stock_level ?? item?.max_stock_level ?? 1000;
  const isLow    = minLevel > 0 && qty <= minLevel;
  const isOut    = qty === 0;
  const pct      = maxLevel > 0 ? Math.min((qty / maxLevel) * 100, 100) : 0;

  return (
    <div className="p-4 space-y-4">
      {isOut ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
          <XCircle className="h-4 w-4 text-red-400 shrink-0" />
          <p className="text-xs font-semibold text-red-400">Out of Stock — Restock required</p>
        </div>
      ) : isLow ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-xs font-semibold text-amber-400">
            Low Stock — {formatQuantity(minLevel - qty, mt, ut)} below minimum
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <p className="text-xs font-semibold text-emerald-400">In Stock</p>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-muted-foreground">Stock Level</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {formatQuantity(qty, mt, ut)} / {formatQuantity(maxLevel, mt, ut)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all",
            isOut ? "bg-red-500" : isLow ? "bg-amber-400" : "bg-emerald-400")}
            style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "On Hand",   value: qty,      color: "text-foreground"  },
          { label: "Available", value: avail,    color: "text-emerald-400" },
          { label: "Reserved",  value: reserved, color: "text-amber-400"   },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border/60 bg-muted/20 p-3 text-center">
            <p className={cn("text-xl font-bold tabular-nums", color)}>{formatQuantity(value, mt, ut)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Field label="Min Level" value={formatQuantity(minLevel, mt, ut)} />
        <Field label="Max Level" value={formatQuantity(maxLevel, mt, ut)} />
        {detail?.last_count_date && (
          <div className="col-span-2">
            <Field label="Last Count" value={formatDateTime(detail.last_count_date)} />
          </div>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1" onClick={onRestock}>
          <RefreshCw className="h-3.5 w-3.5" /> Restock
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={onAdjust}>
          <BarChart3 className="h-3.5 w-3.5" /> Adjust
        </Button>
      </div>
    </div>
  );
}

// ── ItemDetailView (main export) ──────────────────────────────────────────────
export function ItemDetailView({ itemId }) {
  const navigate = useNavigate();
  const [activeTab,   setActiveTab]   = useState("details");
  const [editOpen,    setEditOpen]    = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restockOpen, setRestockOpen] = useState(false);
  const [adjustOpen,  setAdjustOpen]  = useState(false);
  const [printOpen,      setPrintOpen]      = useState(false);
  const [imgPreviewOpen, setImgPreviewOpen] = useState(false);

  const { item, isLoading, error, storeId, update, activate, deactivate, archive } = useItem(itemId);
  const { restock: restockMut, adjust: adjustMut } = useInventoryItem(itemId, storeId);
  const { isPinned, toggle: favToggle } = useFavourites();
  const pinned = item ? isPinned(itemId) : false;

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (error)     return <div className="p-6 text-sm text-destructive">{String(error)}</div>;
  if (!item)     return <div className="p-6 text-sm text-muted-foreground">Item not found.</div>;

  const qty    = parseFloat(item.quantity ?? 0);
  const minLvl = item.min_stock_level ?? 0;
  const isLow  = item.track_stock && minLvl > 0 && qty <= minLvl;
  const isOut  = item.track_stock && qty === 0;

  const tabs = [
    { key: "details", label: "Details", icon: ClipboardList },
    { key: "stock",   label: "Stock",   icon: Boxes },
    { key: "history", label: "History", icon: History },
  ];

  return (
    <>
      <PageHeader
        backHref="/products"
        title={item.item_name}
        description={`SKU: ${item.sku}${item.barcode ? ` · Barcode: ${item.barcode}` : ""}`}
        badge={
          <div className="flex items-center gap-1.5">
            {pinned && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                <Star className="h-2.5 w-2.5 fill-amber-400" /> Quick Access
              </span>
            )}
            {!item.is_active && (
              <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                Inactive
              </span>
            )}
            {isOut ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                <XCircle className="h-2.5 w-2.5" /> Out of Stock
              </span>
            ) : isLow ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                <TrendingDown className="h-2.5 w-2.5" /> Low Stock
              </span>
            ) : item.track_stock ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <CheckCircle2 className="h-2.5 w-2.5" /> In Stock
              </span>
            ) : null}
          </div>
        }
        action={
          <div className="flex items-center gap-1.5">
            {/* ── POS Quick Access (favourite) toggle ─────────────────── */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => favToggle(itemId)}
              className={cn(
                "gap-1.5 transition-colors",
                pinned
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  : "text-muted-foreground hover:text-amber-400 hover:border-amber-500/40",
              )}
              title={pinned ? "Remove from POS Quick Access" : "Add to POS Quick Access"}
            >
              <Star className={cn("h-3.5 w-3.5", pinned && "fill-amber-400")} />
              {pinned ? "In Quick Access" : "Quick Access"}
            </Button>

            {/* ── Print Labels button ─────────────────────────────────── */}
            <Button size="sm" variant="outline" onClick={() => setPrintOpen(true)}
              className="gap-1.5">
              <Printer className="h-3.5 w-3.5" />
              Print Labels
            </Button>

            <Button size="sm" variant="outline"
              disabled={activate.isPending || deactivate.isPending}
              onClick={() => item.is_active ? deactivate.mutate(itemId) : activate.mutate(itemId)}>
              {item.is_active
                ? <PowerOff className="h-3.5 w-3.5 text-amber-400" />
                : <Power    className="h-3.5 w-3.5 text-emerald-400" />}
              {item.is_active ? "Deactivate" : "Activate"}
            </Button>

            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Edit3 className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        }
      >
        {/* Tabs */}
        <div className="flex items-center gap-0.5 pt-1">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                activeTab === t.key
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}>
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* ── Tab content ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-6 py-5">
          {activeTab === "details" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Image card */}
              <div className="md:col-span-2 rounded-xl border border-border bg-card p-5">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Product Image</h3>
                <div className="flex items-start gap-5">
                  {/* Clickable preview — only when an image exists */}
                  <div className="relative group shrink-0">
                    <ItemImage item={item} size="xl" rounded="xl" />
                    {item.image_data && (
                      <button
                        type="button"
                        onClick={() => setImgPreviewOpen(true)}
                        className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/40 transition-colors"
                      >
                        <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="detail-image-upload"
                      className="flex items-center gap-2 cursor-pointer rounded-lg border border-border/60 bg-muted/30 hover:bg-muted/50 px-3 py-2 text-xs font-medium text-foreground transition-colors w-fit">
                      <Edit3 className="h-3.5 w-3.5" />
                      {item.image_data ? "Change image" : "Upload image"}
                    </label>
                    <input id="detail-image-upload" type="file" accept="image/*" className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const MAX = 400;
                          const data = await new Promise((res, rej) => {
                            const reader = new FileReader();
                            reader.onerror = rej;
                            reader.onload = (ev) => {
                              const img = new Image();
                              img.onerror = rej;
                              img.onload = () => {
                                const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                                const canvas = document.createElement("canvas");
                                canvas.width  = Math.round(img.width  * scale);
                                canvas.height = Math.round(img.height * scale);
                                canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                                res(canvas.toDataURL("image/jpeg", 0.72));
                              };
                              img.src = ev.target.result;
                            };
                            reader.readAsDataURL(file);
                          });
                          update.mutate({ image_data: data });
                        } catch { /* ignore */ }
                        e.target.value = "";
                      }}
                    />
                    {item.image_data && (
                      <button type="button" onClick={() => update.mutate({ image_data: null })}
                        disabled={update.isPending}
                        className="flex items-center gap-1.5 text-[11px] text-destructive hover:text-destructive/80 transition-colors w-fit disabled:opacity-50 disabled:cursor-not-allowed">
                        <Archive className="h-3 w-3" /> Remove image
                      </button>
                    )}
                    <p className="text-[10px] text-muted-foreground">PNG, JPG or WEBP · 400×400px · ~30–80KB</p>
                  </div>
                </div>
              </div>

              {/* Core info */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Core Information</h3>
                <Separator className="bg-border" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="SKU"             value={item.sku}     mono />
                  <Field label="Barcode"          value={item.barcode} mono />
                  <Field label="Category"         value={item.category_name} />
                  <Field label="Department"       value={item.department_name} />
                  <Field label="Branch"           value={item.branch_name} />
                  <Field label="Measurement Type" value={measurementTypeLabel(item.measurement_type)} />
                  <Field label="Unit"             value={item.unit_type} />
                  {item.min_increment != null && (
                    <Field label="Min Increment"
                      value={formatQuantity(parseFloat(item.min_increment), item.measurement_type, item.unit_type)} />
                  )}
                  {item.default_qty != null && (
                    <Field label="Default Qty"
                      value={formatQuantity(parseFloat(item.default_qty), item.measurement_type, item.unit_type)} />
                  )}
                  <div className="col-span-2">
                    <Field label="Description" value={item.description} />
                  </div>
                  <Field label="Created"      value={formatDate(item.created_at)} />
                  <Field label="Last Updated" value={formatDate(item.updated_at)} />
                </div>
              </div>

              {/* Pricing */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Pricing</h3>
                <Separator className="bg-border" />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Cost Price</dt>
                    <dd className="text-lg font-bold text-foreground">{formatCurrency(parseFloat(item.cost_price))}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Selling Price</dt>
                    <dd className="text-lg font-bold text-primary">{formatCurrency(parseFloat(item.selling_price))}</dd>
                  </div>
                  {item.discount_price && (
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Discount Price</dt>
                      <dd className="text-sm font-semibold text-amber-400">{formatCurrency(parseFloat(item.discount_price))}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Margin</dt>
                    <dd className="text-sm font-bold text-emerald-400">
                      {item.selling_price > 0
                        ? (((item.selling_price - item.cost_price) / item.selling_price) * 100).toFixed(1) + "%"
                        : "—"}
                    </dd>
                  </div>
                  {item.max_discount_percent && (
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Max Discount</dt>
                      <dd className="text-sm font-semibold text-foreground">{parseFloat(item.max_discount_percent).toFixed(1)}%</dd>
                    </div>
                  )}
                </div>
              </div>

              {/* Settings */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4 md:col-span-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Settings</h3>
                <Separator className="bg-border" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    ["Active",           item.is_active],
                    ["Sellable",         item.sellable],
                    ["Available for POS",item.available_for_pos],
                    ["Track Stock",      item.track_stock],
                    ["Taxable",          item.taxable],
                    ["Allow Discount",   item.allow_discount],
                    ["Requires Weight",  item.requires_weight],
                    ["Allow Neg. Stock", item.allow_negative_stock],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</dt>
                      <BoolPill value={val} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "stock" && (
            <div className="max-w-lg">
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/20">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Stock Management</h3>
                </div>
                <StockTab
                  item={item} storeId={storeId}
                  onRestock={() => setRestockOpen(true)}
                  onAdjust={()  => setAdjustOpen(true)}
                />
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/20">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Activity History</h3>
              </div>
              <HistoryTab
                itemId={itemId}
                measurementType={item.measurement_type ?? "quantity"}
                unitType={item.unit_type ?? null}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Edit dialog ───────────────────────────────────────────────── */}
      <ItemFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        initial={item}
        mutation={update}
        storeId={storeId}
      />

      {/* ── Archive dialog ────────────────────────────────────────────── */}
      {item && (
        <Dialog open={archiveOpen} onOpenChange={(v) => !archive.isPending && setArchiveOpen(v)}>
          <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl">
            <div className="h-[3px] bg-destructive" />
            <div className="px-6 pt-5 pb-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
                  <Archive className="h-4 w-4 text-destructive" />
                </div>
                <DialogTitle className="text-[15px] font-bold">Archive Item?</DialogTitle>
              </div>
              <DialogDescription className="text-[11px] text-muted-foreground leading-relaxed">
                <strong className="text-foreground">{item.item_name}</strong> will be archived and removed from all
                active menus. This cannot be undone via the UI.
              </DialogDescription>
              {archive.error && (
                <p className="text-xs text-destructive">{String(archive.error)}</p>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={archive.isPending}
                  onClick={() => setArchiveOpen(false)}>Cancel</Button>
                <Button variant="destructive" className="flex-1" disabled={archive.isPending}
                  onClick={() => archive.mutate(itemId, { onSuccess: () => navigate("/products") })}>
                  {archive.isPending ? "Archiving…" : "Archive"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Restock dialog ────────────────────────────────────────────── */}
      <RestockDialog
        open={restockOpen} onOpenChange={setRestockOpen}
        item={item} mutation={restockMut}
      />

      {/* ── Adjust dialog ─────────────────────────────────────────────── */}
      <AdjustInventoryDialog
        open={adjustOpen} onOpenChange={setAdjustOpen}
        item={item} mutation={adjustMut}
      />

      {/* ── Print Labels dialog ───────────────────────────────────────── */}
      <PrintLabelsDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        items={item ? [item] : []}
      />

      {/* ── Image preview lightbox ────────────────────────────────────── */}
      {item?.image_data && (
        <Dialog open={imgPreviewOpen} onOpenChange={setImgPreviewOpen}>
          <DialogContent className="max-w-lg border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
            <div className="h-[3px] w-full bg-primary" />
            <div className="px-5 pt-4 pb-5">
              <DialogHeader className="mb-4">
                <DialogTitle className="text-sm font-bold">{item.item_name}</DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground">
                  {item.sku} {item.barcode ? `· ${item.barcode}` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-center rounded-xl border border-border bg-muted/20 p-4">
                <img
                  src={item.image_data}
                  alt={item.item_name}
                  className="max-h-80 max-w-full rounded-lg object-contain"
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

