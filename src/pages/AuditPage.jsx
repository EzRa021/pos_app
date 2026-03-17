// pages/AuditPage.jsx — Audit log viewer
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Search, X, Calendar } from "lucide-react";
import { PageHeader }  from "@/components/shared/PageHeader";
import { DataTable }   from "@/components/shared/DataTable";
import { EmptyState }  from "@/components/shared/EmptyState";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import { cn }          from "@/lib/utils";
import { getAuditLogs } from "@/commands/audit";
import { useBranchStore } from "@/stores/branch.store";
import { formatDateTime } from "@/lib/format";

const ACTION_STYLES = {
  create: "bg-success/10 text-success border-success/20",
  update: "bg-primary/10 text-primary border-primary/20",
  delete: "bg-destructive/10 text-destructive border-destructive/20",
  login:  "bg-muted/50 text-muted-foreground border-border/60",
  logout: "bg-muted/50 text-muted-foreground border-border/60",
};

export default function AuditPage() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [action,   setAction]   = useState("");
  const [entity,   setEntity]   = useState("");
  const [page,     setPage]     = useState(1);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["audit-logs", storeId, { dateFrom, dateTo, action, entity, page }],
    queryFn:  () => getAuditLogs({
      store_id:    storeId,
      action:      action  || undefined,
      entity_type: entity  || undefined,
      date_from:   dateFrom || undefined,
      date_to:     dateTo   || undefined,
      page,
      page_size: 50,
    }),
    enabled:  !!storeId,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const logs  = data?.data  ?? [];
  const total = data?.total ?? 0;

  const hasFilters = dateFrom || dateTo || action || entity;
  const clearFilters = () => { setDateFrom(""); setDateTo(""); setAction(""); setEntity(""); setPage(1); };

  const columns = [
    {
      key: "created_at",
      header: "Time",
      width: "150px",
      render: (r) => <span className="text-xs text-muted-foreground font-mono">{formatDateTime(r.created_at)}</span>,
    },
    {
      key: "user_name",
      header: "User",
      render: (r) => <span className="text-xs font-semibold text-foreground">{r.user_name ?? r.user_id ?? "—"}</span>,
    },
    {
      key: "action",
      header: "Action",
      render: (r) => (
        <span className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
          ACTION_STYLES[r.action] ?? "bg-muted/50 text-muted-foreground border-border/60",
        )}>
          {r.action}
        </span>
      ),
    },
    {
      key: "entity_type",
      header: "Entity",
      render: (r) => (
        <span className="text-xs text-muted-foreground capitalize">
          {r.entity_type?.replace(/_/g, " ") ?? "—"}
        </span>
      ),
    },
    {
      key: "entity_id",
      header: "ID",
      render: (r) => <span className="text-[11px] font-mono text-muted-foreground">{r.entity_id ? String(r.entity_id).slice(0, 8) : "—"}</span>,
    },
    {
      key: "description",
      header: "Description",
      render: (r) => <span className="text-xs text-muted-foreground">{r.description ?? "—"}</span>,
    },
    {
      key: "ip_address",
      header: "IP",
      render: (r) => <span className="text-[11px] font-mono text-muted-foreground">{r.ip_address ?? "—"}</span>,
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Audit Log"
        description="Complete record of user actions and system events."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-5 space-y-4">

          {/* Filters */}
          <div className="flex items-center flex-wrap gap-3">
            <DateRangePicker
              from={dateFrom} to={dateTo}
              onFromChange={(v) => { setDateFrom(v); setPage(1); }}
              onToChange={(v)   => { setDateTo(v);   setPage(1); }}
              onClear={clearFilters}
            />
            <Input
              placeholder="Action (create, update…)"
              value={action}
              onChange={(e) => { setAction(e.target.value); setPage(1); }}
              className="h-7 w-36 text-[11px]"
            />
            <Input
              placeholder="Entity type"
              value={entity}
              onChange={(e) => { setEntity(e.target.value); setPage(1); }}
              className="h-7 w-36 text-[11px]"
            />
            {hasFilters && (
              <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={clearFilters}>
                <X className="h-3 w-3" />Clear
              </Button>
            )}
          </div>

          <DataTable
            columns={columns}
            data={logs}
            isLoading={isLoading || isFetching}
            pagination={{ page, pageSize: 50, total, onPageChange: setPage }}
            emptyState={
              <EmptyState
                icon={ShieldCheck}
                title="No audit entries"
                description={hasFilters ? "Try clearing the filters." : "Actions will be logged here as they occur."}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
