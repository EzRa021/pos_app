// ============================================================================
// features/inventory/StockCountList.jsx — Count sessions list + start new
// ============================================================================

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, Plus, CheckCircle2, Clock, Ban,
  ChevronRight, BarChart3, Search, X, TrendingDown,
  RotateCcw, AlertTriangle,
} from "lucide-react";

import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button }     from "@/components/ui/button";
import { Input }      from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useCountSessions, useStockCountStats } from "@/features/inventory/useInventory";
import { useBranchStore }  from "@/stores/branch.store";
import { formatDateTime, formatDate, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Status badge ──────────────────────────────────────────────────────────────
function SessionStatusBadge({ status }) {
  const s = status ?? "in_progress";
  const cfg = {
    in_progress: { cls: "border-amber-500/30 bg-amber-500/10 text-amber-400",     Icon: Clock },
    completed:   { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", Icon: CheckCircle2 },
    cancelled:   { cls: "border-border/60 bg-muted/40 text-muted-foreground",      Icon: Ban },
  };
  const { cls, Icon } = cfg[s] ?? cfg.in_progress;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
      cls,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, accent = "muted", sub }) {
  const styles = {
    muted:   { ring: "border-border/60 bg-card",                      val: "text-foreground"         },
    primary: { ring: "border-primary/25 bg-primary/[0.06]",           val: "text-primary"            },
    success: { ring: "border-emerald-500/25 bg-emerald-500/[0.06]",   val: "text-emerald-400"        },
    warning: { ring: "border-amber-500/25 bg-amber-500/[0.06]",       val: "text-amber-400"          },
    danger:  { ring: "border-destructive/25 bg-destructive/[0.06]",   val: "text-destructive"        },
  };
  const { ring, val } = styles[accent] ?? styles.muted;
  return (
    <div className={cn("rounded-xl border px-4 py-3.5 flex flex-col gap-1.5", ring)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className={cn("h-3.5 w-3.5", val)} />}
      </div>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── Tab group ─────────────────────────────────────────────────────────────────
function TabGroup({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Start session dialog ──────────────────────────────────────────────────────
function StartSessionDialog({ open, onOpenChange, mutation, onSuccess }) {
  const [countType, setCountType] = useState("full");
  const [notes,     setNotes]     = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    mutation.mutate(
      { countType, notes: notes.trim() || null },
      {
        onSuccess: (newSession) => {
          setNotes("");
          setCountType("full");
          onOpenChange(false);
          onSuccess?.(newSession);
        },
      },
    );
  }

  function handleClose(v) {
    if (!mutation.isPending) {
      if (!v) { setNotes(""); setCountType("full"); }
      onOpenChange(v);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-primary" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                <ClipboardList className="h-4 w-4 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">Start Stock Count</DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground">
                  Create a new count session to audit stock levels.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Count Type
              </label>
              <Select value={countType} onValueChange={setCountType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full Count — All items</SelectItem>
                  <SelectItem value="partial">Partial Count — Selected items</SelectItem>
                  <SelectItem value="cycle">Cycle Count — Rotating subset</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Notes{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. End of month audit"
                autoFocus
                className="text-sm"
              />
            </div>

            {mutation.error && (
              <p className="text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">
                {String(mutation.error)}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={mutation.isPending}
                onClick={() => handleClose(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                {mutation.isPending ? "Starting…" : "Start Count"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Count type badge ──────────────────────────────────────────────────────────
function CountTypeBadge({ type }) {
  const cfg = {
    full:    "border-primary/25 bg-primary/10 text-primary",
    partial: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    cycle:   "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  };
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
      cfg[type] ?? cfg.full,
    )}>
      {type ?? "full"}
    </span>
  );
}

// ── Status filter tabs ────────────────────────────────────────────────────────
const STATUS_TABS = [
  { key: "",            label: "All" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed",   label: "Completed" },
  { key: "cancelled",   label: "Cancelled" },
];

const TYPE_TABS = [
  { key: "",        label: "All Types" },
  { key: "full",    label: "Full" },
  { key: "partial", label: "Partial" },
  { key: "cycle",   label: "Cycle" },
];

// ── StockCountList (main export) ──────────────────────────────────────────────
export function StockCountList() {
  const navigate = useNavigate();
  const storeId  = useBranchStore((s) => s.activeStore?.id);

  const [page,            setPage]          = useState(1);
  const [status,          setStatus]        = useState("");
  const [countType,       setCountType]     = useState("");
  const [search,          setSearch]        = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [startOpen,       setStartOpen]     = useState(false);

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const { sessions, total, totalPages, currentPage, isLoading, error, startSession } =
    useCountSessions(storeId, {
      page, limit: 20,
      status:     status    || undefined,
      countType:  countType || undefined,
      search:     debouncedSearch || undefined,
    });

  const {
    total:              statTotal,
    inProgressCount,
    completedCount,
    cancelledCount,
    totalVarianceValue,
    totalItemsVariance,
    isLoading:          statsLoading,
  } = useStockCountStats();

  // Navigate to the new session immediately after it's created
  function handleSessionCreated(newSession) {
    if (newSession?.id) {
      navigate(`/stock-counts/${newSession.id}`);
    }
  }

  const columns = [
    {
      key:    "session_number",
      header: "Session",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-[10px] font-bold text-primary">
            SC
          </div>
          <div>
            <p className="text-xs font-mono font-bold text-foreground">
              {row.session_number ?? `#${row.id}`}
            </p>
            <CountTypeBadge type={row.count_type} />
          </div>
        </div>
      ),
    },
    {
      key:    "status",
      header: "Status",
      render: (row) => <SessionStatusBadge status={row.status} />,
    },
    {
      key:    "progress",
      header: "Progress",
      align:  "center",
      render: (row) => {
        const counted   = row.items_counted ?? 0;
        const totalItems = row.total_items  ?? 0;
        const pct       = totalItems > 0 ? Math.round((counted / totalItems) * 100) : 0;
        return (
          <div className="min-w-[80px]">
            <div className="text-xs font-semibold tabular-nums text-foreground text-center">
              {counted}/{totalItems}
            </div>
            <div className="flex items-center gap-1 mt-1">
              <div className="h-1 flex-1 rounded-full bg-muted/50">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {pct}%
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key:    "items_with_variance",
      header: "Variances",
      align:  "center",
      render: (row) => {
        const v = row.items_with_variance ?? 0;
        return (
          <span className={cn(
            "text-xs font-semibold tabular-nums",
            v > 0 ? "text-amber-400" : "text-muted-foreground",
          )}>
            {v > 0 ? `${v} items` : "—"}
          </span>
        );
      },
    },
    {
      key:    "started_by_username",
      header: "Started By",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.started_by_username ?? "—"}
        </span>
      ),
    },
    {
      key:      "started_at",
      header:   "Date",
      sortable: true,
      render:   (row) => (
        <div>
          <p className="text-xs text-foreground">{formatDate(row.started_at)}</p>
          {row.completed_at && (
            <p className="text-[10px] text-muted-foreground">
              Done {formatDate(row.completed_at)}
            </p>
          )}
        </div>
      ),
    },
    {
      key:    "_action",
      header: "",
      align:  "right",
      render: () => (
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
      ),
    },
  ];

  if (!storeId) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Select a store to view stock counts.
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Stock Counts"
        description="Start and manage physical stock count sessions to audit inventory."
        action={
          <Button size="sm" onClick={() => setStartOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Count
          </Button>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Sessions"
              value={statsLoading ? "—" : statTotal}
              icon={ClipboardList}
              accent="primary"
            />
            <StatCard
              label="In Progress"
              value={statsLoading ? "—" : inProgressCount}
              icon={Clock}
              accent={inProgressCount > 0 ? "warning" : "muted"}
              sub={inProgressCount > 0 ? "Active now" : "None active"}
            />
            <StatCard
              label="Completed"
              value={statsLoading ? "—" : completedCount}
              icon={CheckCircle2}
              accent={completedCount > 0 ? "success" : "muted"}
            />
            <StatCard
              label="Total Variance"
              value={statsLoading ? "—" : formatCurrency(totalVarianceValue)}
              icon={TrendingDown}
              accent={totalVarianceValue !== 0 ? "danger" : "muted"}
              sub={`${totalItemsVariance} items affected`}
            />
          </div>

          {/* Sessions table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Count Sessions
              </h2>
            </div>

            <div className="p-5 space-y-3">
              {/* Search */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by session number, notes, or started by…"
                    className="pl-9 h-8 text-xs"
                  />
                  {search && (
                    <button
                      onClick={() => { setSearch(""); setPage(1); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {(search || status || countType) && (
                  <Button
                    variant="ghost" size="xs"
                    className="h-8 gap-1 text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => { setSearch(""); setStatus(""); setCountType(""); setPage(1); }}
                  >
                    <X className="h-3 w-3" /> Clear
                  </Button>
                )}
              </div>

              {/* Filter tabs */}
              <div className="flex items-center gap-3 flex-wrap">
                <TabGroup
                  tabs={STATUS_TABS}
                  active={status}
                  onChange={(v) => { setStatus(v); setPage(1); }}
                />
                <div className="w-px h-5 bg-border/60 shrink-0" />
                <TabGroup
                  tabs={TYPE_TABS}
                  active={countType}
                  onChange={(v) => { setCountType(v); setPage(1); }}
                />
              </div>

              {error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {String(error)}
                </div>
              ) : (
                <DataTable
                  columns={columns}
                  data={sessions}
                  isLoading={isLoading}
                  rowKey="id"
                  onRowClick={(row) => navigate(`/stock-counts/${row.id}`)}
                  rowClassName="group cursor-pointer hover:bg-muted/30 transition-colors"
                  emptyState={
                    <EmptyState
                      icon={ClipboardList}
                      title={
                        search || status || countType
                          ? "No sessions match your filters"
                          : "No stock counts yet"
                      }
                      description={
                        search || status || countType
                          ? "Try adjusting or clearing the filters."
                          : "Start your first stock count session to audit inventory levels."
                      }
                      action={
                        !(search || status || countType) ? (
                          <Button size="sm" onClick={() => setStartOpen(true)}>
                            <Plus className="h-3.5 w-3.5" /> Start Count
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setSearch(""); setStatus(""); setCountType(""); setPage(1); }}
                          >
                            Clear filters
                          </Button>
                        )
                      }
                      compact
                    />
                  }
                  pagination={
                    totalPages > 1
                      ? { page: currentPage, pageSize: 20, total, onPageChange: setPage }
                      : undefined
                  }
                />
              )}
            </div>
          </div>

        </div>
      </div>

      <StartSessionDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        mutation={startSession}
        onSuccess={handleSessionCreated}
      />
    </>
  );
}
