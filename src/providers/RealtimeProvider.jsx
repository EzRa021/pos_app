// providers/RealtimeProvider.jsx
// Wraps the authenticated app and activates Supabase realtime subscriptions
// after login. Unsubscribes automatically on logout or store change.
// No-ops gracefully when Supabase isn't configured.

import { useEffect } from "react";
import { useBranchStore } from "@/stores/branch.store";
import { useAuthStore } from "@/stores/auth.store";
import { initSupabaseClient, resetSupabaseClient } from "@/lib/supabase";
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { isApiReady } from "@/lib/apiClient";

function RealtimeSubscriptions() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  useRealtimeInvalidation(storeId);
  return null;
}

export function RealtimeProvider({ children }) {
  const user  = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    // Guard: only call get_supabase_config once the API server is reachable
    // AND we have a valid access token on the wire. Firing earlier produces a
    // 401 "Missing Authorization header" because the Bearer token hasn't been
    // set on apiClient.defaults yet (or the HTTP server isn't up yet).
    if (user && token && isApiReady()) {
      initSupabaseClient().catch(() => {
        // Supabase not configured — silently ignore
      });
    } else if (!user) {
      // User logged out — clean up subscriptions
      resetSupabaseClient();
    }
  }, [user, token]);

  return (
    <>
      {user && <RealtimeSubscriptions />}
      {children}
    </>
  );
}
