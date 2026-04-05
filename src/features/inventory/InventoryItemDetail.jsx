// ============================================================================
// features/inventory/InventoryItemDetail.jsx — Per-item inventory detail page
// ============================================================================

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes, BarChart3, RefreshCw, History, AlertTriangle,
  TrendingDown, CheckCircle2, XCircle, ArrowRight, Filter, X, ZoomIn, Star,
} from "lucide-react";

import { PageHeader }           from "@/components/shared/PageHeader";
import { Spinner }              from "@/components/shared/Spinner";
import { DateRangePicker }      from "@/components/shared/DateRangePicker";
import { DataTable }            from "@/components/shared/DataTable";
import { EmptyState }           from "@/components/shared/EmptyState";
import { Button }               from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Separator }            from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useInventoryItem, useMovementHistory } from "@/features/inventory/useInventory";
import { useFavourites }         from "@/features/pos/useFavourites";
import { ItemImage }             from "@/components/shared/ItemImage";
import { RestockDialog }         from "@/features/inventory/RestockDialog";
import { AdjustInventoryDialog } from "@/features/inventory/AdjustInventoryDialog";
import { useBranchStore }        from "@/stores/branch.store";
import {
  formatCurrency, formatQuantity, formatPricePerUnit, formatDateTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";

// ── All event type options ────────────────────────────────────────────────────
const EVENT_TYPES = [
  { value: "SALE",          label: "Sale"          },
  { value: "RETURN",        label: "Return"        },
  { value: "RESTOCK",       label: "Restock"       },
  { value: "ADJUSTMENT",    label: "Adjustment"    },
  { value: "MANUAL_ADJUST", label: "Manual Adjust" },
  { value: "STOCK_COUNT",   label: "Stock Count"   },
  { value: "PURCHASE",      label: "Purchase Order"},
  { value: "TRANSFER_IN",   label: "Transfer In"   },
  { value: "TRANSFER_OUT",  label: "Transfer Out"  },
  { value: "CREATE",        label: "Created"       },
  { value: "PRICE_CHANGE",  label: "Price Change"  },
  { value: "STATUS_CHANGE", label: "Status Change" },
];

// ── Event badge ───────────────────────────────────────────────────────────────
const EVENT_BADGE_STYLES = {
  SALE:          { cls: "border-rose-500/25 bg-rose-500/10 text-rose-400",          label: "Sale"          },
  RETURN:        { cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400", label: "Return"        },
  RESTOCK:       { cls: "border-teal-500/25 bg-teal-500/10 text-teal-400",          label: "Restock"       },
  ADJUSTMENT:    { cls: "border-amber-500/25 bg-amber-500/10 text-amber-400",       label: "Adjustment"    },
  MANUAL_ADJUST: { cls: "border-amber-500/25 bg-amber-500/10 text-amber-400",       label: "Manual Adjust" },
  STOCK_COUNT:   { cls: "border-indigo-500/25 bg-indigo-500/10 text-indigo-400",    label: "Stock Count"   },
  PURCHASE:      { cls: "border-teal-500/25 bg-teal-500/10 text-teal-400",          label: "Purchase"      },
  TRANSFER_IN:   { cls: "border-sky-500/25 bg-sky-500/10 text-sky-400",             label: "Transfer In"   },
  TRANSFER_OUT:  { cls: "border-orange-500/25 bg-orange-500/10 text-orange-400",    label: "Transfer Out"  },
  CREATE:        { cls: "border-primary/25 bg-primary/10 text-primary",             label: "Created"       },
  UPDATE:        { cls: "border-sky-500/25 bg-sky-500/10 text-sky-400",             label: "Updated"       },
  PRICE_CHANGE:  { cls: "border-violet-500/25 bg-violet-500/10 text-violet-400",    label: "Price Change"  },
  STATUS_CHANGE: { cls: "border-border/60 bg-muted/40 text-muted-foreground",       label: "Status Change" },
  DAMAGE:        { cls: "border-orange-500/25 bg-orange-500/10 text-orange-400",    label: "Damage"        },
  THEFT:         { cls: "border-red-500/25 bg-red-500/10 text-red-400",             label: "Theft"         },
};

function EventBadge({ type }) {
  const def = EVENT_BADGE_STYLES[type];
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap",
      def?.cls ?? "border-border/60 bg-muted/40 text-muted-foreground",
    )}>
      {def?.label ?? (type ?? "—").replace(/_/g, " ")}
    </span>
  );
}

// ── Qty change cell ───────────────────────────────────────────────────────────
function QtyChange({ value, measurementType, unitType }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const v = parseFloat(value);
  if (v === 0) return <span className="text-xs text-muted-foreground">±0</span>;
  return (
    <span className={cn("text-xs font-bold tabular-nums", v > 0 ? "text-emerald-400" : "text-rose-400")}>
      {v > 0 ? "+" : ""}{formatQuantity(v, measurementType, unitType)}
    </span>
  );
}

// ── Movement history table ────────────────────────────────────────────────────
function MovementHistoryTable({ itemId, storeId, measurementType, unitType }) {
  const [page,      setPage]      = useState(1);
  const [dateFrom,  setDateFrom]  = useState("");
  const [dateTo,    setDateTo]    = useState("");
  const [eventType, setEventType] = useState("");

  const handleFromChange = (v) => { setDateFrom(v);  setPage(1); };
  const handleToChange   = (v) => { setDateTo(v);    setPage(1); };
  const handleTypeChange = (v) => { setEventType(v === "ALL" ? "" : v); setPage(1); };
  const clearAll         = ()  => { setDateFrom(""); setDateTo(""); setEventType(""); setPage(1); };

  const hasFilter = dateFrom || dateTo || eventType;

  const { movements, total, totalPages, isLoading, error } = useMovementHistory(storeId, {
    page,
    limit:     15,
    itemId,
    eventType: eventType || undefined,
    dateFrom:  dateFrom  || undefined,
    dateTo:    dateTo    || undefined,
  });

  const [selected, setSelected] = useState(null);

  const columns = useMemo(() => [
    {
      key:      "performed_at",
      header:   "Date & Time",
      sortable: true,
      width:    "148px",
      render:   (row) => (
        <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
          {formatDateTime(row.performed_at)}
        </span>
      ),
    },
    {
      key:    "event_type",
      header: "Event",
      width:  "126px",
      render: (row) => <EventBadge type={row.event_type} />,
    },
    {
      key:    "event_description",
      header: "Description",
      render: (row) => (
        <span className="text-xs text-foreground truncate block max-w-[260px]">
          {row.event_description ?? "—"}
        </span>
      ),
    },
    {
      key:    "quantity_change",
      header: "Qty Δ",
      align:  "right",
      width:  "90px",
      render: (row) => (
        <QtyChange value={row.quantity_change} measurementType={measurementType} unitType={unitType} />
      ),
    },
    {
      key:    "performed_by_username",
      header: "By",
      width:  "100px",
      render: (row) => (
        <span className="text-xs text-muted-foreground truncate block">{row.performed_by_username ?? "—"}</span>
      ),
    },
  ], [measurementType, unitType]);

  return (
    <>
      <div>
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border bg-muted/10">
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
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
            <button
              type="button"
              onClick={clearAll}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" /> Clear all
            </button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {total} event{total !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 text-xs text-destructive border-b border-border">
            {String(error)}
          </div>
        )}

        {/* Table */}
        <DataTable
          columns={columns}
          data={movements}
          isLoading={isLoading}
          rowKey="id"
          onRowClick={(row) => setSelected(row)}
          pagination={{
            page,
            pageSize: 15,
            total,
            onPageChange: setPage,
          }}
          emptyState={
            <EmptyState
              icon={History}
              title={hasFilter ? "No matching movements" : "No movements recorded yet"}
              description={
                hasFilter
                  ? "Try adjusting or clearing the filters."
                  : "Stock movements for this item will appear here."
              }
              compact
            />
          }
        />
      </div>

      {/* Movement detail drawer */}
      {selected && (
        <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
          <SheetContent
            side="right"
            className="w-full sm:max-w-md bg-card border-l border-border p-0 flex flex-col"
          >
            <div className="h-[3px] w-full bg-primary shrink-0" />

            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-border shrink-0">
              <SheetHeader className="gap-2">
                <div className="flex flex-col gap-1.5">
                  <EventBadge type={selected.event_type} />
                  <SheetTitle className="text-[15px] font-bold leading-tight">
                    {selected.event_description ?? "Movement Details"}
                  </SheetTitle>
                </div>
                <SheetDescription className="text-[11px] text-muted-foreground tabular-nums">
                  {formatDateTime(selected.performed_at)}
                </SheetDescription>
              </SheetHeader>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

              {/* Notes */}
              {selected.notes && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Notes</p>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-line bg-muted/30 rounded-lg px-3 py-2.5 border border-border/60">
                    {selected.notes}
                  </p>
                </div>
              )}

              {/* Qty */}
              {selected.quantity_change != null && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Quantity</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[[
                      "Change",
                      formatQuantity(parseFloat(selected.quantity_change), measurementType, unitType),
                      parseFloat(selected.quantity_change) > 0 ? "text-emerald-400" : parseFloat(selected.quantity_change) < 0 ? "text-rose-400" : "text-muted-foreground",
                      true,
                    ], [
                      "Before",
                      selected.quantity_before != null ? formatQuantity(parseFloat(selected.quantity_before), measurementType, unitType) : null,
                      "text-foreground",
                      false,
                    ], [
                      "After",
                      selected.quantity_after != null ? formatQuantity(parseFloat(selected.quantity_after), measurementType, unitType) : null,
                      "text-foreground",
                      false,
                    ]].filter(([, v]) => v != null).map(([label, value, color, showSign]) => (
                      <div key={label} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center">
                        <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                        <p className={cn("text-base font-bold tabular-nums", color)}>
                          {showSign && parseFloat(selected.quantity_change) > 0 ? "+" : ""}{value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Metadata</p>
                <div className="rounded-lg border border-border/60 bg-muted/20 divide-y divide-border/40">
                  {selected.reference_id && (
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-[11px] text-muted-foreground">{selected.reference_type ?? "Reference"}</span>
                      <span className="font-mono text-[11px] text-foreground">{selected.reference_id}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">Performed by</span>
                    <span className="text-[11px] font-medium text-foreground">{selected.performed_by_username ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">Date & time</span>
                    <span className="text-[11px] tabular-nums text-foreground">{formatDateTime(selected.performed_at)}</span>
                  </div>
                </div>
              </div>

            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

// ── InventoryItemDetail ───────────────────────────────────────────────────────
export function InventoryItemDetail({ itemId }) {
  const navigate  = useNavigate();
  const storeId   = useBranchStore((s) => s.activeStore?.id);
  const [restockOpen,    setRestockOpen]    = useState(false);
  const [adjustOpen,     setAdjustOpen]     = useState(false);
  const [imgPreviewOpen, setImgPreviewOpen] = useState(false);

  const { detail, isLoading, error, restock, adjust } = useInventoryItem(itemId, storeId);
  const { isPinned, toggle: favToggle } = useFavourites();

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (error)     return <div className="p-6 text-sm text-destructive">{String(error)}</div>;
  if (!detail)   return <div className="p-6 text-sm text-muted-foreground">Item not found.</div>;

  const pinned = isPinned(itemId);

  const item     = detail;
  const mt       = item.measurement_type ?? "quantity";
  const ut       = item.unit_type ?? null;
  const qty      = parseFloat(item.quantity ?? 0);
  const avail    = parseFloat(item.available_quantity ?? 0);
  const reserved = parseFloat(item.reserved_quantity ?? 0);
  const minLevel = item.min_stock_level ?? 0;
  const maxLevel = item.max_stock_level ?? 1000;
  const isLow    = minLevel > 0 && qty <= minLevel;
  const isOut    = qty === 0;
  const pct      = maxLevel > 0 ? Math.min((qty / maxLevel) * 100, 100) : 0;

  return (
    <>
      <PageHeader
        backHref="/inventory"
        title={item.item_name ?? "Item Detail"}
        description={`SKU: ${item.sku ?? "—"}${item.barcode ? ` · ${item.barcode}` : ""}`}
        badge={
          <div className="flex items-center gap-1.5">
            {pinned && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                <Star className="h-2.5 w-2.5 fill-amber-400" /> Quick Access
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
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <CheckCircle2 className="h-2.5 w-2.5" /> Normal
              </span>
            )}
          </div>
        }
        action={
          <div className="flex items-center gap-1.5">
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
            >
              <Star className={cn("h-3.5 w-3.5", pinned && "fill-amber-400")} />
              {pinned ? "In Quick Access" : "Quick Access"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/products/${itemId}`)}>
              View Item <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => setRestockOpen(true)}>
              <RefreshCw className="h-3.5 w-3.5" /> Restock
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
              <BarChart3 className="h-3.5 w-3.5" /> Adjust
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-5 space-y-5">

          {/* Stock overview */}
          <div className="rounded-xl border border-border bg-card p-5">
            {/* Header with image */}
            <div className="flex items-center gap-3 mb-4">
              <div className="relative group shrink-0">
                <ItemImage item={item} size="lg" rounded="lg" />
                {item.image_data && (
                  <button
                    type="button"
                    onClick={() => setImgPreviewOpen(true)}
                    className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 group-hover:bg-black/40 transition-colors"
                  >
                    <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                )}
              </div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Stock Overview</h3>
            </div>

            {isOut && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                <p className="text-xs font-semibold text-red-400">Out of Stock — Immediate restock required</p>
              </div>
            )}
            {!isOut && isLow && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <p className="text-xs font-semibold text-amber-400">
                  Low Stock — {formatQuantity(minLevel - qty, mt, ut)} below minimum ({formatQuantity(minLevel, mt, ut)})
                </p>
              </div>
            )}

            {/* Stock bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-muted-foreground">Stock Level</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatQuantity(qty, mt, ut)} / {formatQuantity(maxLevel, mt, ut)}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", isOut ? "bg-red-500" : isLow ? "bg-amber-400" : "bg-emerald-400")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "On Hand",   value: qty,      color: "text-foreground"  },
                { label: "Available", value: avail,    color: "text-emerald-400" },
                { label: "Reserved",  value: reserved, color: "text-amber-400"   },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg border border-border/60 bg-muted/20 p-3 text-center">
                  <p className={cn("text-2xl font-bold tabular-nums", color)}>{formatQuantity(value, mt, ut)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Details + Value */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Item Details</h3>
              <Separator className="bg-border" />
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ["Category",   item.category_name],
                  ["Department", item.department_name],
                  ["Cost Price", formatCurrency(parseFloat(item.cost_price ?? 0))],
                  ["Sell Price", formatPricePerUnit(parseFloat(item.selling_price ?? 0), mt, ut)],
                  ["Min Level",  formatQuantity(minLevel, mt, ut)],
                  ["Max Level",  formatQuantity(maxLevel, mt, ut)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</dt>
                    <dd className="text-foreground font-medium">{value ?? "—"}</dd>
                  </div>
                ))}
                {item.last_count_date && (
                  <div className="col-span-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Last Count</dt>
                    <dd className="text-foreground font-medium">{formatDateTime(item.last_count_date)}</dd>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Inventory Value</h3>
              <Separator className="bg-border" />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Cost Value</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">
                    {formatCurrency(qty * parseFloat(item.cost_price ?? 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Retail Value</span>
                  <span className="text-sm font-bold text-primary tabular-nums">
                    {formatCurrency(qty * parseFloat(item.selling_price ?? 0))}
                  </span>
                </div>
                <Separator className="bg-border" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Potential Profit</span>
                  <span className="text-sm font-bold text-emerald-400 tabular-nums">
                    {formatCurrency(qty * (parseFloat(item.selling_price ?? 0) - parseFloat(item.cost_price ?? 0)))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Movement history table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Movement History</h3>
              <History className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <MovementHistoryTable
              itemId={itemId}
              storeId={storeId}
              measurementType={mt}
              unitType={ut}
            />
          </div>

        </div>
      </div>

      <RestockDialog
        open={restockOpen}
        onOpenChange={setRestockOpen}
        item={item}
        mutation={restock}
      />
      <AdjustInventoryDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        item={item}
        mutation={adjust}
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
