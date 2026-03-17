// ============================================================================
// features/items/ItemsTable.jsx — Full item catalog management
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package, Plus, Search, Edit3, Archive, Power, PowerOff,
  Filter, X, ChevronDown, BarChart3, AlertTriangle, CheckCircle2,
  TrendingDown, DollarSign, Box, RefreshCw, Tag,
} from "lucide-react";

import { DataTable }    from "@/components/shared/DataTable";
import { EmptyState }   from "@/components/shared/EmptyState";
import { PageHeader }   from "@/components/shared/PageHeader";
import { Spinner }      from "@/components/shared/Spinner";
import { Button }       from "@/components/ui/button";
import { Input }        from "@/components/ui/input";
import { Badge }        from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useItems }          from "@/features/items/useItems";
import { ItemImage }         from "@/components/shared/ItemImage";
import { usePermission } from "@/hooks/usePermission";
import { ItemFormDialog } from "@/features/items/ItemFormDialog";
import { formatCurrency, formatDate, formatDecimal, formatPricePerUnit } from "@/lib/format";
import { MEASUREMENT_TYPE_OPTIONS } from "@/lib/constants";
import { cn }           from "@/lib/utils";

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, accent = "primary", trend }) {
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

// ── Filter bar ────────────────────────────────────────────────────────────────
function FilterBar({ search, onSearch, isActive, onIsActive, lowStock, onLowStock, measurementType, onMeasurementType, total, isFetching, onClear }) {
  const hasFilters = !!search || isActive !== null || lowStock || (measurementType && measurementType !== "all");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search items, SKU, barcode…"
          className="pl-8 h-8 text-xs"
        />
        {search && (
          <button onClick={() => onSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <Select value={isActive === null ? "all" : String(isActive)} onValueChange={(v) => onIsActive(v === "all" ? null : v === "true")}>
        <SelectTrigger className="w-[110px] h-8 text-xs">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="true">Active</SelectItem>
          <SelectItem value="false">Inactive</SelectItem>
        </SelectContent>
      </Select>

      <Select value={measurementType ?? "all"} onValueChange={(v) => onMeasurementType(v === "all" ? null : v)}>
        <SelectTrigger className="w-[130px] h-8 text-xs">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          {MEASUREMENT_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        onClick={() => onLowStock(!lowStock)}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 h-8 text-xs font-medium transition-all",
          lowStock
            ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
            : "border-border text-muted-foreground hover:text-foreground hover:border-border/80",
        )}
      >
        <TrendingDown className="h-3 w-3" />
        Low Stock
      </button>

      {hasFilters && (
        <button onClick={onClear} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
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

// ── Stock level badge ─────────────────────────────────────────────────────────
function StockBadge({ qty, minLevel, trackStock, unitType, measurementType }) {
  const q    = parseFloat(qty ?? 0);
  const m    = parseFloat(minLevel ?? 0);
  const unit = unitType || (measurementType === "weight" ? "kg" : measurementType === "volume" ? "L" : null);
  const disp = unit ? `${formatDecimal(q)} ${unit}` : formatDecimal(q);
  if (!trackStock) return <span className="text-xs text-muted-foreground">—</span>;
  if (q === 0)
    return <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">Out</span>;
  if (m > 0 && q <= m)
    return <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">{disp}</span>;
  return <span className="text-xs font-medium text-foreground tabular-nums">{disp}</span>;
}

// ── Archive confirm dialog ────────────────────────────────────────────────────
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
            and hidden from all product forms and POS. Existing sales history is preserved. This action
            cannot be undone from the UI.
          </DialogDescription>
          {mutation.error && (
            <p className="mb-3 text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">{String(mutation.error)}</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
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

// ── Table columns ─────────────────────────────────────────────────────────────
const buildColumns = (onEdit, onArchive, onToggle, canManage) => {
  const base = [
    {
      key: "item_name",
      header: "Item",
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <ItemImage
            item={row}
            size="sm"
            rounded="lg"
            className={cn(!row.is_active && "opacity-50")}
          />
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
      key: "category_name",
      header: "Category",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{row.category_name ?? "—"}</span>
      ),
    },
    {
      key: "selling_price",
      header: "Price",
      align: "right",
      sortable: true,
      render: (row) => (
        <div className="text-right">
          <div className="text-xs font-semibold text-foreground tabular-nums">
            {formatPricePerUnit(parseFloat(row.selling_price), row.measurement_type, row.unit_type)}
          </div>
          {row.cost_price && (
            <div className="text-[10px] text-muted-foreground tabular-nums">Cost: {formatCurrency(parseFloat(row.cost_price))}</div>
          )}
        </div>
      ),
    },
    {
      key: "quantity",
      header: "Stock",
      align: "center",
      render: (row) => <StockBadge qty={row.quantity} minLevel={row.min_stock_level} trackStock={row.track_stock} unitType={row.unit_type} measurementType={row.measurement_type} />,
    },
    {
      key: "is_active",
      header: "Status",
      align: "center",
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
      key: "updated_at",
      header: "Updated",
      sortable: true,
      render: (row) => <span className="text-[11px] text-muted-foreground tabular-nums">{formatDate(row.updated_at)}</span>,
    },
  ];

  if (!canManage) return base;

  return [
    ...base,
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
            onClick={(e) => { e.stopPropagation(); onEdit(row); }}>
            <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={row.is_active ? "Deactivate" : "Activate"}
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
    },
  ];
};

// ── ItemsTable (main export) ──────────────────────────────────────────────────
export function ItemsTable() {
  const navigate = useNavigate();
  const canCreate = usePermission("items.create");
  const canManage = usePermission("items.update");

  const [page,            setPage]           = useState(1);
  const [search,          setSearch]         = useState("");
  const [isActive,        setIsActive]       = useState(null);
  const [lowStock,        setLowStock]       = useState(false);
  const [measurementType, setMeasurementType] = useState(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);
  const [archiveOpen,setArchiveOpen]= useState(false);
  const [selected,   setSelected]   = useState(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, isActive, lowStock, measurementType]);

  const {
    storeId, items: rawItems, total, totalPages, currentPage,
    isLoading, isFetching, error, summary,
    create, update, activate, deactivate, archive,
  } = useItems({
    page, limit: 25,
    search: debouncedSearch || undefined,
    isActive,
    lowStock: lowStock || undefined,
  });

  // Client-side measurement_type filter (backend doesn't support it yet)
  const items = useMemo(() => {
    if (!measurementType) return rawItems;
    return rawItems.filter((i) => (i.measurement_type ?? "quantity") === measurementType);
  }, [rawItems, measurementType]);

  const openEdit    = useCallback((row) => { setSelected(row); setEditOpen(true);    }, []);
  const openArchive = useCallback((row) => { setSelected(row); setArchiveOpen(true); }, []);
  const openToggle  = useCallback((row) => {
    const mutation = row.is_active ? deactivate : activate;
    mutation.mutate(row.id);
  }, [activate, deactivate]);

  const columns = useMemo(
    () => buildColumns(openEdit, openArchive, openToggle, canManage),
    [openEdit, openArchive, openToggle, canManage],
  );

  if (!storeId) return (
    <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
      Select a store to manage items.
    </div>
  );

  return (
    <>
      <PageHeader
        title="Items"
        description="Manage your full product catalog — create, edit, and track all items."
        action={
          canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New Item
            </Button>
          )
        }
      />

      {/* ── Stats ─────────────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 pt-5">
          <StatCard label="Total Items"    value={summary.total_items?.toLocaleString() ?? "—"} icon={Box}       accent="primary"  />
          <StatCard label="Low Stock"      value={summary.low_stock_count?.toLocaleString() ?? "—"} icon={TrendingDown} accent="warning"  />
          <StatCard label="Out of Stock"   value={summary.out_of_stock_count?.toLocaleString() ?? "—"} icon={AlertTriangle} accent="destructive" />
          <StatCard label="Inventory Value" value={formatCurrency(parseFloat(summary.total_inventory_value ?? 0))} icon={DollarSign} accent="success" />
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="px-6 pt-4">
        <FilterBar
          search={search}                 onSearch={(v) => setSearch(v)}
          isActive={isActive}             onIsActive={setIsActive}
          lowStock={lowStock}             onLowStock={setLowStock}
          measurementType={measurementType} onMeasurementType={setMeasurementType}
          total={items.length}            isFetching={isFetching}
          onClear={() => { setSearch(""); setIsActive(null); setLowStock(false); setMeasurementType(null); }}
        />
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
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
            pagination={{
              page: currentPage,
              pageSize: 25,
              total,
              onPageChange: setPage,
            }}
          />
        )}
      </div>

      {/* Dialogs */}
      <ItemFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        initial={null}
        mutation={create}
        storeId={storeId}
      />
      {selected && (
        <ItemFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          initial={selected}
          mutation={update}
          storeId={storeId}
        />
      )}
      {selected && (
        <ArchiveDialog
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          item={selected}
          mutation={archive}
        />
      )}
    </>
  );
}
