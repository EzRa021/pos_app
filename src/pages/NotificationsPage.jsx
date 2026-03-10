// pages/NotificationsPage.jsx — Full notifications center
import { useState } from "react";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { useNotifications } from "@/features/notifications/useNotifications";
import { PageHeader }  from "@/components/shared/PageHeader";
import { EmptyState }  from "@/components/shared/EmptyState";
import { DataTable }   from "@/components/shared/DataTable";
import { Button }      from "@/components/ui/button";

const FILTER_TABS = [
  { key: "",          label: "All"       },
  { key: "unread",    label: "Unread"    },
  { key: "low_stock", label: "Low Stock" },
  { key: "credit",    label: "Credit"    },
  { key: "system",    label: "System"    },
];

const TYPE_ICONS = {
  low_stock: "📦", reorder: "🔄", credit: "💳",
  shift: "🕐", transfer: "🚚", system: "⚙️", alert: "⚠️",
};

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState("");
  const filters = activeTab === "unread" ? { unread: true } : activeTab ? { type: activeTab } : {};

  const { notifications, isLoading, isFetching, markRead, markAll } = useNotifications(filters);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const columns = [
    {
      key: "message",
      header: "Notification",
      render: (row) => (
        <div className="flex items-start gap-3 py-0.5">
          <span className="text-base shrink-0 mt-0.5">{TYPE_ICONS[row.type] ?? "🔔"}</span>
          <div className="min-w-0">
            <p className={cn("text-xs leading-snug", !row.is_read && "font-semibold text-foreground")}>
              {row.message}
            </p>
            {row.context_label && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{row.context_label}</p>
            )}
          </div>
          {!row.is_read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "120px",
      render: (row) => (
        <span className="inline-flex rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
          {row.type?.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Date",
      width: "160px",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "80px",
      align: "right",
      render: (row) => !row.is_read ? (
        <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1"
          onClick={(e) => { e.stopPropagation(); markRead.mutate(row.id); }}>
          Mark read
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Notifications"
        description="System alerts, stock warnings, and activity updates."
        action={unreadCount > 0 && (
          <Button size="sm" variant="outline" disabled={markAll.isPending}
            onClick={() => markAll.mutate()} className="gap-1.5">
            {markAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            Mark all read
          </Button>
        )}
      >
        {/* Filter tabs */}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60 w-fit mt-3">
          {FILTER_TABS.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all",
                activeTab === tab.key
                  ? "bg-card text-foreground shadow-sm border border-border/60"
                  : "text-muted-foreground hover:text-foreground",
              )}>
              {tab.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <DataTable
            columns={columns}
            data={notifications}
            isLoading={isLoading || isFetching}
            emptyState={
              <EmptyState
                icon={Bell}
                title="No notifications"
                description={activeTab ? "No notifications match the selected filter." : "You're all caught up!"}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
