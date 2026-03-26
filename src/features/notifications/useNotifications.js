// features/notifications/useNotifications.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getNotifications, getUnreadCount,
  markNotificationRead, markAllNotificationsRead,
} from "@/commands/notifications";
import { getReorderAlerts } from "@/commands/reorder_alerts";
import { useBranchStore } from "@/stores/branch.store";
import { useAuthStore }   from "@/stores/auth.store";

export function useNotifications({ type, unread, limit = 30 } = {}) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const userId  = useAuthStore((s) => s.user?.id);
  const qc      = useQueryClient();

  const queryKey = ["notifications", storeId, { type, unread, limit }];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => getNotifications({
      store_id: storeId,
      user_id:  userId,
      type:     type   || undefined,
      unread:   unread || undefined,
      limit,
    }),
    enabled:         !!storeId,
    refetchInterval: 30_000,   // poll every 30 s as fallback
    staleTime:       15_000,
  });

  const invalidateBoth = () => {
    qc.invalidateQueries({ queryKey: ["notifications",       storeId] });
    qc.invalidateQueries({ queryKey: ["notifications-count", storeId] });
  };

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess:  invalidateBoth,
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(storeId, userId),
    onSuccess:  invalidateBoth,
  });

  return {
    notifications: data ?? [],
    isLoading,
    error: error ?? null,
    markRead,
    markAll,
  };
}

export function useUnreadCount() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const userId  = useAuthStore((s) => s.user?.id);

  const { data } = useQuery({
    queryKey:        ["notifications-count", storeId],
    queryFn:         () => getUnreadCount(storeId, userId),
    enabled:         !!storeId,
    refetchInterval: 30_000,
    staleTime:       15_000,
  });

  // Backend returns { unread_count: number } — not { count: number }
  return data?.unread_count ?? 0;
}

// ── Pending reorder-alert count ───────────────────────────────────────────────
// Query key ["reorder-alerts", storeId] intentionally matches the prefix
// invalidated by invalidateAfterSale() in src/lib/invalidations.js, so the
// badge updates immediately after any sale that drops stock below the threshold.
export function useReorderAlertCount() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data } = useQuery({
    queryKey:        ["reorder-alerts", storeId],
    queryFn:         () => getReorderAlerts({ store_id: storeId, status: "pending", limit: 200 }),
    enabled:         !!storeId,
    refetchInterval: 60_000,   // fallback poll every 60 s
    staleTime:       30_000,
  });

  // get_reorder_alerts returns a plain Vec<ReorderAlert> array
  return Array.isArray(data) ? data.length : 0;
}
