// ============================================================================
// features/items/ItemDetailView.jsx — Full item detail page component
// ============================================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package, Edit3, Archive, Power, PowerOff, ArrowLeft,
  BarChart3, History, Boxes, Hash, Tag, DollarSign, ClipboardList,
  CheckCircle2, XCircle, AlertTriangle, TrendingDown, Clock,
  ChevronLeft, ChevronRight, RefreshCw,
} from "lucide-react";

import { PageHeader }  from "@/components/shared/PageHeader";
import { Spinner }     from "@/components/shared/Spinner";
import { Button }      from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input }       from "@/components/ui/input";
import { Separator }   from "@/components/ui/separator";

import { useItem, useItemHistory } from "@/features/items/useItems";
import { useInventoryItem }        from "@/features/inventory/useInventory";
import { AdjustInventoryDialog }   from "@/features/inventory/AdjustInventoryDialog";
import { RestockDialog }           from "@/features/inventory/RestockDialog";
import { formatCurrency, formatDecimal, formatDateTime, formatDate } from "@/lib/format";
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
function EventBadge({ type }) {
  const styles = {
    CREATE:       "border-primary/25 bg-primary/10 text-primary",
    UPDATE:       "border-sky-500/25 bg-sky-500/10 text-sky-400",
    PRICE_CHANGE: "border-violet-500/25 bg-violet-500/10 text-violet-400",
    ADJUSTMENT:   "border-amber-500/25 bg-amber-500/10 text-amber-400",
    RESTOCK:      "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    SALE:         "border-rose-500/25 bg-rose-500/10 text-rose-400",
    STOCK_COUNT:  "border-indigo-500/25 bg-indigo-500/10 text-indigo-400",
    STATUS_CHANGE:"border-border/60 bg-muted/40 text-muted-foreground",
    DAMAGE:       "border-orange-500/25 bg-orange-500/10 text-orange-400",
    THEFT:        "border-red-500/25 bg-red-500/10 text-red-400",
  };
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
      styles[type] ?? "border-border/60 bg-muted/40 text-muted-foreground",
    )}>
      {(type ?? "").replace(/_/g, " ")}
    </span>
  );
}

// ── Qty change display ────────────────────────────────────────────────────────
function QtyChange({ change }) {
  if (change == null) return <span className="text-xs text-muted-foreground">—</span>;
  const v = parseFloat(change);
  if (v === 0) return <span className="text-xs text-muted-foreground">±0</span>;
  return (
    <span className={cn("text-xs font-semibold tabular-nums", v > 0 ? "text-emerald-400" : "text-rose-400")}>
      {v > 0 ? "+" : ""}{formatDecimal(v)}
    </span>
  );
}

// ── History tab ───────────────────────────────────────────────────────────────
function HistoryTab({ itemId }) {
  const [page, setPage] = useState(1);
  const { history, total, totalPages, isLoading, error } = useItemHistory(itemId, page, 15);

  if (isLoading && !history.length) return <Spinner />;
  if (error) return <div className="text-xs text-destructive p-4">{String(error)}</div>;
  if (!history.length) return (
    <div className="py-12 text-center text-sm text-muted-foreground">No history recorded yet.</div>
  );

  return (
    <div className="space-y-0">
      {history.map((h) => (
        <div key={h.id} className="flex items-start gap-3 px-4 py-3 border-b border-border/60 last:border-0 hover:bg-muted/20 transition-colors">
          <div className="shrink-0 mt-0.5">
            <EventBadge type={h.event_type} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">{h.event_description ?? "—"}</p>
            {h.notes && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{h.notes}</p>}
            <p className="text-[10px] text-muted-foreground mt-1">
              {h.user_name ? `By ${h.user_name} · ` : ""}{formatDateTime(h.performed_at)}
            </p>
          </div>
          <div className="shrink-0 text-right space-y-0.5">
            <QtyChange change={h.quantity_change} />
            {(h.quantity_before != null || h.quantity_after != null) && (
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {formatDecimal(h.quantity_before ?? 0)} → {formatDecimal(h.quantity_after ?? 0)}
              </div>
            )}
          </div>
        </div>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border">
          <span className="text-[11px] text-muted-foreground">{total} events</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[11px] tabular-nums">{page}/{totalPages}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stock tab ─────────────────────────────────────────────────────────────────
function StockTab({ item, storeId, onRestock, onAdjust }) {
  const { detail, isLoading } = useInventoryItem(item?.id, storeId);

  if (!item?.track_stock) return (
    <div className="py-12 text-center text-sm text-muted-foreground">Stock tracking is disabled for this item.</div>
  );

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
      {/* Status banner */}
      {isOut ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
          <XCircle className="h-4 w-4 text-red-400 shrink-0" />
          <p className="text-xs font-semibold text-red-400">Out of Stock — Restock required</p>
        </div>
      ) : isLow ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-xs font-semibold text-amber-400">Low Stock — {formatDecimal(minLevel - qty)} units below minimum</p>
        </div>
      ) : null}

      {/* Stock bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-muted-foreground">Stock Level</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">{formatDecimal(qty)} / {formatDecimal(maxLevel)}</span>
        </div>
        <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", isOut ? "bg-red-500" : isLow ? "bg-amber-400" : "bg-emerald-400")}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Stock grid */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "On Hand",    value: qty,      color: "text-foreground" },
          { label: "Available",  value: avail,    color: "text-emerald-400" },
          { label: "Reserved",   value: reserved, color: "text-amber-400"  },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border/60 bg-muted/20 p-3 text-center">
            <p className={cn("text-xl font-bold tabular-nums", color)}>{formatDecimal(value)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Field label="Min Level" value={formatDecimal(minLevel)} />
        <Field label="Max Level" value={formatDecimal(maxLevel)} />
        {detail?.last_count_date && (
          <div className="col-span-2">
            <Field label="Last Count" value={formatDateTime(detail.last_count_date)} />
          </div>
        )}
      </div>

      {/* Actions */}
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
  const navigate   = useNavigate();
  const [activeTab, setActiveTab] = useState("details");
  const [editOpen,  setEditOpen]  = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restockOpen, setRestockOpen] = useState(false);
  const [adjustOpen,  setAdjustOpen]  = useState(false);

  const { item, isLoading, error, storeId, update, activate, deactivate, archive } = useItem(itemId);
  const { restock: restockMut, adjust: adjustMut } = useInventoryItem(itemId, storeId);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (error)     return <div className="p-6 text-sm text-destructive">{String(error)}</div>;
  if (!item)     return <div className="p-6 text-sm text-muted-foreground">Item not found.</div>;

  const qty    = parseFloat(item.quantity ?? 0);
  const minLvl = item.min_stock_level ?? 0;
  const isLow  = item.track_stock && minLvl > 0 && qty <= minLvl;
  const isOut  = item.track_stock && qty === 0;

  const tabs = [
    { key: "details",  label: "Details",  icon: ClipboardList },
    { key: "stock",    label: "Stock",    icon: Boxes },
    { key: "history",  label: "History",  icon: History },
  ];

  return (
    <>
      <PageHeader
        backHref="/products"
        title={item.item_name}
        description={`SKU: ${item.sku}${item.barcode ? ` · Barcode: ${item.barcode}` : ""}`}
        badge={
          <div className="flex items-center gap-1.5">
            {!item.is_active && (
              <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Inactive</span>
            )}
            {isOut && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                <XCircle className="h-2.5 w-2.5" /> Out of Stock
              </span>
            )}
            {!isOut && isLow && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                <TrendingDown className="h-2.5 w-2.5" /> Low Stock
              </span>
            )}
          </div>
        }
        action={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => item.is_active ? deactivate.mutate(itemId) : activate.mutate(itemId)}>
              {item.is_active ? <PowerOff className="h-3.5 w-3.5 text-amber-400" /> : <Power className="h-3.5 w-3.5 text-emerald-400" />}
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
              {/* Core info */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Core Information</h3>
                <Separator className="bg-border" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="SKU"           value={item.sku}        mono />
                  <Field label="Barcode"        value={item.barcode}    mono />
                  <Field label="Category"       value={item.category_name} />
                  <Field label="Department"     value={item.department_name} />
                  <Field label="Branch"         value={item.branch_name} />
                  <Field label="Unit Type"      value={item.unit_type} />
                  <div className="col-span-2">
                    <Field label="Description"  value={item.description} />
                  </div>
                  <Field label="Created"        value={formatDate(item.created_at)} />
                  <Field label="Last Updated"   value={formatDate(item.updated_at)} />
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
                      {item.selling_price > 0 ? (((item.selling_price - item.cost_price) / item.selling_price) * 100).toFixed(1) + "%" : "—"}
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
                    ["Active",          item.is_active],
                    ["Sellable",        item.sellable],
                    ["Available for POS",item.available_for_pos],
                    ["Track Stock",     item.track_stock],
                    ["Taxable",         item.taxable],
                    ["Allow Discount",  item.allow_discount],
                    ["Requires Weight", item.requires_weight],
                    ["Allow Neg. Stock",item.allow_negative_stock],
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
                  item={item}
                  storeId={storeId}
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
              <HistoryTab itemId={itemId} />
            </div>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      {item && (
        <Dialog open={editOpen} onOpenChange={(v) => !update.isPending && setEditOpen(v)}>
          <DialogContent className="max-w-lg border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
            <div className="h-[3px] w-full bg-primary" />
            <div className="px-6 pt-5 pb-6">
              <DialogHeader className="mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                    <Edit3 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <DialogTitle className="text-[15px] font-bold">Edit {item.item_name}</DialogTitle>
                    <DialogDescription className="text-[11px] text-muted-foreground">Update item details.</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <QuickEditForm item={item} mutation={update} onClose={() => setEditOpen(false)} />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Archive dialog */}
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
              {archive.error && <p className="text-xs text-destructive">{String(archive.error)}</p>}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={archive.isPending} onClick={() => setArchiveOpen(false)}>Cancel</Button>
                <Button variant="destructive" className="flex-1" disabled={archive.isPending}
                  onClick={() => archive.mutate(itemId, { onSuccess: () => navigate("/products") })}>
                  {archive.isPending ? "Archiving…" : "Archive"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Restock dialog */}
      <RestockDialog
        open={restockOpen}
        onOpenChange={setRestockOpen}
        item={item}
        mutation={restockMut}
      />

      {/* Adjust dialog */}
      <AdjustInventoryDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        item={item}
        mutation={adjustMut}
      />
    </>
  );
}

// ── Quick edit form ───────────────────────────────────────────────────────────
function QuickEditForm({ item, mutation, onClose }) {
  const [form, setForm] = useState({
    item_name:     item.item_name     ?? "",
    sku:           item.sku           ?? "",
    barcode:       item.barcode       ?? "",
    description:   item.description   ?? "",
    cost_price:    parseFloat(item.cost_price)    || 0,
    selling_price: parseFloat(item.selling_price) || 0,
    discount_price: parseFloat(item.discount_price) || "",
    min_stock_level: item.min_stock_level ?? 5,
    max_stock_level: item.max_stock_level ?? 1000,
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      ...form,
      cost_price:    parseFloat(form.cost_price) || 0,
      selling_price: parseFloat(form.selling_price) || 0,
      discount_price: form.discount_price !== "" ? parseFloat(form.discount_price) : null,
      min_stock_level: parseInt(form.min_stock_level) || 0,
      max_stock_level: parseInt(form.max_stock_level) || 1000,
    };
    mutation.mutate(payload, { onSuccess: onClose });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-foreground mb-1.5">Item Name</label>
        <Input value={form.item_name} onChange={set("item_name")} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">SKU</label>
          <Input value={form.sku} onChange={set("sku")} required />
        </div>
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Barcode</label>
          <Input value={form.barcode} onChange={set("barcode")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Cost Price</label>
          <Input type="number" min={0} step="0.01" value={form.cost_price} onChange={set("cost_price")} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Selling Price</label>
          <Input type="number" min={0} step="0.01" value={form.selling_price} onChange={set("selling_price")} />
        </div>
      </div>
      {mutation.error && (
        <p className="text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">{String(mutation.error)}</p>
      )}
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" disabled={mutation.isPending} onClick={onClose}>Cancel</Button>
        <Button type="submit" className="flex-1" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
