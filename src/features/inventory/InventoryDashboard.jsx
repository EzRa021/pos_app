// ============================================================================
// features/inventory/InventoryDashboard.jsx — Main inventory page
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes, Search, X, TrendingDown, AlertTriangle, DollarSign,
  BarChart3, Package, RefreshCw, Filter, ArrowUpDown, Plus,
  CheckCircle2, ClipboardList, Star,
} from "lucide-react";

import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Spinner }    from "@/components/shared/Spinner";
import { Button }     from "@/components/ui/button";
import { Input }      from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useInventory }          from "@/features/inventory/useInventory";
import { useFavourites }         from "@/features/pos/useFavourites";
import { ItemImage }             from "@/components/shared/ItemImage";
import { RestockDialog }         from "@/features/inventory/RestockDialog";
import { AdjustInventoryDialog } from "@/features/inventory/AdjustInventoryDialog";
import { formatCurrency, formatQuantity, formatPricePerUnit, formatDate } from "@/lib/format";
import { MEASUREMENT_TYPE_OPTIONS } from "@/lib/constants";
import { cn }                    from "@/lib/utils";

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, accent = "primary" }) {
  const rings = {
    primary:     "border-primary/20 bg-primary/5 text-primary",
    success:     "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    warning:     "border-amber-500/20 bg-amber-500/5 text-amber-400",
    destructive: "border-red-500/20 bg-red-500/5 text-red-400",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", rings[accent])}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// ── Stock status badge ────────────────────────────────────────────────────────
function StockStatusBadge({ status }) {
  const styles = {
    low:    "border-amber-500/30 bg-amber-500/10 text-amber-400",
    high:   "border-sky-500/30 bg-sky-500/10 text-sky-400",
    normal: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  };
  const labels = { low: "Low", high: "High", normal: "Normal" };
  const s = status ?? "normal";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", styles[s] ?? styles.normal)}>
      {labels[s] ?? s}
    </span>
  );
}

// ── InventoryDashboard ────────────────────────────────────────────────────────
export function InventoryDashboard() {
  const navigate = useNavigate();

  const [page,            setPage]            = useState(1);
  const [search,          setSearch]          = useState("");
  const [lowStock,        setLowStock]        = useState(false);
  const [measurementType, setMeasurementType] = useState(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [restockItem, setRestockItem] = useState(null);
  const [adjustItem,  setAdjustItem]  = useState(null);

  const { isPinned, toggle: favToggle } = useFavourites();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debouncedSearch, lowStock, measurementType]);

  const {
    storeId, records, total, totalPages, currentPage,
    isLoading, isFetching, error, summary, lowStockList,
    restock, adjust,
  } = useInventory({
    page, limit: 25,
    search:          debouncedSearch || undefined,
    lowStock:        lowStock        || undefined,
    measurementType: measurementType || undefined,
  });

  const columns = useMemo(() => [
    {
      key:      "item_name",
      header:   "Item",
      sortable: true,
      render:   (row) => (
        <div className="flex items-center gap-2.5">
          <ItemImage item={row} size="md" rounded="md" />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">{row.item_name}</span>
              {isPinned?.(row.item_id) && (
                <Star className="h-2.5 w-2.5 text-amber-400 fill-amber-400 shrink-0" title="POS Quick Access" />
              )}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">{row.sku}</div>
          </div>
        </div>
      ),
    },
    {
      key:    "category_name",
      header: "Category",
      render: (row) => <span className="text-xs text-muted-foreground">{row.category_name ?? "—"}</span>,
    },
    {
      key:      "quantity",
      header:   "On Hand",
      align:    "center",
      sortable: true,
      render:   (row) => {
        const q = parseFloat(row.quantity ?? 0);
        const m = parseFloat(row.min_stock_level ?? 0);
        return (
          <span className={cn(
            "text-sm font-bold tabular-nums",
            q === 0 ? "text-red-400" : m > 0 && q <= m ? "text-amber-400" : "text-foreground",
          )}>
            {formatQuantity(q, row.measurement_type, row.unit_type)}
          </span>
        );
      },
    },
    {
      key:    "available_quantity",
      header: "Available",
      align:  "center",
      render: (row) => <span className="text-xs text-muted-foreground tabular-nums">{formatQuantity(parseFloat(row.available_quantity ?? 0), row.measurement_type, row.unit_type)}</span>,
    },
    {
      key:    "min_stock_level",
      header: "Min/Max",
      align:  "center",
      render: (row) => (
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {row.min_stock_level ?? "—"} / {row.max_stock_level ?? "—"}
        </span>
      ),
    },
    {
      key:    "stock_status",
      header: "Status",
      align:  "center",
      render: (row) => <StockStatusBadge status={row.stock_status} />,
    },
    {
      key:      "selling_price",
      header:   "Price",
      align:    "right",
      sortable: true,
      render:   (row) => (
        <span className="text-xs font-semibold text-foreground tabular-nums">
          {formatPricePerUnit(parseFloat(row.selling_price), row.measurement_type, row.unit_type)}
        </span>
      ),
    },
    {
      key:    "actions",
      header: "",
      align:  "right",
      render: (row) => {
        const pinned = isPinned?.(row.item_id) ?? false;
        return (
          <div className="flex items-center justify-end gap-0.5">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              title={pinned ? "Remove from POS Quick Access" : "Add to POS Quick Access"}
              onClick={(e) => { e.stopPropagation(); favToggle?.(row.item_id); }}
            >
              <Star className={cn(
                "h-3.5 w-3.5 transition-colors",
                pinned ? "text-amber-400 fill-amber-400" : "text-muted-foreground/40 hover:text-amber-400",
              )} />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              onClick={(e) => { e.stopPropagation(); setRestockItem(row); }}>
              + Restock
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
              onClick={(e) => { e.stopPropagation(); setAdjustItem(row); }}>
              Adjust
            </Button>
          </div>
        );
      },
    },
  ], [isPinned, favToggle]);

  if (!storeId) return (
    <div className="p-8 text-center text-sm text-muted-foreground">Select a store to view inventory.</div>
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Monitor stock levels, restock items, and manage adjustments across your catalog."
        action={
          <Button size="sm" variant="outline" onClick={() => navigate("/stock-counts")}>
            <ClipboardList className="h-3.5 w-3.5" />
            Stock Counts
          </Button>
        }
      />

      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 pt-5">
          <StatCard label="Total Items"     value={summary.total_items?.toLocaleString() ?? "—"}      icon={Boxes}        accent="primary" />
          <StatCard label="Low Stock"       value={summary.low_stock_count?.toLocaleString() ?? "—"}  icon={TrendingDown}  accent="warning" />
          <StatCard label="Out of Stock"    value={summary.out_of_stock_count?.toLocaleString() ?? "—"} icon={AlertTriangle} accent="destructive" />
          <StatCard label="Total Value"     value={formatCurrency(parseFloat(summary.total_inventory_value ?? 0))} icon={DollarSign}   accent="success" />
        </div>
      )}

      {/* Low stock alert strip */}
      {lowStockList.length > 0 && !lowStock && (
        <div className="mx-6 mt-4 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-xs font-medium text-amber-300">
              <strong>{lowStockList.length}</strong> item{lowStockList.length !== 1 ? "s" : ""} are running low on stock
            </p>
          </div>
          <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 h-7 text-[11px]"
            onClick={() => setLowStock(true)}>
            View
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="px-6 pt-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items, SKU, barcode…" className="pl-8 h-8 text-xs" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <Select
          value={measurementType ?? "all"}
          onValueChange={(v) => setMeasurementType(v === "all" ? null : v)}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            {MEASUREMENT_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button onClick={() => setLowStock((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 h-8 text-xs font-medium transition-all",
            lowStock
              ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
              : "border-border text-muted-foreground hover:text-foreground",
          )}>
          <TrendingDown className="h-3 w-3" /> Low Stock Only
        </button>
        {(search || lowStock || measurementType) && (
          <button onClick={() => { setSearch(""); setLowStock(false); setMeasurementType(null); }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums flex items-center gap-1">
          {isFetching && <RefreshCw className="h-3 w-3 animate-spin" />}
          {total} items
        </span>
      </div>

      {/* Table */}
      <div className="px-6 pt-3 pb-6">
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {typeof error === "string" ? error : "Unable to load inventory."}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={records}
            isLoading={isLoading}
            rowKey="item_id"
            onRowClick={(row) => navigate(`/inventory/${row.item_id}`)}
            emptyState={
              <EmptyState
                icon={Boxes}
                title={lowStock ? "No low-stock items" : debouncedSearch ? "No items found" : "No inventory records"}
                description={lowStock ? "All items are sufficiently stocked." : "Add items to your catalog to see inventory here."}
                compact
              />
            }
            pagination={{ page: currentPage, pageSize: 25, total, onPageChange: setPage }}
          />
        )}
      </div>

      <RestockDialog
        open={!!restockItem}
        onOpenChange={(v) => !v && setRestockItem(null)}
        item={restockItem}
        mutation={restock}
      />
      <AdjustInventoryDialog
        open={!!adjustItem}
        onOpenChange={(v) => !v && setAdjustItem(null)}
        item={adjustItem}
        mutation={adjust}
      />
    </>
  );
}
