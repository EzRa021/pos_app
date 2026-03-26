// features/users/useActiveSessions.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getActiveSessions, revokeSession } from "@/commands/security";

// ── Active sessions list ──────────────────────────────────────────────────────
export function useActiveSessions(storeId = null) {
  return useQuery({
    queryKey:       ["active-sessions", storeId],
    queryFn:        () => getActiveSessions(storeId),
    staleTime:      30_000,
    refetchInterval: 60_000, // auto-refresh every 60 s so the list stays live
  });
}

// ── Revoke a specific session ─────────────────────────────────────────────────
export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId) => revokeSession(sessionId),
    onSuccess: () => {
      toast.success("Session revoked — user will be logged out.");
      qc.invalidateQueries({ queryKey: ["active-sessions"] });
    },
    onError: (e) =>
      toast.error(typeof e === "string" ? e : (e?.message ?? "Failed to revoke session")),
  });
}
