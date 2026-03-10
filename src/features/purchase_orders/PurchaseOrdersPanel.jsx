// ============================================================================
// features/purchase_orders/PurchaseOrdersPanel.jsx — PO list page
// ============================================================================
import { useState, useMemo, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ShoppingCart, Plus, Search, X, Calendar, Truck,
  CheckCircle2, Clock, Ban, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

import { usePurchaseOrders } from "./usePurchaseOrders";
import { PageHeader }   from "@/components/shared/PageHeader";
import { DataTable }    from "@/components/shared/DataTable";
import { EmptyState }   from "@/components/shared/EmptyState";
import { StatusBadge }  from "@/components/shared/StatusBadge";
import { Button }       from "@/components/ui/button";
import { Input }        from "@/components/ui/input";
import { cn }           from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { usePermission } from "@/hooks/usePermission";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "",          label: "All"       },
  { key: "pending",   label: "Pending"   },
  { key: "approved",  label: "Approved"  },
  { key: "received",  label: "Received"  },
  { key: "cancelled", label: "Cancelled" },
];

const PO_STATUS_STYLES = {
  pending:   { cls: "bg-warning/10 text-warning border-warning/20",         icon: Clock       },
  approved:  { cls: "bg-primary/10 text-primary border-primary/20",         icon: CheckCircle2 },
  received:  { cls: "bg-success/10 text-success border-success/20",         icon: CheckCircle2 },
  cancelled: { cls: "bg-muted/50 text-muted-foreground border-border/60",   icon: Ban          },
  rejected:  { cls: "bg-destructive/10 text-destructive border-destructive/20", icon: Ban     },
  draft:     { cls: "bg-muted/50 text-muted-foreground border-border/60",   icon: Clock       },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ title, action, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

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
  const s = PO_STATUS_STYLES[status] ?? PO_STATUS_STYLES.pending;
  const Icon = s.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
      s.cls,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {status}
    </span>
  );
}

function StatusTabs({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60 flex-wrap">
      {STATUS_TABS.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}>
          {tab.label}
          <span className={cn(
            "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
            active === tab.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}>
            {counts[tab.key] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function PurchaseOrdersPanel() {
  const navigate   = useNavigate();
  const canCreate  = usePermission("purchase_orders.create");

  const [status,   setStatus]   = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [page,     setPage]     = useState(1);

  const { orders, total, totalPages, isLoading, isFetching } = usePurchaseOrders({
    status:   status   || undefined,
    dateFrom: dateFrom || undefined,
    dateTo:   dateTo   || undefined,
    page,
    limit: 20,
  });

  // Derived counts (from all loaded data)
  const counts = useMemo(() => {
    const base = { "": total };
    STATUS_TABS.slice(1).forEach((t) => {
      base[t.key] = orders.filter((o) => o.status === t.key).length;
    });
    return base;
  }, [orders, total]);

  // KPI stats from the current page data
  const { totalValue, pendingCount, receivedCount, cancelledCount } = useMemo(() => ({
    totalValue:     orders.reduce((s, o) => s + parseFloat(o.total_amount ?? 0), 0),
    pendingCount:   orders.filter((o) => o.status === "pending"   || o.status === "approved").length,
    receivedCount:  orders.filter((o) => o.status === "received").length,
    cancelledCount: orders.filter((o) => o.status === "cancelled" || o.status === "rejected").length,
  }), [orders]);

  const hasFilters = status || dateFrom || dateTo;
  const clearFilters = useCallback(() => {
    setStatus(""); setDateFrom(""); setDateTo(""); setPage(1);
  }, []);

  const columns = useMemo(() => [
    {
      key:    "po_number",
      header: "PO #",
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs text-primary font-semibold">{row.po_number}</span>
      ),
    },
    {
      key:    "supplier_name",
      header: "Supplier",
      render: (row) => (
        <Link
          to={`/suppliers/${row.supplier_id}`}
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors w-fit"
          onClick={(e) => e.stopPropagation()}
        >
          <Truck className="h-3 w-3 shrink-0 text-muted-foreground" />
          {row.supplier_name ?? "—"}
        </Link>
      ),
    },
    {
      key:    "status",
      header: "Status",
      render: (row) => <POStatusBadge status={row.status} />,
    },
    {
      key:    "total_amount",
      header: "Total",
      align:  "right",
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs font-semibold tabular-nums">
          {formatCurrency(parseFloat(row.total_amount))}
        </span>
      ),
    },
    {
      key:    "ordered_at",
      header: "Ordered",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.ordered_at)}</span>
      ),
    },
    {
      key:    "received_at",
      header: "Received",
      render: (row) => row.received_at ? (
        <span className="flex items-center gap-1 text-xs text-success">
          <CheckCircle2 className="h-3 w-3" />
          {formatDate(row.received_at)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/50">—</span>
      ),
    },
  ], []);

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        description="Create and manage purchase orders. Receiving goods automatically updates stock."
        action={canCreate && (
          <Button size="sm" onClick={() => navigate("/purchase-orders/new")}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New PO
          </Button>
        )}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Orders"  value={total}                        sub="in this store"      accent="primary" />
            <StatCard label="Open / Active" value={pendingCount}                 sub="pending or approved" accent={pendingCount > 0 ? "warning" : "muted"} />
            <StatCard label="Received"      value={receivedCount}                sub="goods delivered"     accent="success" />
            <StatCard label="Order Value"   value={formatCurrency(totalValue)}   sub="current page total"  accent="default" />
          </div>

          {/* Table */}
          <Section
            title="Purchase Orders"
            action={
              <div className="flex items-center gap-2 flex-wrap">
                {/* Date filters */}
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                    className="h-7 w-32 text-[11px]"
                  />
                  <span className="text-[11px] text-muted-foreground">–</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                    className="h-7 w-32 text-[11px]"
                  />
                </div>
                {hasFilters && (
                  <button onClick={clearFilters}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />Clear
                  </button>
                )}
                <StatusTabs active={status} onChange={(v) => { setStatus(v); setPage(1); }} counts={counts} />
              </div>
            }
          >
            <DataTable
              columns={columns}
              data={orders}
              isLoading={isLoading || isFetching}
              onRowClick={(row) => navigate(`/purchase-orders/${row.id}`)}
              pagination={{ page, pageSize: 20, total, onPageChange: setPage }}
              emptyState={
                <EmptyState
                  icon={ShoppingCart}
                  title="No purchase orders found"
                  description={hasFilters ? "Try clearing the filters." : "Create your first purchase order to get started."}
                  action={!hasFilters && canCreate && (
                    <Button size="sm" onClick={() => navigate("/purchase-orders/new")}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      New PO
                    </Button>
                  )}
                />
              }
            />
          </Section>

        </div>
      </div>
    </>
  );
}
