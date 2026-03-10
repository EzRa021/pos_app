// features/notifications/NotificationBell.jsx — Header bell with unread badge + dropdown
import { useState, useRef, useEffect } from "react";
import { Bell, Check, CheckCheck, Loader2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { useNotifications, useUnreadCount } from "./useNotifications";
import { Button } from "@/components/ui/button";

const TYPE_ICONS = {
  low_stock:    "📦",
  reorder:      "🔄",
  credit:       "💳",
  shift:        "🕐",
  transfer:     "🚚",
  system:       "⚙️",
  alert:        "⚠️",
};

function NotifItem({ notif, onMarkRead }) {
  const isRead = notif.is_read;
  return (
    <div
      onClick={() => !isRead && onMarkRead(notif.id)}
      className={cn(
        "flex gap-3 px-4 py-3 border-b border-border/50 last:border-0 cursor-pointer transition-colors",
        isRead ? "opacity-60" : "bg-primary/[0.02] hover:bg-primary/[0.05]",
        !isRead && "hover:bg-muted/40",
      )}
    >
      <span className="text-lg shrink-0 mt-0.5">{TYPE_ICONS[notif.type] ?? "🔔"}</span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs leading-snug", isRead ? "text-muted-foreground" : "text-foreground font-medium")}>
          {notif.message}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(notif.created_at)}</p>
      </div>
      {!isRead && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
      )}
    </div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);
  const navigate        = useNavigate();
  const unread          = useUnreadCount();
  const { notifications, isLoading, markRead, markAll } = useNotifications({ limit: 10 });

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted/60",
          open && "bg-muted/60 text-foreground",
        )}
        aria-label={`Notifications — ${unread} unread`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
            <p className="text-xs font-bold text-foreground">
              Notifications {unread > 0 && <span className="text-primary">({unread} unread)</span>}
            </p>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-muted-foreground"
                  onClick={() => markAll.mutate()}>
                  {markAll.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                  Mark all read
                </Button>
              )}
              <button onClick={() => setOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted/60 text-muted-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No notifications</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotifItem key={n.id} notif={n}
                  onMarkRead={(id) => markRead.mutate(id)} />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border bg-muted/10 px-4 py-2.5">
            <button
              onClick={() => { navigate("/notifications"); setOpen(false); }}
              className="text-[11px] text-primary hover:underline font-semibold w-full text-center"
            >
              View all notifications →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
