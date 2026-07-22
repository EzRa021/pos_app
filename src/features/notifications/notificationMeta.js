// features/notifications/notificationMeta.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for notification type → icon / style / filter mapping.
// Imported by both NotificationBell and NotificationsPage so the two can never
// drift apart. Keep this list in sync with the notification `type` values the
// backend actually emits (see push_notification callers in transactions.rs).
// ─────────────────────────────────────────────────────────────────────────────
import { Bell, TrendingDown, Ban, Package, AlertTriangle, Info } from "lucide-react";

// Icon per type. `reorder`/`warning`/`info` are kept for forward-compatibility
// even though only `low_stock` and `void_alert` are currently produced.
export const NOTIF_ICONS = {
  low_stock:  TrendingDown,
  void_alert: Ban,
  reorder:    Package,
  warning:    AlertTriangle,
  info:       Info,
  alert:      AlertTriangle,
};

// Token-only styling — never hardcode hex.
export const NOTIF_STYLES = {
  low_stock:  "text-warning bg-warning/10 border-warning/20",
  void_alert: "text-destructive bg-destructive/10 border-destructive/20",
  reorder:    "text-primary bg-primary/10 border-primary/20",
  warning:    "text-warning bg-warning/10 border-warning/20",
  info:       "text-primary bg-primary/10 border-primary/20",
  alert:      "text-destructive bg-destructive/10 border-destructive/20",
};

export const NOTIF_FALLBACK_STYLE = "text-muted-foreground bg-muted/30 border-border/40";

export const notifIcon  = (type) => NOTIF_ICONS[type]  ?? Bell;
export const notifStyle = (type) => NOTIF_STYLES[type] ?? NOTIF_FALLBACK_STYLE;

// Type filter tabs for the Notifications page — only the types the backend
// actually emits, so no tab can ever be permanently empty.
export const NOTIF_TYPE_FILTERS = [
  { key: "",           label: "All"       },
  { key: "low_stock",  label: "Low Stock" },
  { key: "void_alert", label: "Voids"     },
];
