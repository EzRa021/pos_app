// ============================================================================
// features/shifts/ShiftDetailPage.jsx — Full shift breakdown
// ============================================================================
// Data sources:
//   getShift(id)         → full Shift row (all totals already computed on it)
//   getShiftSummary(id)  → expected_balance + movement breakdown
//   getCashMovements(id) → timeline of cash in/out events
//   getTransactions({…}) → transactions filtered by cashier_id + store_id + date range
// ============================================================================

import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Hash, Timer, ShoppingCart, TrendingUp, TrendingDown,
  Banknote, CreditCard, Smartphone, ArrowDownLeft,
  CheckCircle2, AlertTriangle, FileText, Inbox, XCircle,
} from "lucide-react";

import { PageHeader }       from "@/components/shared/PageHeader";
import { StatusBadge }      from "@/components/shared/StatusBadge";
import { EmptyState }       from "@/components/shared/EmptyState";
import { Spinner }          from "@/components/shared/Spinner";
import { Button }           from "@/components/ui/button";

import { getShift, cancelShift } from "@/commands/shifts";
import { getShiftSummary, getCashMovements } from "@/commands/cash_movements";
import { getTransactions }  from "@/commands/transactions";

import {
  formatCurrency, formatDateTime, formatTime, formatDuration,
} from "@/lib/format";
import { CASH_MOVEMENT_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { useShiftStore } from "@/stores/shift.store";
import { toast } from "sonner";

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Info row ───────────────────────────────────────────────────────────────────
function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs font-medium text-right", mono && "font-mono tabular-nums")}>
        {value ?? "—"}
      </span>
    </div>
  );
}

// ── Ledger row ─────────────────────────────────────────────────────────────────
function LedgerRow({ label, value, valueClass, borderTop, large }) {
  return (
    <div className={cn(
      "flex items-center justify-between py-1.5",
      borderTop && "border-t border-border/50 mt-1 pt-2.5",
    )}>
      <span className={cn("text-xs text-muted-foreground", large && "font-semibold text-foreground")}>
        {label}
      </span>
      <span className={cn(
        "font-mono tabular-nums",
        large ? "text-sm font-bold text-foreground" : "text-xs font-semibold",
        valueClass,
      )}>
        {value}
      </span>
    </div>
  );
}

// ── KPI card ───────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, iconColor, iconBg, label, value, sub }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", iconBg)}>
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          {label}
        </p>
        <p className="text-[15px] font-bold tabular-nums text-foreground leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Payment method config ──────────────────────────────────────────────────────
const PAYMENT_CFG = {
  cash:         { label: "Cash",          Icon: Banknote,      color: "text-success",    bar: "bg-success"    },
  card:         { label: "Card",          Icon: CreditCard,    color: "text-primary",    bar: "bg-primary"    },
  transfer:     { label: "Bank Transfer", Icon: ArrowDownLeft, color: "text-warning",    bar: "bg-warning"    },
  mobile_money: { label: "Mobile Money",  Icon: Smartphone,    color: "text-purple-400", bar: "bg-purple-400" },
};

// ── Payment Breakdown ──────────────────────────────────────────────────────────
function PaymentBreakdown({ shift }) {
  const totalSales = parseFloat(shift?.total_sales ?? 0);

  const methods = [
    { key: "cash",         value: parseFloat(shift?.total_cash_sales   ?? 0) },
    { key: "card",         value: parseFloat(shift?.total_card_sales   ?? 0) },
    { key: "transfer",     value: parseFloat(shift?.total_transfers    ?? 0) },
    { key: "mobile_money", value: parseFloat(shift?.total_mobile_sales ?? 0) },
  ].filter((m) => m.value > 0);

  if (methods.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-3 italic">
        No sales recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-3.5">
      {methods.map(({ key, value }) => {
        const cfg  = PAYMENT_CFG[key];
        const pct  = totalSales > 0 ? (value / totalSales) * 100 : 0;
        const Icon = cfg.Icon;
        return (
          <div key={key}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Icon className={cn("h-3 w-3", cfg.color)} />
                <span className="text-xs font-medium text-foreground">{cfg.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {pct.toFixed(1)}%
                </span>
                <span className={cn("text-xs font-mono font-bold tabular-nums", cfg.color)}>
                  {formatCurrency(value)}
                </span>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", cfg.bar)}
                style={{ width: `${Math.max(pct > 0 ? Math.max(pct, 2) : 0, 0)}%` }}
              />
            </div>
          </div>
        );
      })}
      {totalSales > 0 && (
        <div className="flex items-center justify-between pt-2.5 border-t border-border/50">
          <span className="text-xs font-semibold text-foreground">Total Sales</span>
          <span className="text-sm font-mono font-bold tabular-nums text-foreground">
            {formatCurrency(totalSales)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Cash Reconciliation ────────────────────────────────────────────────────────
function CashReconciliation({ shift, summary, isLoading }) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex justify-between items-center py-1">
            <div className="h-3 w-28 rounded skeleton-shimmer" />
            <div className="h-3 w-20 rounded skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  const openingFloat   = parseFloat(shift?.opening_float    ?? 0);
  const totalCashSales = parseFloat(shift?.total_cash_sales ?? 0);
  const totalCashIn    = parseFloat(shift?.total_cash_in    ?? 0);
  const totalCashOut   = parseFloat(shift?.total_cash_out   ?? 0);
  const totalReturns   = parseFloat(shift?.total_returns    ?? 0);
  const expectedBalance = summary
    ? parseFloat(summary.expected_balance ?? 0)
    : openingFloat + totalCashSales + totalCashIn - totalCashOut - totalReturns;
  const actualCash   = shift?.actual_cash != null ? parseFloat(shift.actual_cash) : null;
  const difference   = actualCash != null ? actualCash - expectedBalance : null;
  const isClosed     = shift?.status === "closed";

  return (
    <div>
      <LedgerRow label="Opening Float"          value={formatCurrency(openingFloat)} />
      {totalCashSales > 0 && (
        <LedgerRow label="+ Cash Sales"         value={`+${formatCurrency(totalCashSales)}`} valueClass="text-success" />
      )}
      {totalCashIn > 0 && (
        <LedgerRow label="+ Deposits"           value={`+${formatCurrency(totalCashIn)}`}    valueClass="text-success" />
      )}
      {totalCashOut > 0 && (
        <LedgerRow label="− Withdrawals / Payouts" value={`−${formatCurrency(totalCashOut)}`} valueClass="text-destructive" />
      )}
      {totalReturns > 0 && (
        <LedgerRow label="− Returns"            value={`−${formatCurrency(totalReturns)}`}   valueClass="text-destructive" />
      )}
      <LedgerRow
        label="Expected in Drawer"
        value={formatCurrency(expectedBalance)}
        valueClass="text-primary"
        borderTop
        large
      />
      {isClosed && actualCash != null && (
        <>
          <LedgerRow label="Actual Counted" value={formatCurrency(actualCash)} />
          <LedgerRow
            label={difference >= 0 ? "Over by" : "Short by"}
            value={`${difference >= 0 ? "+" : ""}${formatCurrency(difference)}`}
            valueClass={difference >= 0 ? "text-success" : "text-destructive"}
          />
        </>
      )}
      {!isClosed && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-muted bg-muted/30 px-3 py-2">
          <Timer className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-[11px] text-muted-foreground">
            Shift is still open — actual cash counted at close.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Cash Movements timeline ────────────────────────────────────────────────────
const MOVEMENT_CFG = {
  [CASH_MOVEMENT_TYPES.DEPOSIT]:    { label: "Deposit",    dot: "bg-success",     amt: "text-success",     badge: "bg-success/10 text-success border-success/20",             prefix: "+" },
  [CASH_MOVEMENT_TYPES.WITHDRAWAL]: { label: "Withdrawal", dot: "bg-destructive", amt: "text-destructive", badge: "bg-destructive/10 text-destructive border-destructive/20", prefix: "−" },
  [CASH_MOVEMENT_TYPES.PAYOUT]:     { label: "Payout",     dot: "bg-warning",     amt: "text-warning",     badge: "bg-warning/10 text-warning border-warning/20",             prefix: "−" },
  [CASH_MOVEMENT_TYPES.ADJUSTMENT]: { label: "Adjustment", dot: "bg-primary",     amt: "text-primary",     badge: "bg-primary/10 text-primary border-primary/20",             prefix: ""  },
};

function MovementRow({ movement, isLast }) {
  const cfg    = MOVEMENT_CFG[movement.movement_type] ?? MOVEMENT_CFG[CASH_MOVEMENT_TYPES.DEPOSIT];
  const amount = parseFloat(movement.amount ?? 0);
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex flex-col items-center shrink-0 mt-1">
        <div className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-card shrink-0", cfg.dot)} />
        {!isLast && <div className="w-px flex-1 bg-border/50 mt-1 min-h-[1.5rem]" />}
      </div>
      <div className="flex flex-1 items-start justify-between gap-3 min-w-0 pb-1">
        <div className="min-w-0">
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            cfg.badge,
          )}>
            {cfg.label}
          </span>
          {movement.reason && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{movement.reason}</p>
          )}
          {movement.reference_number && (
            <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono">
              ref: {movement.reference_number}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={cn("text-sm font-bold tabular-nums font-mono", cfg.amt)}>
            {cfg.prefix}{formatCurrency(amount)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {formatTime(movement.created_at)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Transaction status colour ──────────────────────────────────────────────────
const TX_COLOUR = {
  completed: "text-success",
  voided:    "text-destructive",
  refunded:  "text-warning",
};

const PAYMENT_SHORT = {
  cash: "Cash", card: "Card", transfer: "Transfer",
  mobile_money: "Mobile", credit: "Credit", split: "Split",
};

// ── Main page ──────────────────────────────────────────────────────────────────
export function ShiftDetailPage() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const shiftId  = parseInt(id, 10);
  const qc       = useQueryClient();

  const user       = useAuthStore((s) => s.user);
  const isGlobal   = user?.is_global === true;
  const initForStore = useShiftStore((s) => s.initForStore);

  const [cancelConfirm, setCancelConfirm] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: () => cancelShift(shiftId),
    onSuccess: async (cancelled) => {
      toast.success("Shift cancelled.");
      qc.invalidateQueries({ queryKey: ["shift", shiftId] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["store-active-shifts"] });
      // Reset shift store so the sidebar / POS reflect the cancellation
      if (cancelled?.store_id) await initForStore(cancelled.store_id).catch(() => {});
      setCancelConfirm(false);
    },
    onError: (err) => {
      toast.error(typeof err === "string" ? err : "Failed to cancel shift.");
      setCancelConfirm(false);
    },
  });

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: shift, isLoading: shiftLoading, error: shiftError } = useQuery({
    queryKey:  ["shift", shiftId],
    queryFn:   () => getShift(shiftId),
    enabled:   !!shiftId,
    staleTime: 30_000,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey:  ["shift-summary", shiftId],
    queryFn:   () => getShiftSummary(shiftId),
    enabled:   !!shiftId,
    staleTime: 30_000,
  });

  const { data: movements = [], isLoading: movementsLoading } = useQuery({
    queryKey:  ["cash-movements", shiftId],
    queryFn:   () => getCashMovements(shiftId),
    enabled:   !!shiftId,
    staleTime: 30_000,
  });

  const txFilters = useMemo(() => {
    if (!shift) return null;
    return {
      store_id:   shift.store_id,
      cashier_id: shift.opened_by,
      date_from:  shift.opened_at.slice(0, 10),
      date_to:    shift.closed_at
        ? shift.closed_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      page:  1,
      limit: 200,
    };
  }, [shift]);

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey:  ["shift-transactions", shiftId, txFilters],
    queryFn:   () => getTransactions(txFilters),
    enabled:   !!txFilters,
    staleTime: 30_000,
  });

  const transactions = txData?.data ?? [];

  // ── Derived ────────────────────────────────────────────────────────────────
  const isClosed    = shift?.status === "closed" || shift?.status === "cancelled";
  const canCancel   = isGlobal && shift?.opened_by === user?.id && !isClosed;
  const totalSales  = parseFloat(shift?.total_sales   ?? 0);
  const totalReturn = parseFloat(shift?.total_returns ?? 0);
  const txCount     = shift?.transaction_count ?? 0;
  const actualCash  = shift?.actual_cash != null ? parseFloat(shift.actual_cash) : null;
  const expectedBal = summary ? parseFloat(summary.expected_balance ?? 0) : null;
  const difference  = isClosed && actualCash != null && expectedBal != null
    ? actualCash - expectedBal
    : null;

  // ── Loading / Error ────────────────────────────────────────────────────────
  if (shiftLoading) {
    return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  }
  if (shiftError || !shift) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={FileText}
          title="Shift not found"
          description={typeof shiftError === "string" ? shiftError : "This shift could not be loaded."}
          action={<Button variant="outline" onClick={() => navigate("/shifts")}>Back to Shifts</Button>}
        />
      </div>
    );
  }

  const shiftNum = shift.shift_number;
  const duration = formatDuration(shift.opened_at, shift.closed_at);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title={shiftNum}
        description={
          isClosed
            ? `${formatDateTime(shift.opened_at)} → ${formatDateTime(shift.closed_at)}`
            : `Opened ${formatDateTime(shift.opened_at)} · In Progress`
        }
        backHref="/shifts"
        badge={<StatusBadge status={shift.status} size="md" />}
        action={canCancel && (
          <Button
            variant="outline-destructive"
            size="xs"
            className="h-8 gap-1.5"
            onClick={() => setCancelConfirm(true)}
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel Shift
          </Button>
        )}
      />

      {/* ── Inline cancel confirm ───────────────────────────────────────── */}
      {cancelConfirm && (
        <div className="shrink-0 mx-6 mt-0 mb-0">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/8 px-5 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-sm text-destructive font-medium leading-snug">
                Cancel this shift? This cannot be undone. The shift will be marked as cancelled and no cash count is required.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="xs"
                className="h-8"
                onClick={() => setCancelConfirm(false)}
                disabled={cancelMutation.isPending}
              >
                Keep Shift
              </Button>
              <Button
                variant="destructive"
                size="xs"
                className="h-8"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? "Cancelling…" : "Yes, Cancel"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* ── KPI row ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              icon={TrendingUp}
              iconColor="text-success"
              iconBg="bg-success/10 border-success/20"
              label="Total Sales"
              value={formatCurrency(totalSales)}
              sub={totalReturn > 0 ? `Net: ${formatCurrency(totalSales - totalReturn)}` : "gross revenue"}
            />
            <KpiCard
              icon={ShoppingCart}
              iconColor="text-primary"
              iconBg="bg-primary/10 border-primary/20"
              label="Transactions"
              value={String(txCount)}
              sub={
                shift.return_count > 0
                  ? `${shift.return_count} return${shift.return_count !== 1 ? "s" : ""}`
                  : "no returns"
              }
            />
            <KpiCard
              icon={TrendingDown}
              iconColor="text-destructive"
              iconBg="bg-destructive/10 border-destructive/20"
              label="Total Returns"
              value={formatCurrency(totalReturn)}
              sub={totalReturn > 0 ? "returned this shift" : "none this shift"}
            />
            {isClosed && difference != null ? (
              <KpiCard
                icon={difference >= 0 ? CheckCircle2 : AlertTriangle}
                iconColor={difference >= 0 ? "text-success" : "text-destructive"}
                iconBg={difference >= 0 ? "bg-success/10 border-success/20" : "bg-destructive/10 border-destructive/20"}
                label={difference >= 0 ? "Cash Over" : "Cash Short"}
                value={`${difference >= 0 ? "+" : ""}${formatCurrency(difference)}`}
                sub="vs expected"
              />
            ) : (
              <KpiCard
                icon={Timer}
                iconColor="text-muted-foreground"
                iconBg="bg-muted border-border"
                label="Duration"
                value={duration}
                sub={isClosed ? "total shift time" : "and counting…"}
              />
            )}
          </div>

          {/* ── Main grid ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Left col (2/3) */}
            <div className="lg:col-span-2 space-y-5">

              {/* Shift Info */}
              <Section title="Shift Info" icon={Hash}>
                <div className="grid grid-cols-2 gap-x-8">
                  <div>
                    <Row label="Shift #"   value={<span className="font-mono text-primary">{shiftNum}</span>} />
                    <Row label="Cashier"   value={shift.cashier_name ?? "—"} />
                    <Row label="Opened"    value={formatDateTime(shift.opened_at)} />
                    <Row label="Closed"    value={
                      isClosed
                        ? formatDateTime(shift.closed_at)
                        : <span className="text-success font-semibold">In Progress</span>
                    } />
                    <Row label="Duration"  value={duration} />
                  </div>
                  <div>
                    <Row label="Status"    value={<StatusBadge status={shift.status} />} />
                    <Row label="Store ID"  value={`#${shift.store_id}`} mono />
                    {shift.terminal_id && (
                      <Row label="Terminal" value={shift.terminal_id} mono />
                    )}
                    <Row label="Reconciled" value={
                      shift.reconciled
                        ? <span className="text-success font-semibold">Yes</span>
                        : <span className="text-muted-foreground">No</span>
                    } />
                  </div>
                </div>

                {(shift.opening_notes || shift.closing_notes) && (
                  <div className="mt-4 space-y-2.5 pt-3 border-t border-border/50">
                    {shift.opening_notes && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Opening Notes
                        </p>
                        <p className="text-xs text-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
                          {shift.opening_notes}
                        </p>
                      </div>
                    )}
                    {shift.closing_notes && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Closing Notes
                        </p>
                        <p className="text-xs text-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
                          {shift.closing_notes}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* Transactions */}
              <Section title={`Transactions (${transactions.length})`} icon={ShoppingCart}>
                {txLoading ? (
                  <div className="space-y-2.5">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="h-3 w-24 rounded skeleton-shimmer" />
                        <div className="h-3 flex-1 rounded skeleton-shimmer" />
                        <div className="h-3 w-16 rounded skeleton-shimmer" />
                      </div>
                    ))}
                  </div>
                ) : transactions.length === 0 ? (
                  <EmptyState
                    icon={ShoppingCart}
                    title="No transactions"
                    description="No sales were recorded during this shift."
                    compact
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border">
                          {[
                            { label: "Reference", align: "left"   },
                            { label: "Time",      align: "left"   },
                            { label: "Customer",  align: "left"   },
                            { label: "Payment",   align: "left"   },
                            { label: "Total",     align: "right"  },
                            { label: "Status",    align: "center" },
                          ].map(({ label, align }) => (
                            <th
                              key={label}
                              className={cn(
                                "py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground last:pr-0",
                                align === "right"  && "text-right",
                                align === "center" && "text-center",
                                align === "left"   && "text-left",
                              )}
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((tx) => (
                          <tr
                            key={tx.id}
                            onClick={() => navigate(`/transactions/${tx.id}`)}
                            className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                          >
                            <td className="py-2.5 pr-3 font-mono text-primary text-[11px]">
                              {tx.reference_no}
                            </td>
                            <td className="py-2.5 pr-3 text-muted-foreground">
                              {formatTime(tx.created_at)}
                            </td>
                            <td className="py-2.5 pr-3 max-w-[100px] truncate text-foreground">
                              {tx.customer_name ?? (
                                <span className="italic text-muted-foreground">Walk-in</span>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 text-muted-foreground">
                              {PAYMENT_SHORT[tx.payment_method] ?? tx.payment_method}
                            </td>
                            <td className={cn(
                              "py-2.5 pr-3 text-right font-mono font-semibold tabular-nums",
                              TX_COLOUR[tx.status] ?? "text-foreground",
                            )}>
                              {["voided", "refunded"].includes(tx.status) && (
                                <span className="text-muted-foreground line-through mr-1">
                                  {formatCurrency(parseFloat(tx.total_amount ?? 0))}
                                </span>
                              )}
                              {!["voided", "refunded"].includes(tx.status) &&
                                formatCurrency(parseFloat(tx.total_amount ?? 0))}
                            </td>
                            <td className="py-2.5 text-center">
                              <StatusBadge status={tx.status} size="sm" />
                            </td>
                          </tr>
                        ))}
                      </tbody>

                      {/* Footer totals */}
                      <tfoot>
                        <tr className="border-t-2 border-border">
                          <td colSpan={4} className="pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {transactions.filter((t) => t.status === "completed").length} completed
                            {transactions.filter((t) => t.status !== "completed").length > 0 && (
                              <span className="ml-2 text-muted-foreground/60">
                                · {transactions.filter((t) => t.status !== "completed").length} other
                              </span>
                            )}
                          </td>
                          <td className="pt-2.5 text-right font-mono font-bold tabular-nums text-foreground">
                            {formatCurrency(
                              transactions
                                .filter((t) => t.status === "completed")
                                .reduce((s, t) => s + parseFloat(t.total_amount ?? 0), 0),
                            )}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </Section>
            </div>

            {/* Right col (1/3) */}
            <div className="space-y-4">

              {/* Payment breakdown */}
              <Section title="Payment Methods" icon={CreditCard}>
                <PaymentBreakdown shift={shift} />
              </Section>

              {/* Cash reconciliation */}
              <Section title="Cash Reconciliation" icon={Banknote}>
                <CashReconciliation
                  shift={shift}
                  summary={summary}
                  isLoading={summaryLoading}
                />
              </Section>

              {/* Cash movements */}
              <Section title={`Cash Movements (${movements.length})`} icon={ArrowDownLeft}>
                {movementsLoading ? (
                  <div className="space-y-3 py-1">
                    {[1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="h-2.5 w-2.5 rounded-full skeleton-shimmer shrink-0" />
                        <div className="flex-1 space-y-1">
                          <div className="h-3 w-16 rounded skeleton-shimmer" />
                          <div className="h-3 w-28 rounded skeleton-shimmer" />
                        </div>
                        <div className="h-4 w-16 rounded skeleton-shimmer" />
                      </div>
                    ))}
                  </div>
                ) : movements.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-5 text-center">
                    <Inbox className="h-7 w-7 text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground">No cash movements</p>
                  </div>
                ) : (
                  <div>
                    {movements.map((m, idx) => (
                      <MovementRow
                        key={m.id}
                        movement={m}
                        isLast={idx === movements.length - 1}
                      />
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
