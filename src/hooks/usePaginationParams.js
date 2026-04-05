// ============================================================================
// hooks/usePaginationParams.js
// ============================================================================
// Persists page number, page size, and an optional search/filter string to
// the URL query params so that navigating back to a list page restores the
// user's last position.
//
// Usage:
//   const { page, pageSize, search, setPage, setPageSize, setSearch } =
//     usePaginationParams({ defaultPageSize: 25 });
//
//   // Wire into DataTable:
//   <DataTable
//     pagination={{ page, pageSize, total, onPageChange: setPage, onPageSizeChange: setPageSize }}
//   />
//
// URL format:  ?page=2&size=50&q=coffee
//   page  — current page number (1-based), omitted when 1
//   size  — page size, omitted when equal to defaultPageSize
//   q     — search/filter string, omitted when empty
//
// All params are encoded as strings in the URL. Parsed back to numbers on read.
// ============================================================================

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * @param {{ defaultPageSize?: number }} options
 */
export function usePaginationParams({ defaultPageSize = 25 } = {}) {
  const [params, setParams] = useSearchParams();

  const page     = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const pageSize = parseInt(params.get("size") ?? String(defaultPageSize), 10) || defaultPageSize;
  const search   = params.get("q") ?? "";

  const setPage = useCallback((p) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) next.delete("page");
      else        next.set("page", String(p));
      return next;
    }, { replace: true });
  }, [setParams]);

  const setPageSize = useCallback((s) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (s === defaultPageSize) next.delete("size");
      else                       next.set("size", String(s));
      next.delete("page"); // reset to page 1 on size change
      return next;
    }, { replace: true });
  }, [setParams, defaultPageSize]);

  const setSearch = useCallback((q) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!q) next.delete("q");
      else    next.set("q", q);
      next.delete("page"); // reset to page 1 on new search
      return next;
    }, { replace: true });
  }, [setParams]);

  return { page, pageSize, search, setPage, setPageSize, setSearch };
}
