// commands/notifications.js — In-app notification center
import { rpc } from "@/lib/apiClient";

// NotificationFilters: { store_id, user_id?, unread?, type?, limit? }
export const getNotifications = (params = {}) =>
  rpc("get_notifications", params);

export const getUnreadCount = (storeId, userId = null) =>
  rpc("get_unread_count", { store_id: storeId, user_id: userId });

export const markNotificationRead = (id) =>
  rpc("mark_notification_read", { id });

export const markAllNotificationsRead = (storeId, userId = null) =>
  rpc("mark_all_notifications_read", { store_id: storeId, user_id: userId });
