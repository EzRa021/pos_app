// pages/NotificationsPage.jsx
import { useState } from "react";
import { Bell, CheckCheck, AlertTriangle, Info, Package, TrendingDown, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader }  from "@/components/shared/PageHeader";
import { DataTable }   from "@/components/shared/DataTable";
import { EmptyState }  from "@/components/shared/EmptyState";
import { Button }      from "@/components/ui/button";
import { cn }          from "@/lib/utils";
import { useNotifications } from "@/features/notifications/useNotifications";
import { formatDateTime }   from "@/lib/format";

const TYPE_FILTERS = [
  { key: "",          label: "All"       },
  { key: "low_stock", label: "Low Stock" },
  { key: "reorder",   label: "Reorder"   },
  { key: "warning",   label: "Warning"   },
  { key: "info",      label: "Info"      },
];

const UNREAD_FILTERS = [
  { key: null,  label: "All"    },
  { key: true,  label: "Unread" },
  { key: false, label: "Read"   },
];

const TYPE_ICONS = {
  low_stock: TrendingDown,
  reorder:   Package,
  info:      Info,
  warning:   AlertTriangle,
  alert:     AlertTriangle,
};

const TYPE_STYLES = {
  low_stock: "text-warning bg-warning/10 border-warning/20",
  reorder:   "text-primary bg-primary/10 border-primary/20",
  info:      "text-primary bg-primary/10 border-primary/20",
  warning:   "text-warning bg-warning/10 border-warning/20",
  alert:     "text-destructive bg-destructive/10 border-destructive/20",
};

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

  const { notifications, isLoading, markRead, markAll } = useNotifications({
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
        <div className="mx-auto max-w-4xl px-6 py-5 space-y-4">

          {/* Filters */}
          <div className="flex items-center flex-wrap gap-3">
            <FilterTabs value={typeFilter} onChange={setTypeFilter} tabs={TYPE_FILTERS} />
            <FilterTabs value={String(unreadFilter)} onChange={(v) => setUnreadFilter(v === "null" ? null : v)} tabs={
              UNREAD_FILTERS.map((f) => ({ ...f, key: String(f.key) }))
            } />
          </div>

          {/* List */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
            ) : notifications.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="No notifications"
                description={typeFilter || unreadFilter != null ? "Try clearing the filters." : "All caught up! Notifications appear here as they arrive."}
              />
            ) : (
              <div className="divide-y divide-border/40">
                {notifications.map((n) => {
                  const Icon  = TYPE_ICONS[n.type] ?? Bell;
                  const style = TYPE_STYLES[n.type] ?? "text-muted-foreground bg-muted/30 border-border/40";
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
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
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
