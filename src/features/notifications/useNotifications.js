// features/notifications/useNotifications.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getNotifications, getUnreadCount,
  markNotificationRead, markAllNotificationsRead,
} from "@/commands/notifications";
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
      type:     type    || undefined,
      unread:   unread  || undefined,
      limit,
    }),
    enabled:          !!storeId,
    refetchInterval:  30_000,  // poll every 30 seconds
    staleTime:        15_000,
  });

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications",     storeId] });
      qc.invalidateQueries({ queryKey: ["notifications-count", storeId] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(storeId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications",     storeId] });
      qc.invalidateQueries({ queryKey: ["notifications-count", storeId] });
    },
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

  return data?.count ?? 0;
}
