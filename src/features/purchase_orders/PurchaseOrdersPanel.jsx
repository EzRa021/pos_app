// ============================================================================
// features/purchase_orders/PurchaseOrdersPanel.jsx — PO list page
// ============================================================================
import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ShoppingCart, Plus, Search, X, Calendar, Truck,
  CheckCircle2, Filter,
} from "lucide-react";

import { usePurchaseOrders, usePoStats } from "./usePurchaseOrders";
import { PageHeader }   from "@/components/shared/PageHeader";
import { EmptyState }   from "@/components/shared/EmptyState";
import { Button }       from "@/components/ui/button";
import { Input }        from "@/components/ui/input";
import { cn }           from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { usePermission }       from "@/hooks/usePermission";
import { usePaginationParams } from "@/hooks/usePaginationParams";

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "",          label: "All"       },
  { key: "pending",   label: "Pending"   },
  { key: "approved",  label: "Approved"  },
  { key: "received",  label: "Received"  },
  { key: "cancelled", label: "Cancelled" },
];

const PO_STATUS_CFG = {
  pending:            { cls: "bg-warning/10 text-warning border-warning/20",                  dot: "bg-warning",     label: "Pending"          },
  approved:           { cls: "bg-primary/10 text-primary border-primary/20",                  dot: "bg-primary",     label: "Approved"         },
  received:           { cls: "bg-success/10 text-success border-success/20",                  dot: "bg-success",     label: "Received"         },
  partially_received: { cls: "bg-warning/15 text-warning border-warning/30",                  dot: "bg-warning",     label: "Partial"          },
  fully_received:     { cls: "bg-success/10 text-success border-success/20",                  dot: "bg-success",     label: "Received"         },
  overdue:            { cls: "bg-destructive/15 text-destructive border-destructive/30",       dot: "bg-destructive", label: "Overdue"          },
  cancelled:          { cls: "bg-muted/50 text-muted-foreground border-border/60",            dot: "bg-muted-foreground", label: "Cancelled"   },
  rejected:           { cls: "bg-destructive/10 text-destructive border-destructive/20",      dot: "bg-destructive", label: "Rejected"         },
  draft:              { cls: "bg-muted/50 text-muted-foreground border-border/60",            dot: "bg-muted-foreground", label: "Draft"        },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function POStatusBadge({ status }) {
  const s = PO_STATUS_CFG[status] ?? PO_STATUS_CFG.pending;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase whitespace-nowrap",
      s.cls,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", s.dot)} />
      {s.label}
    </span>
  );
}

function StatusTabs({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-1 border border-border/60">
      {STATUS_TABS.map((tab) => {
        const count = counts[tab.key] ?? 0;
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150 whitespace-nowrap",
              isActive
                ? "bg-card text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            {tab.label}
            {count > 0 && (
              <span className={cn(
                "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function PurchaseOrdersPanel() {
  const navigate  = useNavigate();
  const canCreate = usePermission("purchase_orders.create");

  const { page, search, setPage, setSearch } = usePaginationParams({ defaultPageSize: 20 });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status,   setStatus]   = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { orders, total, isLoading, isFetching } = usePurchaseOrders({
    search:   debouncedSearch || undefined,
    status:   status         || undefined,
    dateFrom: dateFrom        || undefined,
    dateTo:   dateTo          || undefined,
    page,
    limit: 20,
  });

  const poStats = usePoStats();

  const counts = useMemo(() => ({
    "":        poStats.total,
    pending:   poStats.pending,
    approved:  poStats.approved,
    received:  poStats.received,
    cancelled: poStats.cancelled,
  }), [poStats]);

  const hasFilters = !!(search || status || dateFrom || dateTo);
  const clearFilters = useCallback(() => {
    setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setPage(1);
  }, [setSearch, setPage]);

  // ── Pagination helpers ────────────────────────────────────────────────────
  const totalPagesCalc = Math.max(1, Math.ceil(total / 20));
  const from = total === 0 ? 0 : (page - 1) * 20 + 1;
  const to   = Math.min(page * 20, total);

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        description="Create and manage purchase orders. Receiving goods automatically updates stock."
        action={canCreate && (
          <Button size="sm" onClick={() => navigate("/purchase-orders/new")} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Purchase Order
          </Button>
        )}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* ── KPI cards ────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Total Orders"
              value={poStats.total}
              sub="in this store"
              accent="primary"
            />
            <StatCard
              label="Open / Active"
              value={poStats.pending + poStats.approved}
              sub="pending or approved"
              accent={(poStats.pending + poStats.approved) > 0 ? "warning" : "muted"}
            />
            <StatCard
              label="Received"
              value={poStats.received}
              sub="goods delivered"
              accent="success"
            />
            <StatCard
              label="Cancelled"
              value={poStats.cancelled + poStats.rejected}
              sub="cancelled or rejected"
              accent={(poStats.cancelled + poStats.rejected) > 0 ? "muted" : "default"}
            />
          </div>

          {/* ── Table card ───────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">

            {/* Card header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2.5">
                <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Purchase Orders
                </h2>
                {(isLoading || isFetching) && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                )}
              </div>
              {canCreate && (
                <Button size="sm" variant="outline" onClick={() => navigate("/purchase-orders/new")}
                  className="h-7 gap-1 text-xs px-2.5">
                  <Plus className="h-3 w-3" />New PO
                </Button>
              )}
            </div>

            {/* ── Filter bar — full-width row, never crammed into the header ── */}
            <div className="flex flex-wrap items-center gap-2.5 px-5 py-3 border-b border-border/60 bg-muted/10">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search PO#, supplier…"
                  className="pl-8 h-8 text-xs"
                />
                {search && (
                  <button onClick={() => { setSearch(""); setPage(1); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Date range */}
              <div className="flex items-center gap-1.5 shrink-0">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="h-8 w-36 text-xs"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="h-8 w-36 text-xs"
                />
              </div>

              {/* Clear */}
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </button>
              )}

              {/* Active filter indicator */}
              {hasFilters && (
                <div className="flex items-center gap-1 rounded-full border border-primary/25 bg-primary/8 px-2 py-0.5 shrink-0">
                  <Filter className="h-2.5 w-2.5 text-primary" />
                  <span className="text-[10px] font-semibold text-primary">Filtered</span>
                </div>
              )}
            </div>

            {/* ── Status tabs — own row ───────────────────────────────── */}
            <div className="px-5 py-2.5 border-b border-border/60">
              <StatusTabs
                active={status}
                onChange={(v) => { setStatus(v); setPage(1); }}
                counts={counts}
              />
            </div>

            {/* ── Table ──────────────────────────────────────────────── */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap w-32">
                      PO #
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                      Supplier
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap w-36">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap w-32">
                      Total
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap w-28">
                      Ordered
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap w-28">
                      Received
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Loading skeletons */}
                  {isLoading && Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/60">
                      {[140, 200, 120, 100, 100, 100].map((w, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 rounded skeleton-shimmer" style={{ width: w }} />
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Data rows */}
                  {!isLoading && orders.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => navigate(`/purchase-orders/${row.id}`)}
                      className="border-b border-border/50 last:border-0 cursor-pointer transition-colors hover:bg-primary/[0.03] active:bg-primary/[0.06]"
                    >
                      {/* PO # */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-primary font-bold tracking-wide">
                          {row.po_number}
                        </span>
                      </td>

                      {/* Supplier */}
                      <td className="px-4 py-3">
                        <Link
                          to={`/suppliers/${row.supplier_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1.5 w-fit group"
                        >
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-primary/20 bg-primary/8 text-[9px] font-bold text-primary uppercase">
                            {(row.supplier_name ?? "—").slice(0, 2)}
                          </div>
                          <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate max-w-[200px]">
                            {row.supplier_name ?? "—"}
                          </span>
                          <Truck className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary/60 transition-colors shrink-0" />
                        </Link>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <POStatusBadge status={row.status} />
                      </td>

                      {/* Total */}
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-xs font-bold tabular-nums text-foreground">
                          {formatCurrency(parseFloat(row.total_amount ?? 0))}
                        </span>
                      </td>

                      {/* Ordered date */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(row.ordered_at)}
                        </span>
                      </td>

                      {/* Received date */}
                      <td className="px-4 py-3">
                        {row.received_at ? (
                          <span className="flex items-center gap-1 text-xs text-success whitespace-nowrap">
                            <CheckCircle2 className="h-3 w-3 shrink-0" />
                            {formatDate(row.received_at)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Empty state */}
            {!isLoading && orders.length === 0 && (
              <div className="py-12">
                <EmptyState
                  icon={ShoppingCart}
                  title="No purchase orders found"
                  description={hasFilters
                    ? "No orders match your current filters. Try clearing them."
                    : "Create your first purchase order to start tracking supplier deliveries."}
                  action={!hasFilters && canCreate && (
                    <Button size="sm" onClick={() => navigate("/purchase-orders/new")} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" />New Purchase Order
                    </Button>
                  )}
                />
              </div>
            )}

            {/* ── Pagination bar ──────────────────────────────────────── */}
            {total > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10">
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {from}–{to} of {total} order{total !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost" size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="h-7 px-2.5 text-xs"
                  >
                    ← Prev
                  </Button>
                  {/* Page numbers */}
                  {Array.from({ length: totalPagesCalc }, (_, i) => i + 1)
                    .filter((p) => {
                      if (totalPagesCalc <= 5) return true;
                      if (p === 1 || p === totalPagesCalc) return true;
                      return Math.abs(p - page) <= 1;
                    })
                    .reduce((acc, p, i, arr) => {
                      if (i > 0 && p - arr[i - 1] > 1) acc.push("…");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === "…" ? (
                        <span key={`e${i}`} className="text-[11px] text-muted-foreground px-1">…</span>
                      ) : (
                        <Button
                          key={p}
                          variant={p === page ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setPage(p)}
                          className="h-7 min-w-[1.75rem] px-2 text-xs"
                        >
                          {p}
                        </Button>
                      )
                    )}
                  <Button
                    variant="ghost" size="sm"
                    disabled={page >= totalPagesCalc}
                    onClick={() => setPage(page + 1)}
                    className="h-7 px-2.5 text-xs"
                  >
                    Next →
                  </Button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
