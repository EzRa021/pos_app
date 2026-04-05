// pages/AuditPage.jsx — Audit log viewer
import { useState, useMemo, useCallback } from "react";
import { useQuery }        from "@tanstack/react-query";
import {
  ShieldCheck, X, AlertTriangle, Info, AlertCircle,
  User, Clock, Tag, FileText, Monitor, Globe, ChevronRight,
} from "lucide-react";
import { PageHeader }        from "@/components/shared/PageHeader";
import { DataTable }         from "@/components/shared/DataTable";
import { EmptyState }        from "@/components/shared/EmptyState";
import { DateRangePicker }   from "@/components/shared/DateRangePicker";
import { Button }            from "@/components/ui/button";
import { Input }             from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { cn }                from "@/lib/utils";
import { getAuditLogs }      from "@/commands/audit";
import { useBranchStore }    from "@/stores/branch.store";
import { useAuthStore }      from "@/stores/auth.store";
import { usePermission }     from "@/hooks/usePermission";
import { formatDateTime }    from "@/lib/format";

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIONS = [
  "login", "logout", "change_password",
  "create", "update", "delete", "archive", "activate", "deactivate", "hard_delete",
  "approve", "reject", "void", "cancel",
  "open", "close", "cash_movement", "drawer_event",
  "stock_adjust", "receive",
  "request_price_change", "approve_price_change",
  "partial_refund", "full_refund",
];

const RESOURCES = [
  "auth", "user", "store", "department", "category", "item",
  "transaction", "return", "shift", "customer", "supplier",
  "purchase_order", "expense", "payment",
];

const SEVERITIES = ["info", "warning", "critical"];

const SEVERITY_CONFIG = {
  info:     { label: "Info",     cls: "bg-primary/10 text-primary border-primary/20",         icon: Info },
  warning:  { label: "Warning",  cls: "bg-warning/10 text-warning border-warning/20",         icon: AlertTriangle },
  critical: { label: "Critical", cls: "bg-destructive/10 text-destructive border-destructive/20", icon: AlertCircle },
};

const ACTION_CONFIG = {
  create:  "bg-success/10 text-success border-success/20",
  update:  "bg-primary/10 text-primary border-primary/20",
  delete:  "bg-destructive/10 text-destructive border-destructive/20",
  archive: "bg-destructive/10 text-destructive border-destructive/20",
  approve: "bg-success/10 text-success border-success/20",
  reject:  "bg-destructive/10 text-destructive border-destructive/20",
  void:    "bg-destructive/10 text-destructive border-destructive/20",
  cancel:  "bg-warning/10 text-warning border-warning/20",
  open:    "bg-success/10 text-success border-success/20",
  close:   "bg-warning/10 text-warning border-warning/20",
  login:   "bg-muted/50 text-muted-foreground border-border/60",
  logout:  "bg-muted/50 text-muted-foreground border-border/60",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, accent = "default" }) {
  const ring = {
    default: "border-border/60 bg-card",
    primary: "border-primary/25 bg-primary/[0.06]",
    success: "border-success/25 bg-success/[0.06]",
    warning: "border-warning/25 bg-warning/[0.06]",
    destructive: "border-destructive/25 bg-destructive/[0.06]",
  }[accent];
  const val = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;
  const Icon = cfg.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
      cfg.cls,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

function ActionBadge({ action }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
      ACTION_CONFIG[action] ?? "bg-muted/50 text-muted-foreground border-border/60",
    )}>
      {action?.replace(/_/g, " ")}
    </span>
  );
}

function DetailRow({ icon: Icon, label, value, mono = false }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/30 mt-0.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
        <p className={cn("text-xs text-foreground wrap-break-word", mono && "font-mono")}>{value}</p>
      </div>
    </div>
  );
}

// ── Detail Sheet ──────────────────────────────────────────────────────────────

function AuditDetailSheet({ log, open, onOpenChange }) {
  if (!log) return null;
  const sev = log.severity ?? "info";
  const cfg = SEVERITY_CONFIG[sev] ?? SEVERITY_CONFIG.info;
  const accentColor = sev === "critical" ? "bg-destructive" : sev === "warning" ? "bg-warning" : "bg-primary";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md border-l border-border bg-card p-0 flex flex-col overflow-hidden"
      >
        {/* Accent bar */}
        <div className={cn("h-0.75 w-full shrink-0", accentColor)} />

        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="px-5 pt-5 pb-4 border-b border-border">
            <SheetHeader className="space-y-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                    cfg.cls,
                  )}>
                    <ShieldCheck className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <SheetTitle className="text-sm font-bold leading-none mb-1">
                      Audit Entry #{log.id}
                    </SheetTitle>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDateTime(log.created_at)}
                    </p>
                  </div>
                </div>
                <SeverityBadge severity={sev} />
              </div>
            </SheetHeader>
          </div>

          {/* Badges row */}
          <div className="px-5 py-3 border-b border-border flex flex-wrap gap-2">
            <ActionBadge action={log.action} />
            <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground capitalize">
              {log.resource?.replace(/_/g, " ")}
            </span>
          </div>

          {/* Description */}
          {log.description && (
            <div className="px-5 py-3.5 border-b border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Description</p>
              <p className="text-sm text-foreground leading-relaxed">{log.description}</p>
            </div>
          )}

          {/* Detail rows */}
          <div className="px-5 py-2">
            <DetailRow icon={User}     label="User"       value={log.username ?? (log.user_id ? `User #${log.user_id}` : "System")} />
            <DetailRow icon={Tag}      label="Action"     value={log.action?.replace(/_/g, " ")} />
            <DetailRow icon={FileText} label="Resource"   value={log.resource?.replace(/_/g, " ")} />
            <DetailRow icon={Clock}    label="Timestamp"  value={formatDateTime(log.created_at)} mono />
            <DetailRow icon={Globe}    label="IP Address" value={log.ip_address} mono />
            <DetailRow icon={Monitor}  label="User Agent" value={log.user_agent} />
          </div>

          {/* JSON details if present */}
          {log.details && (
            <div className="px-5 pb-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Additional Details
              </p>
              <pre className="rounded-lg border border-border bg-muted/20 p-3 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap wrap-break-word">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const canViewAudit = usePermission("audit.read");
  const storeId = useBranchStore((s) => s.activeStore?.id);

  if (!canViewAudit) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10">
          <ShieldCheck className="h-7 w-7 text-destructive/70" />
        </div>
        <div className="space-y-1 max-w-xs">
          <p className="font-bold text-foreground">Access denied</p>
          <p className="text-sm text-muted-foreground">You don't have permission to view audit logs.</p>
        </div>
      </div>
    );
  }

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [action,   setAction]   = useState("all");
  const [resource, setResource] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [search,   setSearch]   = useState("");
  const [page,     setPage]     = useState(1);

  // Detail sheet
  const [selected, setSelected] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const clearFilters = useCallback(() => {
    setDateFrom(""); setDateTo("");
    setAction("all"); setResource("all"); setSeverity("all");
    setSearch(""); setPage(1);
  }, []);

  const hasFilters = dateFrom || dateTo || action !== "all" || resource !== "all" || severity !== "all" || search;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["audit-logs", storeId, { dateFrom, dateTo, action, resource, severity, search, page }],
    queryFn: () => getAuditLogs({
      store_id:  storeId,
      action:    action   !== "all" ? action   : undefined,
      resource:  resource !== "all" ? resource : undefined,
      severity:  severity !== "all" ? severity : undefined,
      date_from: dateFrom || undefined,
      date_to:   dateTo   || undefined,
      page,
      limit: 50,
    }),
    enabled:  !!storeId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  // Stats query — no filters, just for the KPI row
  const { data: statsData } = useQuery({
    queryKey: ["audit-stats", storeId],
    queryFn: () => getAuditLogs({ store_id: storeId, limit: 1 }),
    enabled: !!storeId,
    staleTime: 60_000,
  });

  const { data: warnData }  = useQuery({
    queryKey: ["audit-stats-warn",     storeId],
    queryFn: () => getAuditLogs({ store_id: storeId, severity: "warning",  limit: 1 }),
    enabled: !!storeId, staleTime: 60_000,
  });
  const { data: critData }  = useQuery({
    queryKey: ["audit-stats-critical", storeId],
    queryFn: () => getAuditLogs({ store_id: storeId, severity: "critical", limit: 1 }),
    enabled: !!storeId, staleTime: 60_000,
  });
  const { data: todayData } = useQuery({
    queryKey: ["audit-stats-today", storeId],
    queryFn: () => {
      const today = new Date().toISOString().slice(0, 10);
      return getAuditLogs({ store_id: storeId, date_from: today, limit: 1 });
    },
    enabled: !!storeId, staleTime: 60_000,
  });

  const logs  = useMemo(() => data?.data  ?? [], [data]);
  const total = data?.total ?? 0;

  const columns = useMemo(() => [
    {
      key: "created_at",
      header: "Time",
      width: "145px",
      render: (r) => (
        <span className="text-[11px] font-mono text-muted-foreground">
          {formatDateTime(r.created_at)}
        </span>
      ),
    },
    {
      key: "severity",
      header: "Sev.",
      width: "90px",
      render: (r) => <SeverityBadge severity={r.severity ?? "info"} />,
    },
    {
      key: "username",
      header: "User",
      width: "130px",
      render: (r) => (
        <span className="text-xs font-semibold text-foreground">
          {r.username ?? (r.user_id ? `#${r.user_id}` : "System")}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      width: "140px",
      render: (r) => <ActionBadge action={r.action} />,
    },
    {
      key: "resource",
      header: "Resource",
      width: "110px",
      render: (r) => (
        <span className="text-[11px] text-muted-foreground capitalize">
          {r.resource?.replace(/_/g, " ") ?? "—"}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (r) => (
        <span className="text-xs text-muted-foreground line-clamp-1">
          {r.description ?? "—"}
        </span>
      ),
    },
    {
      key: "_chevron",
      header: "",
      width: "32px",
      render: () => <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />,
    },
  ], []);

  const openDetail = useCallback((row) => {
    setSelected(row);
    setSheetOpen(true);
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Audit Log"
        description="Complete tamper-proof record of all user actions and system events."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-5 space-y-5">

          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Events"   value={(statsData?.total ?? 0).toLocaleString()} accent="primary" />
            <StatCard label="Today"          value={(todayData?.total ?? 0).toLocaleString()} accent="default" />
            <StatCard label="Warnings"       value={(warnData?.total  ?? 0).toLocaleString()} accent={(warnData?.total  ?? 0) > 0 ? "warning"     : "default"} />
            <StatCard label="Critical"       value={(critData?.total  ?? 0).toLocaleString()} accent={(critData?.total  ?? 0) > 0 ? "destructive" : "default"} />
          </div>

          {/* Filters */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Filters</h2>
              {hasFilters && (
                <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-muted-foreground" onClick={clearFilters}>
                  <X className="h-3 w-3" />Clear all
                </Button>
              )}
            </div>
            <div className="p-4 flex flex-wrap items-center gap-3">
              <DateRangePicker
                from={dateFrom} to={dateTo}
                onFromChange={(v) => { setDateFrom(v); setPage(1); }}
                onToChange={(v)   => { setDateTo(v);   setPage(1); }}
                onClear={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
              />

              <Select value={severity} onValueChange={(v) => { setSeverity(v); setPage(1); }}>
                <SelectTrigger className="h-7 w-30 text-[11px]">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[11px]">All severities</SelectItem>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s} className="text-[11px] capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
                <SelectTrigger className="h-7 w-37.5 text-[11px]">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[11px]">All actions</SelectItem>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a} value={a} className="text-[11px] capitalize">{a.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={resource} onValueChange={(v) => { setResource(v); setPage(1); }}>
                <SelectTrigger className="h-7 w-35 text-[11px]">
                  <SelectValue placeholder="Resource" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[11px]">All resources</SelectItem>
                  {RESOURCES.map((r) => (
                    <SelectItem key={r} value={r} className="text-[11px] capitalize">{r.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Events
                {total > 0 && (
                  <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                    {total.toLocaleString()}
                  </span>
                )}
              </h2>
              {isFetching && !isLoading && (
                <span className="text-[10px] text-muted-foreground animate-pulse">Refreshing…</span>
              )}
            </div>
            <DataTable
              columns={columns}
              data={logs}
              isLoading={isLoading}
              onRowClick={openDetail}
              pagination={{ page, pageSize: 50, total, onPageChange: setPage }}
              emptyState={
                <EmptyState
                  icon={ShieldCheck}
                  title="No audit entries"
                  description={
                    hasFilters
                      ? "No events match the current filters. Try adjusting or clearing them."
                      : "Events will appear here as users take actions in the system."
                  }
                />
              }
            />
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-5 px-1 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Info         className="h-3 w-3 text-primary"      />
              <span>Info — routine operations</span>
            </div>
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-warning"    />
              <span>Warning — deletes, deactivations, voids</span>
            </div>
            <div className="flex items-center gap-1.5">
              <AlertCircle  className="h-3 w-3 text-destructive" />
              <span>Critical — hard deletes, irreversible actions</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3"                  />
              <span>Click any row to view full details</span>
            </div>
          </div>
        </div>
      </div>

      <AuditDetailSheet
        log={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
