// ============================================================================
// features/shifts/ShiftHistoryTable.jsx
// ============================================================================
// Shift model fields (mirrors quantum-pos-app / shift.rs):
//   id, store_id, opened_by, cashier_name?,
//   opening_float, actual_cash?, total_sales?, total_returns?,
//   opening_notes?, status, opened_at, closed_at?
//
// Non-global users are automatically scoped to their own shifts on the backend.
// ============================================================================

import { useState }        from "react";
import { useQuery }        from "@tanstack/react-query";
import { useNavigate }     from "react-router-dom";
import { Clock, Hash }     from "lucide-react";

import { DataTable }       from "@/components/shared/DataTable";
import { EmptyState }      from "@/components/shared/EmptyState";
import { StatusBadge }     from "@/components/shared/StatusBadge";
import { CurrencyDisplay } from "@/components/shared/CurrencyDisplay";

import { getShifts }                  from "@/commands/shifts";
import { useBranchStore }             from "@/stores/branch.store";
import { formatDate, formatDuration } from "@/lib/format";
import { PAGE_SIZE }                  from "@/lib/constants";
import { cn }                         from "@/lib/utils";

// ── Shift number helper (mirrors useShift.js) ─────────────────────────────────
function shiftNumber(row) {
  const date = new Date(row.opened_at).toISOString().slice(0, 10).replace(/-/g, "");
  return `SH-${date}-${String(row.id).padStart(3, "0")}`;
}

// ── Status filter tabs ────────────────────────────────────────────────────────
// Shift status can be: open | active | suspended | closed.
// For the "Open" tab we pass no status filter so the backend's
// non-closed scoping returns all in-progress shifts (open/active/suspended).
const STATUS_TABS = [
  { key: null,     label: "All" },
  { key: "open",   label: "Open",   filterStatus: undefined },  // backend scopes correctly
  { key: "closed", label: "Closed", filterStatus: "closed" },
];

// ── Table columns ─────────────────────────────────────────────────────────────
const COLUMNS = [
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
];

export function ShiftHistoryTable() {
  const [page,       setPage]       = useState(1);
  const [statusFilter, setStatusFilter] = useState(null);
  const storeId  = useBranchStore((s) => s.activeStore?.id);
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey:  ["shifts", storeId, page, statusFilter],
    queryFn:   () => {
      // For the "Open" tab, send no status so backend returns all
      // in-progress statuses (open / active / suspended).
      const activeTab = STATUS_TABS.find((t) => t.key === statusFilter);
      const status = activeTab?.filterStatus; // undefined = no filter
      return getShifts({ store_id: storeId, page, limit: PAGE_SIZE, status });
    },
    enabled:         !!storeId,
    keepPreviousData: true,
    staleTime:        0,          // always refetch after invalidation
    refetchOnMount:   true,
  });

  // PagedResult serializes as { data: [...], total, page, limit, total_pages }
  const rows  = data?.data  ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-3">
      {/* Status filter tabs */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-background/60 border border-border w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={String(tab.key)}
            onClick={() => { setStatusFilter(tab.key); setPage(1); }}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-semibold transition-all duration-150",
              statusFilter === tab.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {typeof error === "string" ? error : "Unable to load shift history."}
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          data={rows}
          isLoading={isLoading}
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
                statusFilter
                  ? `No ${statusFilter} shifts yet.`
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
