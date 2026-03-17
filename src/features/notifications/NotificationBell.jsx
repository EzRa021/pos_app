// features/notifications/NotificationBell.jsx — Header badge + dropdown
import { useState, useRef, useEffect } from "react";
import { Bell, Check, CheckCheck, AlertTriangle, Info, Package, TrendingDown, X, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useNotifications, useUnreadCount } from "./useNotifications";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";

const TYPE_ICONS = {
  low_stock:     TrendingDown,
  reorder:       Package,
  info:          Info,
  warning:       AlertTriangle,
  alert:         AlertTriangle,
};

const TYPE_STYLES = {
  low_stock: "text-warning bg-warning/10",
  reorder:   "text-primary bg-primary/10",
  info:      "text-primary bg-primary/10",
  warning:   "text-warning bg-warning/10",
  alert:     "text-destructive bg-destructive/10",
};

function NotificationItem({ n, onRead }) {
  const Icon = TYPE_ICONS[n.type] ?? Bell;
  const style = TYPE_STYLES[n.type] ?? "text-muted-foreground bg-muted/30";

  return (
    <div
      onClick={() => !n.is_read && onRead(n.id)}
      className={cn(
        "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-border/40 last:border-0",
        n.is_read ? "opacity-60 hover:opacity-80" : "hover:bg-muted/30",
      )}
    >
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg mt-0.5", style)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground leading-tight">{n.title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">{formatDateTime(n.created_at)}</p>
      </div>
      {!n.is_read && (
        <div className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
      )}
    </div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);
  const navigate        = useNavigate();
  const unread          = useUnreadCount();
  const { notifications, markRead, markAll } = useNotifications({ limit: 10 });

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleRead = async (id) => {
    try { await markRead.mutateAsync(id); } catch (e) { toast.error(String(e)); }
  };

  const handleMarkAll = async () => {
    try { await markAll.mutateAsync(); } catch (e) { toast.error(String(e)); }
  };

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
          open ? "border-primary/40 bg-primary/10" : "border-border bg-muted/30 hover:bg-muted/60",
        )}
        title="Notifications"
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Notifications</span>
              {unread > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive/15 px-1 text-[9px] font-bold text-destructive">
                  {unread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={handleMarkAll}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted/50">
                  <CheckCheck className="h-3 w-3" />All read
                </button>
              )}
              <button onClick={() => setOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted/50">
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">All caught up!</div>
            ) : (
              notifications.map((n) => (
                <NotificationItem key={n.id} n={n} onRead={handleRead} />
              ))
            )}
          </div>

          {/* Footer — see all */}
          <div className="border-t border-border bg-muted/10 px-4 py-2.5">
            <button
              onClick={() => { setOpen(false); navigate("/notifications"); }}
              className="flex w-full items-center justify-center gap-1.5 text-[11px] font-semibold text-primary hover:text-primary/80"
            >
              View all notifications <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
