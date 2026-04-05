// ============================================================================
// components/shared/DataTable.jsx
// ============================================================================
// Production-grade table for all feature list screens.
//
// Props:
//   columns     Column[]      — column definitions (see type below)
//   data        object[]      — array of row objects
//   isLoading   boolean       — shows skeleton rows
//   emptyState  ReactNode     — rendered when data is empty (use <EmptyState>)
//   onRowClick  (row) => void — optional: makes rows interactive
//   rowKey      string        — field used as React key (default: "id")
//   stickyHeader boolean      — sticky first column (default: true)
//   pagination  object        — { page, pageSize, total, onPageChange, onPageSizeChange? }
//   className   string
//
// Column shape:
//   {
//     key:        string,          — unique identifier, used for sorting
//     header:     string,          — column label
//     render:     (row) => ReactNode  — cell renderer (default: row[key])
//     width:      string,          — optional CSS width / min-width
//     align:      "left"|"center"|"right"  — default: "left"
//     sortable:   boolean          — enables click-to-sort (default: false)
//     headerClass: string,         — extra classes on <th>
//     cellClass:  string,          — extra classes on <td>
//   }
//
// Design: dark card surface, thin primary-blue sort indicator,
// skeleton shimmer on load, row hover with primary/8 highlight,
// precise border/spacing cadence.
// ============================================================================

import { useState }    from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button }      from "@/components/ui/button";
import { cn }          from "@/lib/utils";

// ── Skeleton row ──────────────────────────────────────────────────────────────
function SkeletonRow({ columns }) {
  return (
    <tr>
      {columns.map((col) => (
        <td key={col.key} className="px-4 py-3">
          <div
            className={cn(
              "h-4 rounded-md skeleton-shimmer",
              col.align === "right" ? "ml-auto" : "",
              // vary widths for visual rhythm
              col.width ? "" : "w-3/4"
            )}
            style={{ width: col.width ? "70%" : undefined }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Sort icon ─────────────────────────────────────────────────────────────────
function SortIcon({ column, sortKey, sortDir }) {
  if (!column.sortable) return null;
  if (sortKey !== column.key)
    return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/40 ml-1 shrink-0" />;
  return sortDir === "asc"
    ? <ChevronUp   className="h-3 w-3 text-primary ml-1 shrink-0" />
    : <ChevronDown className="h-3 w-3 text-primary ml-1 shrink-0" />;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// ── Pagination bar ────────────────────────────────────────────────────────────
function PaginationBar({ pagination }) {
  if (!pagination) return null;
  const { page, pageSize, total, onPageChange, onPageSizeChange } = pagination;
  const totalPages  = Math.max(1, Math.ceil(total / pageSize));
  const from        = Math.min((page - 1) * pageSize + 1, total);
  const to          = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border">
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {total === 0 ? "No results" : `${from}–${to} of ${total}`}
        </span>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1); }}
            className="h-6 rounded border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s} / page</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-8 w-8 p-0"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        {/* Page numbers — show up to 5 pages */}
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter((p) => {
            if (totalPages <= 5) return true;
            if (p === 1 || p === totalPages) return true;
            return Math.abs(p - page) <= 1;
          })
          .reduce((acc, p, i, arr) => {
            if (i > 0 && p - arr[i - 1] > 1) acc.push("ellipsis");
            acc.push(p);
            return acc;
          }, [])
          .map((p, i) =>
            p === "ellipsis" ? (
              <span key={`e-${i}`} className="text-[11px] text-muted-foreground px-1">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "default" : "ghost"}
                size="xs"
                onClick={() => onPageChange(p)}
                className={cn("h-7 min-w-[1.75rem] px-1.5 text-[11px]")}
              >
                {p}
              </Button>
            )
          )}

        <Button
          variant="ghost"
          size="xs"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-8 w-8 p-0"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── DataTable ─────────────────────────────────────────────────────────────────
export function DataTable({
  columns,
  data = [],
  isLoading = false,
  emptyState,
  onRowClick,
  rowKey   = "id",
  pagination,
  className,
}) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  function handleSort(col) {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("asc");
    }
  }

  // Client-side sort (optional — pass pre-sorted data for server-side sort)
  const sortedData = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const SKELETON_ROWS = 6;
  const isEmpty       = !isLoading && data.length === 0;

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border border-border bg-card", className)}>
      {/* ── Scrollable table ──────────────────────────────────────────────── */}
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full border-collapse text-sm">
          {/* ── Head ────────────────────────────────────────────────────── */}
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col)}
                  className={cn(
                    "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap select-none",
                    col.align === "right"  && "text-right",
                    col.align === "center" && "text-center",
                    col.sortable           && "cursor-pointer hover:text-foreground transition-colors",
                    col.headerClass
                  )}
                  style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.header}
                    <SortIcon column={col} sortKey={sortKey} sortDir={sortDir} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          {/* ── Body ────────────────────────────────────────────────────── */}
          <tbody>
            {/* Loading skeletons */}
            {isLoading &&
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <SkeletonRow key={i} columns={columns} />
              ))}

            {/* Rows */}
            {!isLoading &&
              sortedData.map((row) => (
                <tr
                  key={row[rowKey] ?? Math.random()}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-border/60 last:border-b-0",
                    "transition-colors duration-100",
                    onRowClick
                      ? "cursor-pointer hover:bg-primary/[0.04] active:bg-primary/[0.07]"
                      : "hover:bg-muted/30"
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 text-sm text-foreground",
                        col.align === "right"  && "text-right",
                        col.align === "center" && "text-center",
                        col.cellClass
                      )}
                    >
                      {col.render ? col.render(row) : (row[col.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>

        {/* Empty state */}
        {isEmpty && (
          <div className="w-full">
            {emptyState ?? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No data available
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      <PaginationBar pagination={pagination} />
    </div>
  );
}
