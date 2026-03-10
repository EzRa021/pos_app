// ============================================================================
// features/inventory/StockCountList.jsx — Count sessions list + start new
// ============================================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, Plus, CheckCircle2, Clock, AlertTriangle,
  ChevronRight, BarChart3,
} from "lucide-react";

import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Spinner }    from "@/components/shared/Spinner";
import { Button }     from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input }   from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useCountSessions } from "@/features/inventory/useInventory";
import { useBranchStore }   from "@/stores/branch.store";
import { formatDateTime, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Status badge ──────────────────────────────────────────────────────────────
function SessionStatusBadge({ status }) {
  const s = status ?? "in_progress";
  const styles = {
    in_progress: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    completed:   "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    cancelled:   "border-border/60 bg-muted/40 text-muted-foreground",
  };
  const icons = {
    in_progress: Clock,
    completed:   CheckCircle2,
    cancelled:   AlertTriangle,
  };
  const Icon = icons[s] ?? Clock;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", styles[s] ?? styles.in_progress)}>
      <Icon className="h-2.5 w-2.5" />
      {s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
    </span>
  );
}

// ── Start session dialog ──────────────────────────────────────────────────────
function StartSessionDialog({ open, onOpenChange, mutation }) {
  const [countType, setCountType] = useState("full");
  const [notes,     setNotes]     = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    mutation.mutate(
      { countType, notes: notes || null },
      { onSuccess: () => { setNotes(""); onOpenChange(false); } },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
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
              <label className="block text-xs font-semibold text-foreground mb-1.5">Count Type</label>
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
              <label className="block text-xs font-semibold text-foreground mb-1.5">Notes</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. End of month audit" autoFocus />
            </div>
            {mutation.error && (
              <p className="text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">{String(mutation.error)}</p>
            )}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
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

// ── StockCountList (main export) ──────────────────────────────────────────────
export function StockCountList() {
  const navigate = useNavigate();
  const storeId  = useBranchStore((s) => s.activeStore?.id);
  const [page, setPage] = useState(1);
  const [startOpen, setStartOpen] = useState(false);

  const { sessions, total, totalPages, currentPage, isLoading, error, startSession, invalidate } =
    useCountSessions(storeId, { page, limit: 20 });

  const navigate_ = useNavigate();

  const columns = [
    {
      key:    "session_number",
      header: "Session",
      render: (row) => (
        <div>
          <div className="text-xs font-semibold font-mono text-foreground">{row.session_number ?? `#${row.id}`}</div>
          <div className="text-[10px] text-muted-foreground">{row.count_type ?? "full"}</div>
        </div>
      ),
    },
    {
      key:    "status",
      header: "Status",
      render: (row) => <SessionStatusBadge status={row.status} />,
    },
    {
      key:    "items_counted",
      header: "Progress",
      align:  "center",
      render: (row) => {
        const counted = row.items_counted ?? 0;
        const total   = row.total_items   ?? 0;
        const pct     = total > 0 ? Math.round((counted / total) * 100) : 0;
        return (
          <div className="text-center">
            <div className="text-xs font-semibold tabular-nums text-foreground">{counted}/{total}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <div className="h-1 flex-1 rounded-full bg-muted/40">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums">{pct}%</span>
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
          <span className={cn("text-xs font-semibold tabular-nums", v > 0 ? "text-amber-400" : "text-muted-foreground")}>{v}</span>
        );
      },
    },
    {
      key:    "started_by_username",
      header: "Started By",
      render: (row) => <span className="text-xs text-muted-foreground">{row.started_by_username ?? "—"}</span>,
    },
    {
      key:    "started_at",
      header: "Date",
      sortable: true,
      render: (row) => (
        <div>
          <div className="text-xs text-foreground">{formatDate(row.started_at)}</div>
          {row.completed_at && (
            <div className="text-[10px] text-muted-foreground">Completed {formatDate(row.completed_at)}</div>
          )}
        </div>
      ),
    },
    {
      key:    "actions",
      header: "",
      align:  "right",
      render: (row) => (
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); navigate_(`/stock-counts/${row.id}`); }}>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      ),
    },
  ];

  if (!storeId) return (
    <div className="p-8 text-center text-sm text-muted-foreground">Select a store to view stock counts.</div>
  );

  return (
    <>
      <PageHeader
        title="Stock Counts"
        description="Start and manage physical stock count sessions. Compare counted quantities to system records."
        action={
          <Button size="sm" onClick={() => setStartOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Count
          </Button>
        }
      />

      <div className="px-6 pt-5 pb-6">
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{String(error)}</div>
        ) : (
          <DataTable
            columns={columns}
            data={sessions}
            isLoading={isLoading}
            rowKey="id"
            onRowClick={(row) => navigate(`/stock-counts/${row.id}`)}
            emptyState={
              <EmptyState
                icon={ClipboardList}
                title="No stock counts yet"
                description="Start your first stock count session to audit inventory levels."
                compact
              />
            }
            pagination={{ page: currentPage, pageSize: 20, total, onPageChange: setPage }}
          />
        )}
      </div>

      <StartSessionDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        mutation={startSession}
      />
    </>
  );
}
