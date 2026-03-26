// ============================================================================
// features/items/ItemsTable.jsx — Full item catalog management
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package, Plus, Search, Edit3, Archive, Power, PowerOff,
  X, TrendingDown, DollarSign, Box, RefreshCw, Tag, Percent,
  PackagePlus, ChevronDown, Check, Minus, AlertTriangle, Printer,
  Layers, FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";

import { DataTable }    from "@/components/shared/DataTable";
import { EmptyState }   from "@/components/shared/EmptyState";
import { PageHeader }   from "@/components/shared/PageHeader";
import { Button }       from "@/components/ui/button";
import { Input }        from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useItems }                  from "@/features/items/useItems";
import { useBulkOperations }         from "@/features/bulk_operations/useBulkOperations";
import { BulkPriceUpdateDialog }     from "@/features/bulk_operations/BulkPriceUpdateDialog";
import { BulkDiscountDialog }        from "@/features/bulk_operations/BulkDiscountDialog";
import { BulkStockAdjustDialog }     from "@/features/bulk_operations/BulkStockAdjustDialog";
import { PrintLabelsDialog }         from "@/features/labels/PrintLabelsDialog";
import { BulkPrintLabelsDialog }     from "@/features/labels/BulkPrintLabelsDialog";
import { ItemImage }                 from "@/components/shared/ItemImage";
import { usePermission }             from "@/hooks/usePermission";
import { ItemFormDialog }              from "@/features/items/ItemFormDialog";
import { ExcelImportExportDialog }    from "@/features/items/ExcelImportExportDialog";
import {
  formatCurrency, formatDate, formatDecimal, formatPricePerUnit,
} from "@/lib/format";
import { MEASUREMENT_TYPE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, accent = "primary" }) {
  const accents = {
    primary:     "border-primary/20 bg-primary/5 text-primary",
    success:     "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    warning:     "border-amber-500/20 bg-amber-500/5 text-amber-400",
    destructive: "border-red-500/20 bg-red-500/5 text-red-400",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", accents[accent])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-lg font-bold text-foreground tabular-nums mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter bar
// ─────────────────────────────────────────────────────────────────────────────
function FilterBar({
  search, onSearch, isActive, onIsActive,
  lowStock, onLowStock, measurementType, onMeasurementType,
  total, isFetching, onClear,
}) {
  const hasFilters = !!search || isActive !== null || lowStock || !!measurementType;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input value={search} onChange={(e) => onSearch(e.target.value)}
          placeholder="Search items, SKU, barcode…" className="pl-8 h-8 text-xs" />
        {search && (
          <button onClick={() => onSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <Select value={isActive === null ? "all" : String(isActive)}
        onValueChange={(v) => onIsActive(v === "all" ? null : v === "true")}>
        <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="true">Active</SelectItem>
          <SelectItem value="false">Inactive</SelectItem>
        </SelectContent>
      </Select>

      <Select value={measurementType ?? "all"} onValueChange={(v) => onMeasurementType(v === "all" ? null : v)}>
        <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
        <SelectContent>
          {MEASUREMENT_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button onClick={() => onLowStock(!lowStock)}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 h-8 text-xs font-medium transition-all",
          lowStock
            ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
            : "border-border text-muted-foreground hover:text-foreground",
        )}>
        <TrendingDown className="h-3 w-3" />Low Stock
      </button>

      {hasFilters && (
        <button onClick={onClear}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3 w-3" /> Clear
        </button>
      )}

      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums flex items-center gap-1.5">
        {isFetching && <RefreshCw className="h-3 w-3 animate-spin" />}
        {total} items
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row checkbox
// ─────────────────────────────────────────────────────────────────────────────
function Checkbox({ checked, indeterminate = false, onChange }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
        checked || indeterminate
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:border-primary/60",
      )}
    >
      {indeterminate ? <Minus className="h-2.5 w-2.5" /> : checked ? <Check className="h-2.5 w-2.5" /> : null}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating bulk selection bar
// Shows when ≥1 row is selected. Includes: Activate, Deactivate,
// Adjust Stock, Print Labels, and a clear button.
// ─────────────────────────────────────────────────────────────────────────────
function BulkSelectionBar({
  count,
  onActivate, onDeactivate, onStockAdjust, onPrintLabels, onClear,
  activating, deactivating,
}) {
  if (count === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-border bg-card/95 backdrop-blur-sm px-4 py-2.5 shadow-2xl shadow-black/40 animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Count badge */}
      <div className="flex items-center gap-2 pr-3 border-r border-border">
        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[9px] font-bold text-primary-foreground tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
        <span className="text-xs font-semibold text-foreground whitespace-nowrap">
          {count} item{count !== 1 ? "s" : ""} selected
        </span>
      </div>

      {/* Activate */}
      <Button size="sm" disabled={activating} onClick={onActivate}
        className="h-7 gap-1.5 text-xs px-2.5 bg-success hover:bg-success/90 text-white">
        {activating ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
        Activate
      </Button>

      {/* Deactivate */}
      <Button size="sm" variant="outline" disabled={deactivating} onClick={onDeactivate}
        className="h-7 gap-1.5 text-xs px-2.5 border-warning/40 text-warning hover:bg-warning/10">
        {deactivating ? <RefreshCw className="h-3 w-3 animate-spin" /> : <PowerOff className="h-3 w-3" />}
        Deactivate
      </Button>

      {/* Adjust Stock */}
      <Button size="sm" variant="outline" onClick={onStockAdjust}
        className="h-7 gap-1.5 text-xs px-2.5">
        <PackagePlus className="h-3 w-3" />Adjust Stock
      </Button>

      {/* ── Print Labels (selection-based) ── */}
      <Button size="sm" variant="outline" onClick={onPrintLabels}
        className="h-7 gap-1.5 text-xs px-2.5 border-primary/30 text-primary hover:bg-primary/10">
        <Printer className="h-3 w-3" />Print Labels
      </Button>

      {/* Clear */}
      <button onClick={onClear}
        className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        title="Clear selection">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Actions dropdown (header level — scope-based operations)
// ─────────────────────────────────────────────────────────────────────────────
function BulkActionsMenu({ onPriceUpdate, onDiscount, onPrintLabels }) {
  const [open, setOpen] = useState(false);

  const menuItems = [
    {
      label:    "Bulk Price Update",
      desc:     "Reprice by % or fixed amount",
      icon:     Tag,
      iconBg:   "bg-primary/10 border-primary/20",
      iconCol:  "text-primary",
      onClick:  onPriceUpdate,
    },
    {
      label:    "Apply Discount",
      desc:     "Set discount % or clear all",
      icon:     Percent,
      iconBg:   "bg-success/10 border-success/20",
      iconCol:  "text-success",
      onClick:  onDiscount,
    },
    {
      label:    "Print Labels",
      desc:     "Print for whole category / dept",
      icon:     Printer,
      iconBg:   "bg-primary/10 border-primary/20",
      iconCol:  "text-primary",
      onClick:  onPrintLabels,
      separator: true,  // visual divider above this item
    },
  ];

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} className="gap-1.5">
        <Tag className="h-3.5 w-3.5" />
        Bulk Actions
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-muted/20">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Category / Dept Scope
              </p>
            </div>
            {menuItems.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={item.label}>
                  {item.separator && <div className="border-t border-border/60" />}
                  <button
                    onClick={() => { setOpen(false); item.onClick(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs hover:bg-muted/50 transition-colors">
                    <div className={cn("flex h-6 w-6 items-center justify-center rounded-md border", item.iconBg)}>
                      <Icon className={cn("h-3 w-3", item.iconCol)} />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock level badge
// ─────────────────────────────────────────────────────────────────────────────
function StockBadge({ qty, minLevel, trackStock }) {
  const q = parseFloat(qty ?? 0);
  const m = parseFloat(minLevel ?? 0);
  const d = formatDecimal(q);
  if (!trackStock) return <span className="text-xs text-muted-foreground">—</span>;
  if (q === 0)
    return <span className="inline-flex rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">Out</span>;
  if (m > 0 && q <= m)
    return <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">{d}</span>;
  return <span className="text-xs font-medium text-foreground tabular-nums">{d}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Archive confirm dialog
// ─────────────────────────────────────────────────────────────────────────────
function ArchiveDialog({ open, onOpenChange, item, mutation }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="px-6 pt-5 pb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
              <Archive className="h-4 w-4 text-destructive" />
            </div>
            <DialogTitle className="text-[15px] font-bold text-foreground">Archive item?</DialogTitle>
          </div>
          <DialogDescription className="text-[11px] text-muted-foreground leading-relaxed mb-4">
            <span className="font-semibold text-foreground">{item?.item_name}</span> will be archived
            and hidden from all product forms and POS. Existing sales history is preserved.
          </DialogDescription>
          {mutation.error && (
            <p className="mb-3 text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">
              {String(mutation.error)}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" disabled={mutation.isPending}
              onClick={() => mutation.mutate(item.id, { onSuccess: () => onOpenChange(false) })}>
              {mutation.isPending ? "Archiving…" : "Archive"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Table column factory
// ─────────────────────────────────────────────────────────────────────────────
function buildColumns({
  onEdit, onArchive, onToggle, onPrintLabels, canManage,
  selectedIds, onToggleRow, onToggleAll, allSelected, someSelected,
}) {
  const checkboxCol = {
    key: "__chk__",
    width: "40px",
    header: (
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected && !allSelected}
        onChange={onToggleAll}
      />
    ),
    render: (row) => (
      <Checkbox checked={selectedIds.has(row.id)} onChange={() => onToggleRow(row.id)} />
    ),
  };

  const dataCols = [
    {
      key: "item_name", header: "Item", sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <ItemImage item={row} size="sm" rounded="lg" className={cn(!row.is_active && "opacity-50")} />
          <div className="min-w-0">
            <div className={cn("text-xs font-semibold leading-tight", !row.is_active && "text-muted-foreground line-through")}>
              {row.item_name}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] font-mono text-muted-foreground">{row.sku}</span>
              {row.barcode && <span className="text-[10px] text-muted-foreground/60">· {row.barcode}</span>}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "category_name", header: "Category",
      render: (row) => <span className="text-xs text-muted-foreground">{row.category_name ?? "—"}</span>,
    },
    {
      key: "selling_price", header: "Price", align: "right", sortable: true,
      render: (row) => (
        <div className="text-right">
          <div className="text-xs font-semibold text-foreground tabular-nums">
            {formatPricePerUnit(parseFloat(row.selling_price), row.measurement_type, row.unit_type)}
          </div>
          {row.discount_price && (
            <div className="text-[10px] text-success tabular-nums">
              Sale: {formatCurrency(parseFloat(row.discount_price))}
            </div>
          )}
          {!row.discount_price && row.cost_price && (
            <div className="text-[10px] text-muted-foreground tabular-nums">
              Cost: {formatCurrency(parseFloat(row.cost_price))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "quantity", header: "Stock", align: "center",
      render: (row) => (
        <StockBadge qty={row.quantity} minLevel={row.min_stock_level} trackStock={row.track_stock} />
      ),
    },
    {
      key: "is_active", header: "Status", align: "center",
      render: (row) => (
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
          row.is_active
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
            : "border-border/60 bg-muted text-muted-foreground",
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", row.is_active ? "bg-emerald-400" : "bg-muted-foreground/40")} />
          {row.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "updated_at", header: "Updated", sortable: true,
      render: (row) => (
        <span className="text-[11px] text-muted-foreground">{formatDate(row.updated_at)}</span>
      ),
    },
  ];

  const actionCol = canManage ? [{
    key: "actions", header: "", align: "right",
    render: (row) => (
      <div className="flex items-center justify-end gap-0.5">
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Print Labels"
          onClick={(e) => { e.stopPropagation(); onPrintLabels(row); }}>
          <Printer className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
          onClick={(e) => { e.stopPropagation(); onEdit(row); }}>
          <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7"
          title={row.is_active ? "Deactivate" : "Activate"}
          onClick={(e) => { e.stopPropagation(); onToggle(row); }}>
          {row.is_active
            ? <PowerOff className="h-3.5 w-3.5 text-amber-400" />
            : <Power    className="h-3.5 w-3.5 text-emerald-400" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Archive"
          onClick={(e) => { e.stopPropagation(); onArchive(row); }}>
          <Archive className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
    ),
  }] : [];

  return [checkboxCol, ...dataCols, ...actionCol];
}

// ─────────────────────────────────────────────────────────────────────────────
// ItemsTable — main export
// ─────────────────────────────────────────────────────────────────────────────
export function ItemsTable() {
  const navigate  = useNavigate();
  const canCreate = usePermission("items.create");
  const canManage = usePermission("items.update");

  // ── Filters ───────────────────────────────────────────────────────────────
  const [page,            setPage]            = useState(1);
  const [search,          setSearch]          = useState("");
  const [isActive,        setIsActive]        = useState(null);
  const [lowStock,        setLowStock]        = useState(false);
  const [measurementType, setMeasurementType] = useState(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, isActive, lowStock, measurementType]);

  // ── Dialog open states ────────────────────────────────────────────────────
  const [createOpen,        setCreateOpen]        = useState(false);
  const [editOpen,          setEditOpen]          = useState(false);
  const [archiveOpen,       setArchiveOpen]       = useState(false);
  const [bulkPriceOpen,     setBulkPriceOpen]     = useState(false);
  const [bulkDiscOpen,      setBulkDiscOpen]      = useState(false);
  const [bulkStockOpen,     setBulkStockOpen]     = useState(false);
  // Row-level: single item print
  const [printTarget,       setPrintTarget]       = useState(null);
  // Selection-based bulk print (selected rows → PrintLabelsDialog)
  const [bulkPrintOpen,     setBulkPrintOpen]     = useState(false);
  // Scope-based bulk print (category/dept → BulkPrintLabelsDialog)
  const [scopePrintOpen,    setScopePrintOpen]    = useState(false);
  const [excelOpen,         setExcelOpen]         = useState(false);
  const [selected,          setSelected]          = useState(null);

  // ── Row selection ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());

  const toggleRow = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Data ──────────────────────────────────────────────────────────────────
  const {
    storeId, items, total, totalPages, currentPage,
    isLoading, isFetching, error, summary,
    create, update, activate, deactivate, archive,
  } = useItems({
    page, limit: 25,
    search:          debouncedSearch || undefined,
    isActive,
    lowStock:        lowStock        || undefined,
    measurementType: measurementType ?? undefined,
  });

  // Clear selection on filter / page change
  useEffect(() => { clearSelection(); }, [page, debouncedSearch, isActive, lowStock, measurementType, clearSelection]);

  // ── Select-all for current page ───────────────────────────────────────────
  const pageIds      = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const allSelected  = pageIds.size > 0 && [...pageIds].every((id) => selectedIds.has(id));
  const someSelected = [...pageIds].some((id) => selectedIds.has(id));

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageIds.forEach((id) => n.delete(id)); return n; });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...pageIds]));
    }
  }, [allSelected, pageIds]);

  // Full item objects for selected IDs (needed by PrintLabelsDialog + BulkStockAdjust)
  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );

  // ── Bulk toggle ───────────────────────────────────────────────────────────
  const { activateItems, deactivateItems } = useBulkOperations();

  const handleBulkActivate = async () => {
    if (!selectedIds.size) return;
    try {
      const result = await activateItems.mutateAsync({ item_ids: [...selectedIds] });
      toast.success(result?.message ?? `${result?.affected ?? selectedIds.size} item(s) activated.`);
      clearSelection();
    } catch (e) {
      toast.error(typeof e === "string" ? e : e?.message ?? "Bulk activate failed.");
    }
  };

  const handleBulkDeactivate = async () => {
    if (!selectedIds.size) return;
    try {
      const result = await deactivateItems.mutateAsync({ item_ids: [...selectedIds] });
      toast.success(result?.message ?? `${result?.affected ?? selectedIds.size} item(s) deactivated.`);
      clearSelection();
    } catch (e) {
      toast.error(typeof e === "string" ? e : e?.message ?? "Bulk deactivate failed.");
    }
  };

  // ── Row callbacks ─────────────────────────────────────────────────────────
  const openEdit        = useCallback((row) => { setSelected(row); setEditOpen(true);    }, []);
  const openArchive     = useCallback((row) => { setSelected(row); setArchiveOpen(true); }, []);
  const openPrintLabels = useCallback((row) => { setPrintTarget(row);                    }, []);
  const openToggle      = useCallback((row) => {
    (row.is_active ? deactivate : activate).mutate(row.id);
  }, [activate, deactivate]);

  // ── Columns ───────────────────────────────────────────────────────────────
  const columns = useMemo(() => buildColumns({
    onEdit: openEdit, onArchive: openArchive,
    onToggle: openToggle, onPrintLabels: openPrintLabels,
    canManage,
    selectedIds, onToggleRow: toggleRow, onToggleAll: toggleAll,
    allSelected, someSelected,
  }), [
    openEdit, openArchive, openToggle, openPrintLabels, canManage,
    selectedIds, toggleRow, toggleAll, allSelected, someSelected,
  ]);

  if (!storeId) return (
    <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
      Select a store to manage items.
    </div>
  );

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <PageHeader
        title="Items"
        description="Manage your full product catalog — create, edit, and track all items."
        action={
          <div className="flex items-center gap-2">
            {canManage && (
              <BulkActionsMenu
                onPriceUpdate={() => setBulkPriceOpen(true)}
                onDiscount={()    => setBulkDiscOpen(true)}
                onPrintLabels={()  => setScopePrintOpen(true)}
              />
            )}
            <Button variant="outline" size="sm" onClick={() => setExcelOpen(true)} className="gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Import / Export
            </Button>
            {canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />New Item
              </Button>
            )}
          </div>
        }
      />

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 pt-5">
          <StatCard label="Total Items"
            value={summary.total_items?.toLocaleString() ?? "—"}
            icon={Box} accent="primary" />
          <StatCard label="Low Stock"
            value={summary.low_stock_count?.toLocaleString() ?? "—"}
            icon={TrendingDown} accent="warning" />
          <StatCard label="Out of Stock"
            value={summary.out_of_stock_count?.toLocaleString() ?? "—"}
            icon={AlertTriangle} accent="destructive" />
          <StatCard label="Inventory Value"
            value={formatCurrency(parseFloat(summary.total_inventory_value ?? 0))}
            icon={DollarSign} accent="success" />
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="px-6 pt-4">
        <FilterBar
          search={search}                   onSearch={setSearch}
          isActive={isActive}               onIsActive={setIsActive}
          lowStock={lowStock}               onLowStock={setLowStock}
          measurementType={measurementType} onMeasurementType={setMeasurementType}
          total={total}                   isFetching={isFetching}
          onClear={() => { setSearch(""); setIsActive(null); setLowStock(false); setMeasurementType(null); }}
        />
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="px-6 pt-3 pb-6">
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {typeof error === "string" ? error : "Unable to load items."}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={items}
            isLoading={isLoading}
            rowKey="id"
            onRowClick={(row) => navigate(`/products/${row.id}`)}
            emptyState={
              <EmptyState
                icon={Package}
                title={debouncedSearch ? "No items found" : lowStock ? "No low-stock items" : "No items yet"}
                description={debouncedSearch ? `No items match "${debouncedSearch}".` : "Add your first item to start selling."}
                compact
              />
            }
            pagination={{ page: currentPage, pageSize: 25, total, onPageChange: setPage }}
          />
        )}
      </div>

      {/* ── Floating bulk selection bar ──────────────────────────────────── */}
      {canManage && (
        <BulkSelectionBar
          count={selectedIds.size}
          onActivate={handleBulkActivate}
          onDeactivate={handleBulkDeactivate}
          onStockAdjust={() => setBulkStockOpen(true)}
          onPrintLabels={() => setBulkPrintOpen(true)}
          onClear={clearSelection}
          activating={activateItems.isPending}
          deactivating={deactivateItems.isPending}
        />
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      <ItemFormDialog
        open={createOpen} onOpenChange={setCreateOpen}
        mode="create" initial={null} mutation={create} storeId={storeId}
      />
      {selected && (
        <ItemFormDialog
          open={editOpen} onOpenChange={setEditOpen}
          mode="edit" initial={selected} mutation={update} storeId={storeId}
        />
      )}
      {selected && (
        <ArchiveDialog
          open={archiveOpen} onOpenChange={setArchiveOpen}
          item={selected} mutation={archive}
        />
      )}

      {/* Scope-based price / discount */}
      <BulkPriceUpdateDialog open={bulkPriceOpen} onOpenChange={setBulkPriceOpen} />
      <BulkDiscountDialog    open={bulkDiscOpen}  onOpenChange={setBulkDiscOpen}  />

      {/* Selection-based stock adjust */}
      <BulkStockAdjustDialog
        open={bulkStockOpen}
        onOpenChange={(val) => { setBulkStockOpen(val); if (!val) clearSelection(); }}
        selectedItems={selectedItems}
      />

      {/* ── Label print dialogs ───────────────────────────────────────────
          Three entry points:
          1. Row action (Printer icon)     → single item   → PrintLabelsDialog
          2. BulkSelectionBar (Print Labs) → selected items → PrintLabelsDialog
          3. BulkActionsMenu  (Print Labs) → category/dept  → BulkPrintLabelsDialog
      ── */}

      {/* 1. Single row print */}
      <PrintLabelsDialog
        open={!!printTarget}
        onOpenChange={(val) => { if (!val) setPrintTarget(null); }}
        items={printTarget ? [printTarget] : []}
      />

      {/* 2. Multi-selection print */}
      <PrintLabelsDialog
        open={bulkPrintOpen}
        onOpenChange={(val) => { setBulkPrintOpen(val); if (!val) clearSelection(); }}
        items={selectedItems}
      />

      {/* 3. Scope-based (category / department) print */}
      <BulkPrintLabelsDialog
        open={scopePrintOpen}
        onOpenChange={setScopePrintOpen}
      />

      {/* Excel import / export */}
      <ExcelImportExportDialog
        open={excelOpen}
        onOpenChange={setExcelOpen}
        storeId={storeId}
      />
    </>
  );
}
