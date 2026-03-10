// ============================================================================
// features/transactions/TransactionsPanel.jsx
// ============================================================================
import { useState, useMemo, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Receipt, Search, X, Calendar, TrendingUp,
  CheckCircle2, Ban, RefreshCw, ArrowUpRight, User,
} from "lucide-react";

import { useTransactions, useTransactionStats } from "./useTransactions";
import { PageHeader }    from "@/components/shared/PageHeader";
import { DataTable }     from "@/components/shared/DataTable";
import { EmptyState }    from "@/components/shared/EmptyState";
import { StatusBadge }   from "@/components/shared/StatusBadge";
import { Button }        from "@/components/ui/button";
import { Input }         from "@/components/ui/input";
import { cn }            from "@/lib/utils";
import { formatCurrency, formatDateTime, formatRef } from "@/lib/format";

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_TABS = [
  { key: "",          label: "All"       },
  { key: "completed", label: "Completed" },
  { key: "voided",    label: "Voided"    },
  { key: "refunded",  label: "Refunded"  },
];

const PAYMENT_METHOD_STYLES = {
  cash:         { label: "Cash",          cls: "bg-muted/60 text-muted-foreground border-border/60" },
  card:         { label: "Card",          cls: "bg-primary/10 text-primary border-primary/20" },
  transfer:     { label: "Bank Transfer", cls: "bg-primary/10 text-primary border-primary/20" },
  mobile_money: { label: "Mobile Money",  cls: "bg-success/10 text-success border-success/20" },
  credit:       { label: "Credit",        cls: "bg-warning/10 text-warning border-warning/20" },
  split:        { label: "Split",         cls: "bg-muted/60 text-muted-foreground border-border/60" },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function Section({ title, children, action }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent = "default", icon: Icon }) {
  const ring = {
    default:     "border-border/60  bg-card",
    primary:     "border-primary/25 bg-primary/[0.06]",
    success:     "border-success/25 bg-success/[0.06]",
    warning:     "border-warning/25 bg-warning/[0.06]",
    destructive: "border-destructive/25 bg-destructive/[0.06]",
    muted:       "border-border/60  bg-muted/30",
  }[accent];
  const val = {
    default:     "text-foreground",
    primary:     "text-primary",
    success:     "text-success",
    warning:     "text-warning",
    destructive: "text-destructive",
    muted:       "text-muted-foreground",
  }[accent];
  const iconBg = {
    default:     "bg-muted/40 text-muted-foreground",
    primary:     "bg-primary/15 text-primary",
    success:     "bg-success/15 text-success",
    warning:     "bg-warning/15 text-warning",
    destructive: "bg-destructive/15 text-destructive",
    muted:       "bg-muted/40 text-muted-foreground",
  }[accent];

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3.5", ring)}>
      {Icon && (
        <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconBg)}>
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function TabBar({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
      {STATUS_TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          <span className={cn(
            "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
            active === tab.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}>
            {counts[tab.key] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

function PaymentBadge({ method }) {
  const cfg = PAYMENT_METHOD_STYLES[method] ?? { label: method, cls: "bg-muted/60 text-muted-foreground border-border/60" };
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export function TransactionsPanel() {
  const navigate = useNavigate();

  // Filters
  const [page,     setPage]     = useState(1);
  const [search,   setSearch]   = useState("");
  const [status,   setStatus]   = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");

  // Live search debounce (simple)
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const handleSearchChange = useCallback((e) => {
    setSearch(e.target.value);
    clearTimeout(window.__txSearchTimer);
    window.__txSearchTimer = setTimeout(() => {
      setDebouncedSearch(e.target.value);
      setPage(1);
    }, 350);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch(""); setDebouncedSearch(""); setDateFrom(""); setDateTo("");
    setStatus(""); setPage(1);
  }, []);

  const hasFilters = debouncedSearch || dateFrom || dateTo || status;

  const { transactions, total, totalPages, isLoading, isFetching } = useTransactions({
    page,
    limit: 25,
    search:   debouncedSearch || undefined,
    status:   status          || undefined,
    dateFrom: dateFrom        || undefined,
    dateTo:   dateTo          || undefined,
  });

  const stats = useTransactionStats();

  // Tab counts map
  const tabCounts = useMemo(() => ({
    "":          stats.total,
    completed:   stats.completed,
    voided:      stats.voided,
    refunded:    stats.refunded,
  }), [stats]);

  // Columns
  const columns = useMemo(() => [
    {
      key:    "reference_no",
      header: "Reference",
      sortable: true,
      render: (row) => (
        <span className="font-mono text-[12px] font-semibold text-primary">
          {formatRef(row.reference_no)}
        </span>
      ),
    },
    {
      key:    "created_at",
      header: "Date & Time",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDateTime(row.created_at)}
        </span>
      ),
    },
    {
      key:    "cashier_name",
      header: "Cashier",
      render: (row) => (
        <span className="text-xs font-medium">{row.cashier_name ?? "—"}</span>
      ),
    },
    {
      key:    "customer_name",
      header: "Customer",
      render: (row) => row.customer_id ? (
        <Link
          to={`/customers/${row.customer_id}`}
          className="flex items-center gap-1 text-xs text-primary hover:underline w-fit"
          onClick={(e) => e.stopPropagation()}
        >
          <User className="h-3 w-3 shrink-0" />
          {row.customer_name}
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground italic">Walk-in</span>
      ),
    },
    {
      key:    "payment_method",
      header: "Payment",
      render: (row) => <PaymentBadge method={row.payment_method} />,
    },
    {
      key:    "total_amount",
      header: "Total",
      align:  "right",
      sortable: true,
      render: (row) => (
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {formatCurrency(parseFloat(row.total_amount ?? 0))}
        </span>
      ),
    },
    {
      key:    "status",
      header: "Status",
      align:  "center",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key:    "_arrow",
      header: "",
      width:  "36px",
      align:  "right",
      render: () => (
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      ),
    },
  ], []);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Full history of every sale, void, and refund."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-5 space-y-5">

          {/* ── Stat cards ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="All Transactions"
              value={stats.total.toLocaleString()}
              sub="in this store"
              accent="primary"
              icon={Receipt}
            />
            <StatCard
              label="Today's Revenue"
              value={formatCurrency(stats.todayRevenue)}
              sub={`${stats.todayCount} sale${stats.todayCount !== 1 ? "s" : ""} today`}
              accent="success"
              icon={TrendingUp}
            />
            <StatCard
              label="Voided"
              value={stats.voided.toLocaleString()}
              sub="reversed transactions"
              accent={stats.voided > 0 ? "warning" : "muted"}
              icon={Ban}
            />
            <StatCard
              label="Refunded"
              value={stats.refunded.toLocaleString()}
              sub="full or partial refunds"
              accent={stats.refunded > 0 ? "warning" : "muted"}
              icon={RefreshCw}
            />
          </div>

          {/* ── Filters + table ─────────────────────────────────────────── */}
          <Section
            title="Transaction History"
            action={
              isFetching && !isLoading ? (
                <span className="text-[10px] text-muted-foreground animate-pulse">Refreshing…</span>
              ) : null
            }
          >
            {/* Filter bar */}
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex flex-wrap items-center gap-2">
                {/* Search */}
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={handleSearchChange}
                    placeholder="Search by reference…"
                    className="pl-8 h-8 text-xs"
                  />
                </div>

                {/* Date range */}
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                    className="h-8 text-xs w-[130px]"
                  />
                  <span className="text-muted-foreground text-xs">to</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                    className="h-8 text-xs w-[130px]"
                  />
                </div>

                {/* Clear */}
                {hasFilters && (
                  <Button variant="ghost" size="xs" onClick={clearFilters} className="h-8 gap-1">
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>

              {/* Status tabs */}
              <TabBar active={status} onChange={(v) => { setStatus(v); setPage(1); }} counts={tabCounts} />
            </div>

            {/* Table */}
            <DataTable
              columns={columns}
              data={transactions}
              isLoading={isLoading}
              onRowClick={(row) => navigate(`/transactions/${row.id}`)}
              pagination={{
                page,
                pageSize: 25,
                total,
                onPageChange: setPage,
              }}
              emptyState={
                <EmptyState
                  icon={Receipt}
                  title={hasFilters ? "No matching transactions" : "No transactions yet"}
                  description={
                    hasFilters
                      ? "Try adjusting your filters or clearing the search."
                      : "Completed sales will appear here."
                  }
                  compact
                />
              }
            />
          </Section>

          {/* ── Legend ─────────────────────────────────────────────────── */}
          {transactions.length > 0 && (
            <div className="flex flex-wrap items-center gap-5 px-1 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-success" /><span>Completed</span></div>
              <div className="flex items-center gap-1.5"><Ban className="h-3 w-3 text-destructive" /><span>Voided</span></div>
              <div className="flex items-center gap-1.5"><RefreshCw className="h-3 w-3 text-warning" /><span>Refunded</span></div>
              <div className="flex items-center gap-1.5"><ArrowUpRight className="h-3 w-3" /><span>Click row to view details</span></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
