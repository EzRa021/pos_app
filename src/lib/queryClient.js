// ============================================================================
// REACT QUERY CLIENT
// ============================================================================
// Shared QueryClient instance. Import this wherever you need direct access
// (e.g. to invalidate queries after mutations).
//
// Usage in components: wrap the app with <QueryClientProvider client={queryClient}>
// Usage in hooks:      import { useQuery, useMutation } from "@tanstack/react-query"
// ============================================================================

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Re-fetch when window regains focus (good for POS data freshness)
      refetchOnWindowFocus: true,
      // Don't retry on 4xx errors (auth/validation failures are not transient)
      retry: (failureCount, error) => {
        if (typeof error === "string" && (
          error.startsWith("Unauthorized") ||
          error.startsWith("Forbidden") ||
          error.startsWith("Not found") ||
          error.startsWith("Validation")
        )) return false;
        return failureCount < 2;
      },
      staleTime: 30_000, // 30 s — data considered fresh for 30 seconds
    },
    mutations: {
      // Mutations don't retry by default
      retry: false,
    },
  },
});
