// ============================================================================
// features/shifts/ShiftHistoryTable.jsx
// ============================================================================
// Shift model fields (mirrors src-tauri/src/models/shift.rs):
//   id, store_id, opened_by, cashier_name?,
//   opening_float, actual_cash?, total_sales?, total_returns?,
//   opening_notes?, status, opened_at, closed_at?
//
// Non-global users are automatically scoped to their own shifts on the backend.
// ============================================================================

import { useState, useEffect, useMemo } from "react";
import { useQuery }           from "@tanstack/react-query";
import { useNavigate }        from "react-router-dom";
import { Clock, Search, X }   from "lucide-react";

import { DataTable }       from "@/components/shared/DataTable";
import { EmptyState }      from "@/components/shared/EmptyState";
import { StatusBadge }     from "@/components/shared/StatusBadge";
import { CurrencyDisplay } from "@/components/shared/CurrencyDisplay";
import { Input }           from "@/components/ui/input";

import { getShifts }                  from "@/commands/shifts";
import { useBranchStore }             from "@/stores/branch.store";
import { usePaginationParams }        from "@/hooks/usePaginationParams";
import { formatDate, formatDuration } from "@/lib/format";
import { PAGE_SIZE }                  from "@/lib/constants";
import { cn }                         from "@/lib/utils";

// ── Shift number helper ───────────────────────────────────────────────────────
function shiftNumber(row) {
  const date = new Date(row.opened_at).toISOString().slice(0, 10).replace(/-/g, "");
  return `SH-${date}-${String(row.id).padStart(3, "0")}`;
}

// ── Status filter tabs ────────────────────────────────────────────────────────
// "In Progress" uses is_active_only: true so the backend excludes closed/cancelled.
// "Closed" passes status: "closed" for exact match.
// "All" passes no filter — shows every shift.
const STATUS_TABS = [
  { key: "all",         label: "All",         params: {} },
  { key: "in_progress", label: "In Progress", params: { is_active_only: true } },
  { key: "closed",      label: "Closed",      params: { status: "closed" } },
];

// ── Table columns — memoized per CLAUDE.md column rules ───────────────────────
// Render functions don't close over component state, so deps array is empty.
// useMemo is used because DataTable re-checks column identity on every render.
function useShiftColumns(navigate) {
  return useMemo(() => [
    {
      key:    "shift_number",
      header: "Shift #",
      render: (row) => (
        <span className="text-[11px] font-mono font-bold text-foreground/80 tracking-tight">
          {shiftNumber(row)}
        </span>
      ),
    },
    {
      key:      "opened_at",
      header:   "Date",
      sortable: true,
      render:   (row) => (
        <span className="text-xs text-foreground">{formatDate(row.opened_at)}</span>
      ),
    },
    {
      key:    "cashier_name",
      header: "Cashier",
      render: (row) => (
        <span className="text-xs font-medium text-foreground">
          {row.cashier_name ?? "—"}
        </span>
      ),
    },
    {
      key:    "duration",
      header: "Duration",
      render: (row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {["open", "active", "suspended"].includes(row.status)
            ? <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Active
              </span>
            : formatDuration(row.opened_at, row.closed_at)}
        </span>
      ),
    },
    {
      key:    "opening_float",
      header: "Opening",
      align:  "right",
      render: (row) => <CurrencyDisplay value={row.opening_float} size="sm" />,
    },
    {
      key:    "total_sales",
      header: "Sales",
      align:  "right",
      render: (row) =>
        row.total_sales != null ? (
          <CurrencyDisplay value={row.total_sales} size="sm" color="success" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key:    "total_returns",
      header: "Refunds",
      align:  "right",
      render: (row) =>
        row.total_returns != null && parseFloat(row.total_returns) > 0 ? (
          <CurrencyDisplay value={row.total_returns} size="sm" color="destructive" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key:    "actual_cash",
      header: "Closing",
      align:  "right",
      render: (row) =>
        row.actual_cash != null ? (
          <CurrencyDisplay value={row.actual_cash} size="sm" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key:    "status",
      header: "Status",
      align:  "center",
      render: (row) => <StatusBadge status={row.status} />,
    },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ShiftHistoryTable() {
  const { page, search, setPage, setSearch } = usePaginationParams({ defaultPageSize: PAGE_SIZE });
  const [tabKey,     setTabKey]     = useState("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const storeId  = useBranchStore((s) => s.activeStore?.id);
  const navigate = useNavigate();
  const columns  = useShiftColumns(navigate);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const activeTab = STATUS_TABS.find((t) => t.key === tabKey) ?? STATUS_TABS[0];

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey:  ["shifts", storeId, page, tabKey, debouncedSearch],
    queryFn:   () => getShifts({
      store_id: storeId,
      page,
      limit:    PAGE_SIZE,
      search:   debouncedSearch || undefined,
      ...activeTab.params,
    }),
    enabled:          !!storeId,
    keepPreviousData: true,
    staleTime:        0,
    refetchOnMount:   true,
  });

  // PagedResult: { data: [...], total, page, limit, total_pages }
  const rows  = data?.data  ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shift #, cashier…"
            className="pl-8 h-8 w-52 text-xs"
          />
          {search && (
            <button
              onClick={() => { setSearch(""); setDebouncedSearch(""); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-background/60 border border-border">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setTabKey(tab.key); setPage(1); }}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-semibold transition-all duration-150",
                tabKey === tab.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {typeof error === "string" ? error : "Unable to load shift history."}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading || isFetching}
          rowKey="id"
          pagination={
            total > PAGE_SIZE
              ? { page, pageSize: PAGE_SIZE, total, onPageChange: setPage }
              : undefined
          }
          onRowClick={(row) => navigate(`/shifts/${row.id}`)}
          emptyState={
            <EmptyState
              icon={Clock}
              title="No shifts found"
              description={
                tabKey === "in_progress"
                  ? "No in-progress shifts right now."
                  : tabKey === "closed"
                  ? "No closed shifts yet."
                  : "Shift history will appear here once shifts have been opened."
              }
              compact
            />
          }
        />
      )}
    </div>
  );
}
