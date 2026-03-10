// ============================================================================
// features/inventory/VarianceReportView.jsx — Stock count variance report
// ============================================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, Minus, RefreshCw, Download, ChevronLeft,
  ClipboardList,
} from "lucide-react";

import { PageHeader }  from "@/components/shared/PageHeader";
import { DataTable }   from "@/components/shared/DataTable";
import { EmptyState }  from "@/components/shared/EmptyState";
import { Spinner }     from "@/components/shared/Spinner";
import { Button }      from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

import { useVarianceReport } from "@/features/inventory/useInventory";
import { useBranchStore }    from "@/stores/branch.store";
import { formatCurrency, formatDecimal, formatDateTime } from "@/lib/format";
import { cn }                from "@/lib/utils";

// ── Summary card ──────────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, icon: Icon, accent }) {
  const accents = {
    primary:     "border-primary/20 bg-primary/5 text-primary",
    success:     "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    warning:     "border-amber-500/20 bg-amber-500/5 text-amber-400",
    destructive: "border-red-500/20 bg-red-500/5 text-red-400",
    muted:       "border-border/60 bg-muted/20 text-muted-foreground",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", accents[accent ?? "muted"])}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-foreground mt-0.5 tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// ── Variance badge ────────────────────────────────────────────────────────────
function VarianceBadge({ qty, value }) {
  const q = parseFloat(qty ?? 0);
  const v = parseFloat(value ?? 0);
  if (q === 0) return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Minus className="h-3 w-3" /> No variance
    </div>
  );
  const isOver = q > 0;
  return (
    <div className={cn("flex items-center gap-1 text-xs font-semibold tabular-nums", isOver ? "text-emerald-400" : "text-rose-400")}>
      {isOver ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {isOver ? "+" : ""}{formatDecimal(q)}
      <span className="text-[10px] font-normal opacity-70">({formatCurrency(Math.abs(v))})</span>
    </div>
  );
}

// ── Apply variances dialog ────────────────────────────────────────────────────
function ApplyVariancesDialog({ open, onOpenChange, mutation, report }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl">
        <div className="h-[3px] bg-amber-500" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">Apply Variances?</DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground">
                  This will update actual stock quantities.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="mb-4 space-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Items with variance</span>
              <span className="font-semibold text-amber-400">{report?.summary?.items_with_variance ?? 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total variance value</span>
              <span className="font-semibold">{formatCurrency(parseFloat(report?.summary?.total_variance_value ?? 0))}</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mb-4">
            Stock levels for all items with counted variances will be updated to the counted quantities. This action cannot be undone.
          </p>
          {mutation.error && (
            <p className="mb-3 text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded px-3 py-2">{String(mutation.error)}</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold" disabled={mutation.isPending}
              onClick={() => mutation.mutate(undefined, { onSuccess: () => onOpenChange(false) })}>
              {mutation.isPending ? "Applying…" : "Apply to Stock"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── VarianceReportView (main export) ─────────────────────────────────────────
export function VarianceReportView({ sessionId }) {
  const navigate  = useNavigate();
  const storeId   = useBranchStore((s) => s.activeStore?.id);
  const [applyOpen, setApplyOpen] = useState(false);
  const [filter, setFilter] = useState("all"); // all | overage | shortage | perfect

  const { report, isLoading, error, applyVariances } = useVarianceReport(sessionId, storeId);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (error)     return <div className="p-6 text-sm text-destructive">{String(error)}</div>;
  if (!report)   return <div className="p-6 text-sm text-muted-foreground">Report not found.</div>;

  const { session, summary, items } = report;

  const hasUnadjusted = items.some((i) => !i.is_adjusted && parseFloat(i.variance_quantity ?? 0) !== 0);

  const filteredItems = items.filter((item) => {
    const v = parseFloat(item.variance_quantity ?? 0);
    if (filter === "overage")  return v > 0;
    if (filter === "shortage") return v < 0;
    if (filter === "perfect")  return v === 0;
    return true;
  });

  const filterTabs = [
    { key: "all",      label: "All",      count: items.length },
    { key: "shortage", label: "Shortage", count: items.filter((i) => parseFloat(i.variance_quantity ?? 0) < 0).length },
    { key: "overage",  label: "Overage",  count: items.filter((i) => parseFloat(i.variance_quantity ?? 0) > 0).length },
    { key: "perfect",  label: "Perfect",  count: items.filter((i) => parseFloat(i.variance_quantity ?? 0) === 0).length },
  ];

  const columns = [
    {
      key:    "item_name",
      header: "Item",
      render: (row) => (
        <div>
          <div className="text-xs font-semibold text-foreground">{row.item_name ?? "—"}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[10px] font-mono text-muted-foreground">{row.sku ?? "—"}</span>
            {row.category_name && <span className="text-[10px] text-muted-foreground/60">· {row.category_name}</span>}
          </div>
        </div>
      ),
    },
    {
      key:    "system_quantity",
      header: "System",
      align:  "center",
      render: (row) => <span className="text-xs tabular-nums text-muted-foreground">{formatDecimal(row.system_quantity)}</span>,
    },
    {
      key:    "counted_quantity",
      header: "Counted",
      align:  "center",
      render: (row) => <span className="text-xs font-semibold tabular-nums text-foreground">{formatDecimal(row.counted_quantity)}</span>,
    },
    {
      key:    "variance_quantity",
      header: "Variance",
      align:  "center",
      sortable: true,
      render: (row) => <VarianceBadge qty={row.variance_quantity} value={row.variance_value} />,
    },
    {
      key:    "variance_percentage",
      header: "%",
      align:  "center",
      render: (row) => {
        const pct = parseFloat(row.variance_percentage ?? 0);
        if (pct === 0) return <span className="text-xs text-muted-foreground">0%</span>;
        return (
          <span className={cn("text-xs font-semibold tabular-nums", pct > 0 ? "text-emerald-400" : "text-rose-400")}>
            {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key:    "is_adjusted",
      header: "Applied",
      align:  "center",
      render: (row) => {
        const hasVariance = parseFloat(row.variance_quantity ?? 0) !== 0;
        if (!hasVariance) return <span className="text-[10px] text-muted-foreground">—</span>;
        return row.is_adjusted
          ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"><CheckCircle2 className="h-2.5 w-2.5" />Applied</span>
          : <span className="inline-flex items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">Pending</span>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        backHref={`/stock-counts/${sessionId}`}
        title="Variance Report"
        description={`${session.session_number ?? `Session #${session.id}`} · ${session.status}`}
        badge={
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            session.status === "completed"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400",
          )}>
            {session.status === "completed" ? <CheckCircle2 className="h-2.5 w-2.5" /> : <RefreshCw className="h-2.5 w-2.5" />}
            {session.status}
          </span>
        }
        action={
          hasUnadjusted && (
            <Button size="sm" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold" onClick={() => setApplyOpen(true)}>
              <AlertTriangle className="h-3.5 w-3.5" /> Apply Variances
            </Button>
          )
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-5 space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Total Items"     value={summary.total_items ?? 0}             icon={ClipboardList}  accent="muted" />
            <SummaryCard label="Items Counted"   value={summary.items_counted ?? 0}           icon={CheckCircle2}   accent="success" />
            <SummaryCard label="With Variance"   value={summary.items_with_variance ?? 0}     icon={AlertTriangle}  accent="warning" />
            <SummaryCard label="Variance Value"  value={formatCurrency(parseFloat(summary.total_variance_value ?? 0))} icon={BarChart3} accent="destructive" />
          </div>

          {/* Overage / Shortage breakdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center gap-3">
              <ArrowUpRight className="h-5 w-5 text-emerald-400 shrink-0" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/70">Overage</p>
                <p className="text-lg font-bold text-emerald-400 tabular-nums">{summary.overage_count ?? 0} items</p>
                <p className="text-xs text-emerald-400/60">{formatCurrency(parseFloat(summary.overage_value ?? 0))} surplus</p>
              </div>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 flex items-center gap-3">
              <ArrowDownRight className="h-5 w-5 text-rose-400 shrink-0" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-400/70">Shortage</p>
                <p className="text-lg font-bold text-rose-400 tabular-nums">{summary.shortage_count ?? 0} items</p>
                <p className="text-xs text-rose-400/60">{formatCurrency(Math.abs(parseFloat(summary.shortage_value ?? 0)))} deficit</p>
              </div>
            </div>
          </div>

          {/* Session info */}
          <div className="rounded-xl border border-border bg-card p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            {[
              ["Session",    session.session_number ?? `#${session.id}`],
              ["Started",    formatDateTime(session.started_at)],
              ["Completed",  session.completed_at ? formatDateTime(session.completed_at) : "—"],
              ["Perfect",    `${summary.items_without_variance ?? 0} items`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</dt>
                <dd className="text-foreground font-medium">{value}</dd>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-1 border border-border/60 w-fit">
            {filterTabs.map((t) => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all",
                  filter === t.key
                    ? "bg-card text-foreground shadow-sm border border-border/60"
                    : "text-muted-foreground hover:text-foreground",
                )}>
                {t.label}
                <span className={cn(
                  "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                  filter === t.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {/* Items table */}
          <DataTable
            columns={columns}
            data={filteredItems}
            rowKey="id"
            emptyState={
              <EmptyState icon={BarChart3} title="No items in this filter" description="Try a different tab." compact />
            }
          />
        </div>
      </div>

      <ApplyVariancesDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        mutation={applyVariances}
        report={report}
      />
    </>
  );
}
