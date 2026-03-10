// features/notifications/useNotifications.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import { useAuthStore }   from "@/stores/auth.store";
import {
  getNotifications, getUnreadCount,
  markNotificationRead, markAllNotificationsRead,
} from "@/commands/notifications";

export function useNotifications(filters = {}) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const userId  = useAuthStore((s) => s.user?.id);
  const qc      = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["notifications", storeId, filters],
    queryFn:  () => getNotifications({ store_id: storeId, user_id: userId, ...filters }),
    enabled:  !!storeId,
    staleTime: 30_000,
    refetchInterval: 30_000,   // poll every 30s
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notifications",    storeId] });
    qc.invalidateQueries({ queryKey: ["notif-unread-count", storeId] });
  };

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess:  invalidate,
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(storeId, userId),
    onSuccess:  invalidate,
  });

  return {
    notifications: data ?? [],
    isLoading,
    isFetching,
    markRead,
    markAll,
  };
}

export function useUnreadCount() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const userId  = useAuthStore((s) => s.user?.id);

  const { data } = useQuery({
    queryKey: ["notif-unread-count", storeId],
    queryFn:  () => getUnreadCount(storeId, userId),
    enabled:  !!storeId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  return data?.count ?? 0;
}
