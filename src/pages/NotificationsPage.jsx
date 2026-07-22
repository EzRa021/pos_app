// pages/NotificationsPage.jsx
import { useState } from "react";
import { Bell, CheckCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader }  from "@/components/shared/PageHeader";
import { EmptyState }  from "@/components/shared/EmptyState";
import { Button }      from "@/components/ui/button";
import { cn }          from "@/lib/utils";
import { useNotifications } from "@/features/notifications/useNotifications";
import { NOTIF_TYPE_FILTERS, notifIcon, notifStyle } from "@/features/notifications/notificationMeta";
import { formatDateTime }   from "@/lib/format";

const UNREAD_FILTERS = [
  { key: null,  label: "All"    },
  { key: true,  label: "Unread" },
  { key: false, label: "Read"   },
];

function FilterTabs({ value, onChange, tabs }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 border border-border/60">
      {tabs.map((t) => (
        <button key={String(t.key)} onClick={() => onChange(t.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all",
            String(value) === String(t.key)
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
  const [typeFilter,   setTypeFilter]   = useState("");
  const [unreadFilter, setUnreadFilter] = useState(null);

  const { notifications, isLoading, error, markRead, markAll } = useNotifications({
    type:   typeFilter  || undefined,
    unread: unreadFilter ?? undefined,
    limit:  100,
  });

  const handleMarkRead = async (id) => {
    try { await markRead.mutateAsync(id); } catch (e) { toast.error(String(e)); }
  };

  const handleMarkAll = async () => {
    try { await markAll.mutateAsync(); toast.success("All notifications marked as read."); }
    catch (e) { toast.error(String(e)); }
  };

  const hasUnread = notifications.some((n) => !n.is_read);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Notifications"
        description="System alerts, stock warnings, and reorder reminders."
        action={hasUnread && (
          <Button size="sm" variant="outline" onClick={handleMarkAll} className="gap-1.5">
            <CheckCheck className="h-3.5 w-3.5" />Mark All Read
          </Button>
        )}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-5 space-y-5">

          {/* Filters */}
          <div className="flex items-center flex-wrap gap-3">
            <FilterTabs value={typeFilter} onChange={setTypeFilter} tabs={NOTIF_TYPE_FILTERS} />
            <FilterTabs value={String(unreadFilter)} onChange={(v) => setUnreadFilter(v === "null" ? null : v === "true")} tabs={
              UNREAD_FILTERS.map((f) => ({ ...f, key: String(f.key) }))
            } />
          </div>

          {/* List */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {isLoading ? (
              <div className="divide-y divide-border/40">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-4 px-5 py-4">
                    <div className="h-8 w-8 shrink-0 rounded-lg bg-muted/40 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-1/3 rounded bg-muted/40 animate-pulse" />
                      <div className="h-3 w-2/3 rounded bg-muted/30 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10">
                  <AlertTriangle className="h-6 w-6 text-destructive/70" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Couldn't load notifications</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{String(error?.message ?? error)}</p>
                </div>
              </div>
            ) : notifications.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="No notifications"
                description={typeFilter || unreadFilter != null ? "Try clearing the filters." : "All caught up! Notifications appear here as they arrive."}
              />
            ) : (
              <div className="divide-y divide-border/40">
                {notifications.map((n) => {
                  const Icon  = notifIcon(n.type);
                  const style = notifStyle(n.type);
                  return (
                    <div key={n.id} className={cn(
                      "flex items-start gap-4 px-5 py-4 transition-colors",
                      !n.is_read ? "bg-primary/[0.02] hover:bg-primary/[0.04]" : "hover:bg-muted/20",
                    )}>
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border mt-0.5", style)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className={cn("text-sm font-semibold text-foreground", !n.is_read && "text-primary")}>
                              {n.title}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 mt-0.5">
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatDateTime(n.created_at)}</span>
                            {!n.is_read && (
                              <button
                                onClick={() => handleMarkRead(n.id)}
                                className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/50"
                              >
                                <CheckCheck className="h-2.5 w-2.5" />Read
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
