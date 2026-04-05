// ============================================================================
// features/transactions/TransactionsPanel.jsx  — Redesigned
// ============================================================================
import { useState, useMemo, useCallback, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { usePaginationParams } from "@/hooks/usePaginationParams";
import {
  Receipt, Search, X, Calendar, TrendingUp,
  CheckCircle2, Ban, RefreshCw, ArrowUpRight, User, Filter,
  Zap, Clock, CreditCard, Wallet,
} from "lucide-react";

import { useTransactions, useTransactionStats } from "./useTransactions";
import { PageHeader }    from "@/components/shared/PageHeader";
import { DataTable }     from "@/components/shared/DataTable";
import { EmptyState }    from "@/components/shared/EmptyState";
import { StatusBadge }   from "@/components/shared/StatusBadge";
import { Button }        from "@/components/ui/button";
import { Input }         from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn }            from "@/lib/utils";
import { formatCurrency, formatDateTime, formatRef } from "@/lib/format";

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_TABS = [
  { key: "",          label: "All"       },
  { key: "completed", label: "Completed" },
  { key: "voided",    label: "Voided"    },
  { key: "refunded",  label: "Refunded"  },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash",         label: "Cash" },
  { value: "card",         label: "Card" },
  { value: "transfer",     label: "Bank Transfer" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "credit",       label: "Credit" },
  { value: "wallet",       label: "Wallet" },
  { value: "split",        label: "Split" },
];

const PAYMENT_METHOD_STYLES = {
  cash:         { label: "Cash",          cls: "bg-muted/60 text-muted-foreground border-border/60" },
  card:         { label: "Card",          cls: "bg-primary/10 text-primary border-primary/20" },
  transfer:     { label: "Transfer",      cls: "bg-primary/10 text-primary border-primary/20" },
  mobile_money: { label: "Mobile",        cls: "bg-success/10 text-success border-success/20" },
  credit:       { label: "Credit",        cls: "bg-warning/10 text-warning border-warning/20" },
  wallet:       { label: "Wallet",        cls: "bg-primary/10 text-primary border-primary/20" },
  split:        { label: "Split",         cls: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
};

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = "default", icon: Icon, trend }) {
  const styles = {
    default:     { wrap: "border-border/60 bg-card",                   icon: "bg-muted/40 text-muted-foreground",        val: "text-foreground" },
    primary:     { wrap: "border-primary/20 bg-primary/[0.04]",        icon: "bg-primary/12 text-primary",               val: "text-primary" },
    success:     { wrap: "border-success/20 bg-success/[0.04]",        icon: "bg-success/12 text-success",               val: "text-success" },
    warning:     { wrap: "border-warning/20 bg-warning/[0.04]",        icon: "bg-warning/12 text-warning",               val: "text-warning" },
    destructive: { wrap: "border-destructive/20 bg-destructive/[0.04]",icon: "bg-destructive/12 text-destructive",       val: "text-destructive" },
    muted:       { wrap: "border-border/60 bg-muted/20",               icon: "bg-muted/40 text-muted-foreground",        val: "text-muted-foreground" },
  }[accent];

  return (
    <div className={cn(
      "relative flex flex-col gap-3 rounded-xl border px-4 py-4 overflow-hidden",
      "transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5",
      styles.wrap,
    )}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", styles.icon)}>
          {Icon && <Icon className="h-4 w-4" />}
        </div>
        {trend != null && (
          <span className={cn(
            "flex items-center gap-0.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5",
            trend >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}>
            {trend >= 0 ? "↑" : "↓"}{Math.abs(trend)}%
          </span>
        )}
      </div>

      {/* Value */}
      <div className="flex flex-col gap-0.5">
        <span className={cn("text-2xl font-bold tabular-nums leading-none tracking-tight", styles.val)}>
          {value}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
          {label}
        </span>
        {sub && <span className="text-[11px] text-muted-foreground mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// ── Status Tab Bar ────────────────────────────────────────────────────────────
function TabBar({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-1 border border-border/50">
      {STATUS_TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold",
              "transition-all duration-150 select-none",
              isActive
                ? "bg-card text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-card/50",
            )}
          >
            {tab.label}
            <span className={cn(
              "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1",
              "text-[10px] font-bold tabular-nums transition-colors duration-150",
              isActive ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground",
            )}>
              {(counts[tab.key] ?? 0).toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Payment Badge ─────────────────────────────────────────────────────────────
function PaymentBadge({ method }) {
  const cfg = PAYMENT_METHOD_STYLES[method] ?? { label: method, cls: "bg-muted/60 text-muted-foreground border-border/60" };
  return (
    <span className={cn(
      "inline-flex items-center rounded-md border px-2 py-0.5",
      "text-[10px] font-semibold uppercase tracking-wide",
      cfg.cls,
    )}>
      {cfg.label}
    </span>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────────
function FilterBar({ search, paymentMethod, dateFrom, dateTo, hasFilters, onSearchChange, onPaymentChange, onDateFromChange, onDateToChange, onClear }) {
  return (
    <div className="flex flex-col gap-2.5 pb-4 border-b border-border/50">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            key={search}
            defaultValue={search}
            onChange={onSearchChange}
            placeholder="Ref no, customer, cashier…"
            className="pl-8 h-8 text-xs bg-muted/30 border-border/60 focus:bg-background"
          />
        </div>

        {/* Payment method */}
        <Select
          value={paymentMethod || "ALL"}
          onValueChange={(v) => onPaymentChange(v === "ALL" ? "" : v)}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs bg-muted/30 border-border/60">
            <Filter className="h-3 w-3 mr-1.5 text-muted-foreground shrink-0" />
            <SelectValue placeholder="All Methods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Methods</SelectItem>
            {PAYMENT_METHOD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            type="date"
            value={dateFrom}
            onChange={onDateFromChange}
            className="h-8 text-xs w-[128px] bg-muted/30 border-border/60"
          />
          <span className="text-[11px] text-muted-foreground font-medium">→</span>
          <Input
            type="date"
            value={dateTo}
            onChange={onDateToChange}
            className="h-8 text-xs w-[128px] bg-muted/30 border-border/60"
          />
        </div>

        {/* Clear */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onClear}
            className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export function TransactionsPanel() {
  const navigate = useNavigate();

  const { page, pageSize: _ps, search, setPage, setPageSize, setSearch: setUrlSearch } = usePaginationParams({ defaultPageSize: 25 });
  const [status,        setStatus]        = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [dateFrom,      setDateFrom]      = useState("");
  const [dateTo,        setDateTo]        = useState("");

  const debounceTimer = useRef(null);
  const handleSearchChange = useCallback((e) => {
    const val = e.target.value;
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setUrlSearch(val), 400);
  }, [setUrlSearch]);

  const clearFilters = useCallback(() => {
    clearTimeout(debounceTimer.current);
    setUrlSearch("");
    setDateFrom(""); setDateTo("");
    setStatus(""); setPaymentMethod(""); setPage(1);
  }, [setUrlSearch, setPage]);

  const hasFilters = search || dateFrom || dateTo || status || paymentMethod;

  const { transactions, total, totalPages, isLoading, isFetching } = useTransactions({
    page, limit: 25,
    search:        search         || undefined,
    status:        status         || undefined,
    paymentMethod: paymentMethod  || undefined,
    dateFrom:      dateFrom       || undefined,
    dateTo:        dateTo         || undefined,
  });

  const stats = useTransactionStats();

  const tabCounts = useMemo(() => ({
    "":          stats.total,
    completed:   stats.completed,
    voided:      stats.voided,
    refunded:    stats.refunded,
  }), [stats]);

  const columns = useMemo(() => [
    {
      key:    "reference_no",
      header: "Reference",
      sortable: true,
      render: (row) => (
        <span className="font-mono text-[12px] font-bold text-primary tracking-wide">
          {formatRef(row.reference_no)}
        </span>
      ),
    },
    {
      key:    "created_at",
      header: "Date & Time",
      sortable: true,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-foreground font-medium">
            {new Date(row.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-2.5 w-2.5 shrink-0" />
            {new Date(row.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      ),
    },
    {
      key:    "cashier_name",
      header: "Cashier",
      render: (row) => (
        <span className="text-xs font-medium text-foreground">{row.cashier_name ?? "—"}</span>
      ),
    },
    {
      key:    "customer_name",
      header: "Customer",
      render: (row) => row.customer_id ? (
        <Link
          to={`/customers/${row.customer_id}`}
          className="flex items-center gap-1 text-xs text-primary hover:underline w-fit group"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[9px] font-bold uppercase">
            {row.customer_name.slice(0, 1)}
          </div>
          <span className="group-hover:underline">{row.customer_name}</span>
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground/60 italic">Walk-in</span>
      ),
    },
    {
      key:    "payment_method",
      header: "Method",
      render: (row) => <PaymentBadge method={row.payment_method} />,
    },
    {
      key:    "total_amount",
      header: "Total",
      align:  "right",
      sortable: true,
      render: (row) => (
        <span className="font-mono text-sm font-bold tabular-nums text-foreground">
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
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-150" />
      ),
    },
  ], []);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Complete history of every sale, void, and refund across all cashiers."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">

          {/* ── Stat Cards ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Total Transactions"
              value={stats.total.toLocaleString()}
              sub="all time in this store"
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

          {/* ── Table Section ───────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/10">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Transaction History</h2>
                {total > 0 && (
                  <span className="text-[10px] font-semibold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 tabular-nums">
                    {total.toLocaleString()} records
                  </span>
                )}
              </div>
              {isFetching && !isLoading && (
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-[10px] text-muted-foreground">Refreshing</span>
                </div>
              )}
            </div>

            <div className="px-5 pt-4">
              {/* Filter bar */}
              <FilterBar
                search={search}
                paymentMethod={paymentMethod}
                dateFrom={dateFrom}
                dateTo={dateTo}
                hasFilters={hasFilters}
                onSearchChange={handleSearchChange}
                onPaymentChange={(v) => { setPaymentMethod(v); setPage(1); }}
                onDateFromChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                onDateToChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                onClear={clearFilters}
              />

              {/* Status tabs */}
              <div className="pt-3.5 pb-4">
                <TabBar
                  active={status}
                  onChange={(v) => { setStatus(v); setPage(1); }}
                  counts={tabCounts}
                />
              </div>
            </div>

            {/* Table */}
            <div className="px-5 pb-5">
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
                  onPageSizeChange: setPageSize,
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
            </div>
          </div>

          {/* ── Legend ─────────────────────────────────────────────────── */}
          {transactions.length > 0 && (
            <div className="flex flex-wrap items-center gap-5 px-1 text-[11px] text-muted-foreground/70">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-success" />
                <span>Completed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Ban className="h-3 w-3 text-destructive" />
                <span>Voided</span>
              </div>
              <div className="flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3 text-warning" />
                <span>Refunded</span>
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                <ArrowUpRight className="h-3 w-3" />
                <span>Click any row to view details</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
