// ============================================================================
// useBusinessInfo — React Query hook for the current business profile
// ============================================================================
// Fetches once on mount, re-fetches every 5 minutes, and after onboarding
// completes. Returns the full business object plus convenience helpers.
//
// Used by: TitleBar, AppSidebar, SyncStatusBadge
// ============================================================================

import { useQuery }       from '@tanstack/react-query';
import { rpc, isApiReady } from '@/lib/apiClient';

export function useBusinessInfo() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['business-info'],
    queryFn:  () => rpc('get_business_info'),
    // Only run once the API server is actually listening.
    // isApiReady() returns false during splash, setup wizard, and login screens
    // (before setApiBaseUrl() has been called in App.jsx). React Query
    // re-evaluates enabled on every render, so this enables automatically
    // when TitleBar re-renders after the API comes up.
    enabled:  isApiReady(),
    // Stop polling once we have confirmed the business exists.
    // The profile only changes when the user edits it in Settings, which
    // calls queryClient.invalidateQueries(['business-info']) directly.
    // While no business is configured (fresh install), poll every 15 s so
    // the badge and sidebar update immediately after onboarding completes.
    refetchInterval: (query) => {
      return query.state.data ? false : 15_000;
    },
    // Keep stale data visible while re-fetching
    staleTime:    2 * 60_000,
    // Don't retry on error — if it fails it means no business is set up yet
    retry:        false,
    // Don't throw — return undefined on error so callers can show a fallback
    throwOnError: false,
  });

  return {
    business:     data ?? null,
    name:         data?.name         ?? null,
    businessType: data?.business_type ?? null,
    currency:     data?.currency     ?? 'NGN',
    timezone:     data?.timezone     ?? 'Africa/Lagos',
    logoData:     data?.logo_data    ?? null,
    isLoading,
    refetch,
  };
}
