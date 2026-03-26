// ============================================================================
// features/returns/ReturnsPanel.jsx
// ============================================================================

import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  RotateCcw, Search, X, TrendingDown,
  ArrowUpRight, Calendar, CheckCircle2, Ban,
} from "lucide-react";

import { useReturns, useReturnStats } from "@/features/returns/useReturns";
import { PageHeader }  from "@/components/shared/PageHeader";
import { DataTable }   from "@/components/shared/DataTable";
import { EmptyState }  from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import { cn }          from "@/lib/utils";
import { formatCurrency, formatDateTime, formatRef } from "@/lib/format";

// ── Constants ─────────────────────────────────────────────────────────────────
const REFUND_METHOD_LABELS = {
  cash:            "Cash",
  card:            "Card",
  transfer:        "Bank Transfer",
  original_method: "Original Method",
  store_credit:    "Store Credit",
};

const TYPE_TABS = [
  { key: "",        label: "All Types" },
  { key: "full",    label: "Full" },
  { key: "partial", label: "Partial" },
];

const STATUS_TABS = [
  { key: "",          label: "All Statuses" },
  { key: "completed", label: "Completed" },
  { key: "voided",    label: "Voided" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = "default", icon: Icon }) {
  const styles = {
    default:     { ring: "border-border/60 bg-card",                    val: "text-foreground"    },
    primary:     { ring: "border-primary/25 bg-primary/[0.06]",         val: "text-primary"       },
    success:     { ring: "border-success/25 bg-success/[0.06]",         val: "text-success"       },
    warning:     { ring: "border-warning/25 bg-warning/[0.06]",         val: "text-warning"       },
    destructive: { ring: "border-destructive/25 bg-destructive/[0.06]", val: "text-destructive"   },
    muted:       { ring: "border-border/60 bg-muted/30",                val: "text-muted-foreground" },
  };
  const { ring, val } = styles[accent] ?? styles.default;

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border px-4 py-3.5", ring)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className={cn("h-3.5 w-3.5", val)} />}
      </div>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function ReturnTypeBadge({ type }) {
  const full = type === "full";
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
      full
        ? "bg-primary/15 text-primary border border-primary/20"
        : "bg-warning/15 text-warning border border-warning/20",
    )}>
      {full ? "Full" : "Partial"}
    </span>
  );
}

function RefundMethodChip({ method }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {REFUND_METHOD_LABELS[method] ?? method}
    </span>
  );
}

function TabGroup({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────
export function ReturnsPanel() {
  const navigate = useNavigate();

  // Filter state
  const [page,             setPage]             = useState(1);
  const [search,           setSearch]           = useState("");
  const [debouncedSearch,  setDebouncedSearch]  = useState("");
  const [returnType,       setReturnType]       = useState("");
  const [status,           setStatus]           = useState("");
  const [dateFrom,         setDateFrom]         = useState("");
  const [dateTo,           setDateTo]           = useState("");
  const [showDateFilter,   setShowDateFilter]   = useState(false);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // Data
  const { returns, total, totalPages, isLoading, isFetching } = useReturns({
    page,
    limit:      25,
    search:     debouncedSearch || undefined,
    status:     status          || undefined,
    returnType: returnType      || undefined,
    dateFrom:   dateFrom        || undefined,
    dateTo:     dateTo          || undefined,
  });

  // Stats come from the efficient single-query v_return_stats view
  const {
    total:          statTotal,
    fullCount,
    partialCount,
    completedCount,
    voidedCount,
    totalRefunded,
    isLoading:      statsLoading,
  } = useReturnStats();

  const hasActiveFilters = search || returnType || status || dateFrom || dateTo;

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setReturnType("");
    setStatus("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }, []);

  // Column definitions
  const columns = useMemo(() => [
    {
      key:    "reference_no",
      header: "Return Ref",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold",
            row.return_type === "full"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-warning/30 bg-warning/10 text-warning",
          )}>
            {row.return_type === "full" ? "F" : "P"}
          </div>
          <div>
            <p className="text-xs font-mono font-bold text-foreground">
              {formatRef(row.reference_no)}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono">
              ← {formatRef(row.original_ref_no)}
            </p>
          </div>
        </div>
      ),
    },
    {
      key:    "return_type",
      header: "Type",
      render: (row) => <ReturnTypeBadge type={row.return_type} />,
    },
    {
      key:    "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} size="sm" />,
    },
    {
      key:    "refund_method",
      header: "Refund Via",
      render: (row) => <RefundMethodChip method={row.refund_method} />,
    },
    {
      key:    "customer_name",
      header: "Customer",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.customer_name ?? "—"}
        </span>
      ),
    },
    {
      key:    "cashier_name",
      header: "Cashier",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.cashier_name ?? "—"}
        </span>
      ),
    },
    {
      key:      "total_amount",
      header:   "Amount",
      align:    "right",
      sortable: true,
      render: (row) => (
        <span className={cn(
          "text-sm font-mono font-bold tabular-nums",
          row.status === "voided"
            ? "line-through text-muted-foreground"
            : "text-destructive",
        )}>
          −{formatCurrency(parseFloat(row.total_amount ?? 0))}
        </span>
      ),
    },
    {
      key:      "created_at",
      header:   "Date",
      sortable: true,
      render: (row) => (
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatDateTime(row.created_at)}
        </span>
      ),
    },
    {
      key:    "_actions",
      header: "",
      align:  "right",
      render: () => (
        <span className="flex items-center gap-1 text-[10px] font-semibold text-primary/60 group-hover:text-primary transition-colors">
          <ArrowUpRight className="h-3 w-3" />
          View
        </span>
      ),
    },
  ], []);

  // Page-scoped summary total (only non-voided)
  const pageTotal = useMemo(
    () => returns
      .filter((r) => r.status !== "voided")
      .reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0),
    [returns],
  );

  return (
    <>
      <PageHeader
        title="Returns"
        description="Track customer returns, refund status, and restocked inventory."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* ── Stat cards ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Returns"
              value={statsLoading ? "—" : statTotal}
              sub="all time"
              accent="primary"
              icon={RotateCcw}
            />
            <StatCard
              label="Full Returns"
              value={statsLoading ? "—" : fullCount}
              sub="entire transaction"
              accent={fullCount > 0 ? "warning" : "muted"}
            />
            <StatCard
              label="Partial Returns"
              value={statsLoading ? "—" : partialCount}
              sub="selected items"
              accent={partialCount > 0 ? "default" : "muted"}
            />
            <StatCard
              label="Total Refunded"
              value={statsLoading ? "—" : formatCurrency(totalRefunded)}
              sub={`${completedCount} completed · ${voidedCount} voided`}
              accent={totalRefunded > 0 ? "destructive" : "muted"}
              icon={TrendingDown}
            />
          </div>

          {/* ── Table card ─────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Return History
              </h2>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setShowDateFilter((v) => !v)}
                className={cn("h-7 gap-1.5 text-[11px]", showDateFilter && "text-primary")}
              >
                <Calendar className="h-3 w-3" />
                {showDateFilter ? "Hide Date Filter" : "Date Filter"}
              </Button>
            </div>

            <div className="p-5 space-y-3">
              {/* Search row */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder="Search by return ref, transaction, or customer…"
                    className="pl-9 h-8 text-xs"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleClearFilters}
                    className="h-8 gap-1 text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>

              {/* Date filter (collapsible) */}
              {showDateFilter && (
                <div className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-muted/20">
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    Date range:
                  </span>
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                      className="h-7 text-xs flex-1"
                    />
                    <span className="text-muted-foreground text-xs shrink-0">→</span>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                      className="h-7 text-xs flex-1"
                    />
                    {(dateFrom || dateTo) && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
                        className="h-7 text-[10px] shrink-0"
                      >
                        Clear dates
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Type + Status tabs */}
              <div className="flex items-center gap-3 flex-wrap">
                <TabGroup
                  tabs={TYPE_TABS}
                  active={returnType}
                  onChange={(v) => { setReturnType(v); setPage(1); }}
                />
                <div className="w-px h-5 bg-border/60 shrink-0" />
                <TabGroup
                  tabs={STATUS_TABS}
                  active={status}
                  onChange={(v) => { setStatus(v); setPage(1); }}
                />
                {isFetching && !isLoading && (
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    Refreshing…
                  </span>
                )}
              </div>

              {/* Table */}
              <DataTable
                columns={columns}
                data={returns}
                isLoading={isLoading || isFetching}
                onRowClick={(row) => navigate(`/returns/${row.id}`)}
                rowClassName="group cursor-pointer hover:bg-muted/30 transition-colors duration-100"
                pagination={
                  totalPages > 1
                    ? { page, pageSize: 25, total, onPageChange: setPage }
                    : undefined
                }
                emptyState={
                  <EmptyState
                    icon={RotateCcw}
                    title={
                      hasActiveFilters
                        ? "No returns match your filters"
                        : "No returns yet"
                    }
                    description={
                      hasActiveFilters
                        ? "Try adjusting or clearing your filters."
                        : "Returns are created from a transaction's detail page."
                    }
                    action={
                      hasActiveFilters ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleClearFilters}
                        >
                          Clear filters
                        </Button>
                      ) : null
                    }
                  />
                }
              />

              {/* Footer summary */}
              {returns.length > 0 && (
                <div className="pt-3 border-t border-border/40 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Showing {returns.length} return{returns.length !== 1 ? "s" : ""}
                    {total > returns.length ? ` of ${total} total` : ""}
                  </span>
                  <div className="flex items-center gap-3">
                    {/* Voided count badge */}
                    {returns.some((r) => r.status === "voided") && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Ban className="h-3 w-3" />
                        {returns.filter((r) => r.status === "voided").length} voided
                      </span>
                    )}
                    {/* Page total (excluding voided) */}
                    <span className="flex items-center gap-1.5 text-xs font-mono font-bold tabular-nums text-destructive">
                      <TrendingDown className="h-3 w-3" />
                      {formatCurrency(pageTotal)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
