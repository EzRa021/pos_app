// ============================================================================
// REACT QUERY CLIENT
// ============================================================================
// Shared QueryClient instance. Import this wherever you need direct access
// (e.g. to invalidate queries after mutations).
//
// STALE TIME RATIONALE
// --------------------
// This is a local desktop POS. Data only changes in two ways:
//   1. This user performs a mutation (sale, stock adjust, edit, etc.)
//   2. Another terminal on the LAN performs a mutation
//
// For case 1: we have explicit invalidation in invalidations.js — every
//   mutation calls the appropriate invalidate* function immediately after
//   success. So staleTime is irrelevant for our own mutations.
//
// For case 2 (multi-terminal): React Query's background refetch is the only
//   mechanism that picks up changes from other terminals. The window focus
//   refetch handles this well — when a manager tabs back to analytics after
//   the cashier has been selling, they get fresh data. There's no need for
//   an aggressive 30-second poll that hammers the local DB every half-minute
//   on every mounted component.
//
// CHOSEN VALUES
// -------------
//   staleTime:           5 min  — data is considered fresh for 5 minutes.
//                                 Background refetch still happens on window
//                                 focus after 5 min, keeping multi-terminal
//                                 views reasonably current.
//   refetchOnWindowFocus: true  — re-fetch when user alt-tabs back in (covers
//                                 the multi-terminal update case well).
//   gcTime (cacheTime):  10 min — keep unmounted query data in cache for 10
//                                 minutes so navigating back to a page is
//                                 instant while still clearing stale memory.
//
// PER-QUERY OVERRIDES
// -------------------
// Some queries intentionally override these defaults:
//   usePos (pos-items):        staleTime: 60s  — POS grid refreshes after sales
//   useBusinessInfo:           staleTime: 2min — only changes in Settings
//   useAnalytics:              staleTime: 2min — heavy queries, low-frequency data
//   useLoyalty/useWallet:      staleTime: 60s  — financial — stay reasonably fresh
//   SyncStatusBadge:           refetchInterval: 60s
// ============================================================================

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Re-fetch when window regains focus — primary mechanism for picking
      // up changes from other terminals on the same LAN.
      refetchOnWindowFocus: true,

      // 5 minutes — data is "fresh" for 5 minutes after it was last fetched.
      // Our own mutations call explicit invalidation so this only matters for
      // background polling and multi-terminal freshness.
      staleTime: 5 * 60_000,

      // Keep unmounted query data in cache for 10 minutes.
      gcTime: 10 * 60_000,

      // Don't retry on permanent client errors (auth, validation, not-found).
      // Do retry up to 2 times on transient server / network errors.
      retry: (failureCount, error) => {
        if (typeof error === "string" && (
          error.startsWith("Unauthorized") ||
          error.startsWith("Forbidden")    ||
          error.startsWith("Not found")    ||
          error.startsWith("Validation")
        )) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      // Mutations never retry — a double-submitted sale is worse than a
      // failed one that the cashier can retry manually.
      retry: false,
    },
  },
});
