// providers/RealtimeProvider.jsx
// Wraps the authenticated app and activates Supabase realtime subscriptions
// after login. Unsubscribes automatically on logout or store change.
// No-ops gracefully when Supabase isn't configured.

import { useEffect } from "react";
import { useBranchStore } from "@/stores/branch.store";
import { useAuthStore } from "@/stores/auth.store";
import { initSupabaseClient, resetSupabaseClient } from "@/lib/supabase";
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";

function RealtimeSubscriptions() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  useRealtimeInvalidation(storeId);
  return null;
}

export function RealtimeProvider({ children }) {
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (user) {
      // User is logged in — try to initialise the Supabase client
      initSupabaseClient().catch(() => {
        // Supabase not configured — silently ignore
      });
    } else {
      // User logged out — clean up subscriptions
      resetSupabaseClient();
    }
  }, [user]);

  return (
    <>
      {user && <RealtimeSubscriptions />}
      {children}
    </>
  );
}
