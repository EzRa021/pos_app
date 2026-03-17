// ============================================================================
// components/shared/TablePagination.jsx
// ============================================================================
// Reusable server-side pagination bar for history / movement tables.
//
// Props:
//   page         — current page (1-indexed)
//   totalPages   — total number of pages
//   total        — total row count
//   onPageChange — (newPage: number) => void
//   label        — singular label for the row noun, e.g. "event" (default)
//   isLoading    — dims the control while a fetch is in flight
// ============================================================================

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

// ── Build the visible page-number window ─────────────────────────────────────
// Always shows: first, last, current ± 1 sibling, with ellipsis in gaps.
// For small totalPages (≤ 7) every page is shown directly.
function buildPageWindow(page, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const set   = new Set([1, totalPages]);
  const left  = Math.max(2, page - 1);
  const right = Math.min(totalPages - 1, page + 1);
  for (let p = left; p <= right; p++) set.add(p);

  const sorted = [...set].sort((a, b) => a - b);
  const result = [];

  for (let i = 0; i < sorted.length; i++) {
    result.push(sorted[i]);
    // Insert ellipsis if the gap to the next item is > 1
    if (i + 1 < sorted.length && sorted[i + 1] - sorted[i] > 1) {
      result.push("ellipsis-" + sorted[i]);
    }
  }

  return result;
}

// ── TablePagination ───────────────────────────────────────────────────────────
export function TablePagination({
  page,
  totalPages,
  total,
  onPageChange,
  label    = "event",
  isLoading = false,
}) {
  if (!totalPages || totalPages <= 1) return null;

  const window = buildPageWindow(page, totalPages);
  const from   = (page - 1) * Math.ceil(total / totalPages) + 1;
  const to     = Math.min(page * Math.ceil(total / totalPages), total);

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border",
        isLoading && "opacity-60 pointer-events-none",
      )}
    >
      {/* Row count summary */}
      <p className="text-[11px] text-muted-foreground tabular-nums order-2 sm:order-1">
        {total > 0
          ? <>Showing <span className="font-semibold text-foreground">{from}–{to}</span> of <span className="font-semibold text-foreground">{total}</span> {label}{total !== 1 ? "s" : ""}</>
          : <>0 {label}s</>
        }
      </p>

      {/* Pagination controls */}
      <Pagination className="w-auto order-1 sm:order-2">
        <PaginationContent>
          {/* Previous */}
          <PaginationItem>
            <PaginationPrevious
              onClick={() => onPageChange(page - 1)}
              className={cn(
                "transition-opacity",
                page <= 1 && "pointer-events-none opacity-40",
              )}
            />
          </PaginationItem>

          {/* Page numbers */}
          {window.map((item) =>
            typeof item === "string" ? (
              // Ellipsis slot
              <PaginationItem key={item}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <PaginationLink
                  isActive={item === page}
                  onClick={() => item !== page && onPageChange(item)}
                >
                  {item}
                </PaginationLink>
              </PaginationItem>
            ),
          )}

          {/* Next */}
          <PaginationItem>
            <PaginationNext
              onClick={() => onPageChange(page + 1)}
              className={cn(
                "transition-opacity",
                page >= totalPages && "pointer-events-none opacity-40",
              )}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
