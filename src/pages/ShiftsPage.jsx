// ============================================================================
// pages/ShiftsPage.jsx
// ============================================================================
// Two distinct views depending on who is logged in:
//
//  GLOBAL USER (superadmin, manager with is_global=true)
//  ── Does NOT have a personal shift.
//  ── Sees an "Active Shifts" panel listing every cashier's open shift.
//  ── No "Open Shift" button — global users don't run the register.
//  ── Shift history shows ALL shifts across the store.
//
//  CASHIER / STORE-SCOPED USER
//  ── Existing behaviour: their own active shift panel or "No Active Shift" CTA.
//  ── Shift history shows only their own shifts.
// ============================================================================

import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useNavigate }  from "react-router-dom";
import {
  Timer, XCircle, Plus, Clock,
  User, CalendarDays, StickyNote, Hash,
  Users, ShoppingCart, TrendingUp, Eye,
  AlertCircle, AlertTriangle,
} from "lucide-react";

import { PageHeader }          from "@/components/shared/PageHeader";
import { StatusBadge }         from "@/components/shared/StatusBadge";
import { EmptyState }          from "@/components/shared/EmptyState";
import { Button }              from "@/components/ui/button";

import { OpenShiftModal }      from "@/features/shifts/OpenShiftModal";
import { CloseShiftModal }     from "@/features/shifts/CloseShiftModal";
import { CashMovementModal }   from "@/features/shifts/CashMovementModal";
import { ShiftSummaryCards }   from "@/features/shifts/ShiftSummaryCards";
import { CashMovementsList }   from "@/features/shifts/CashMovementsList";
import { ShiftHistoryTable }   from "@/features/shifts/ShiftHistoryTable";

import { useShift }            from "@/hooks/useShift";
import { useShiftStore }       from "@/stores/shift.store";
import { useAuthStore }        from "@/stores/auth.store";
import { getShiftSummary }     from "@/commands/cash_movements";
import { getStoreActiveShifts, cancelShift } from "@/commands/shifts";
import { toast }               from "sonner";
import { formatDateTime, formatDuration, formatCurrency } from "@/lib/format";
import { cn }                  from "@/lib/utils";

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, action, children, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Shift meta row ─────────────────────────────────────────────────────────────
function ShiftMeta({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL VIEW — Active Shifts Overview
// Shown to superadmin / global-role users.
// ─────────────────────────────────────────────────────────────────────────────
function ActiveShiftCard({ shift, onClick, currentUserId, onCancel, isCancelling }) {
  const totalSales = parseFloat(shift.total_sales ?? 0);
  const txCount    = shift.transaction_count ?? 0;
  const duration   = formatDuration(shift.opened_at);
  const isOwn      = shift.opened_by === currentUserId;
  const [confirm, setConfirm] = useState(false);

  return (
    <div
      className="group relative rounded-xl border border-border bg-card overflow-hidden transition-all duration-150"
    >
      {/* Status stripe */}
      <div className={cn(
        "h-[3px] w-full",
        shift.status === "suspended" ? "bg-warning" : "bg-success",
      )} />

      {/* Clickable main area */}
      <div
        onClick={onClick}
        className="p-4 space-y-3 cursor-pointer hover:bg-muted/10 transition-colors"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono font-bold text-muted-foreground">
                {shift.shift_number}
              </span>
              <StatusBadge status={shift.status} size="sm" />
              {isOwn && (
                <span className="rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase tracking-wider">
                  Yours
                </span>
              )}
            </div>
            <p className="text-sm font-bold text-foreground leading-tight">
              {shift.cashier_name ?? "Unknown"}
            </p>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-[13px] font-bold text-primary uppercase">
            {(shift.cashier_name ?? "?").slice(0, 2)}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted/40 px-2.5 py-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Sales</p>
            <p className="text-xs font-mono font-bold text-success tabular-nums">{formatCurrency(totalSales)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Txns</p>
            <p className="text-xs font-mono font-bold text-foreground tabular-nums">{txCount}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Open</p>
            <p className="text-xs font-mono font-bold text-foreground tabular-nums">{duration}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground">Started {formatDateTime(shift.opened_at)}</p>
          <span className="flex items-center gap-1 text-[10px] font-semibold text-primary/70">
            <Eye className="h-3 w-3" />
            View
          </span>
        </div>
      </div>

      {/* Cancel strip — only for super_admin's own shift */}
      {isOwn && !confirm && (
        <div className="px-4 pb-3">
          <Button
            variant="ghost"
            size="xs"
            className="w-full h-7 gap-1.5 text-destructive/70 hover:text-destructive hover:bg-destructive/8 border border-dashed border-destructive/20"
            onClick={(e) => { e.stopPropagation(); setConfirm(true); }}
          >
            <XCircle className="h-3 w-3" />
            Cancel this shift
          </Button>
        </div>
      )}

      {/* Inline confirm */}
      {isOwn && confirm && (
        <div className="px-4 pb-4 space-y-2">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-[11px] text-destructive leading-relaxed">
              Cancel shift <span className="font-bold">{shift.shift_number}</span>? This cannot be undone.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="xs"
              className="flex-1 h-7"
              onClick={(e) => { e.stopPropagation(); setConfirm(false); }}
              disabled={isCancelling}
            >
              Keep
            </Button>
            <Button
              variant="destructive"
              size="xs"
              className="flex-1 h-7"
              onClick={(e) => { e.stopPropagation(); onCancel(shift.id); }}
              disabled={isCancelling}
            >
              {isCancelling ? "…" : "Cancel Shift"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GlobalShiftsView({ storeId, currentUserId }) {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const initForStore = useShiftStore((s) => s.initForStore);

  const { data: activeShifts = [], isLoading } = useQuery({
    queryKey:        ["store-active-shifts", storeId],
    queryFn:         () => getStoreActiveShifts(storeId),
    enabled:         !!storeId,
    refetchInterval: 30_000,
    staleTime:       0,
  });

  const cancelMutation = useMutation({
    mutationFn: (shiftId) => cancelShift(shiftId),
    onSuccess: async (cancelled) => {
      toast.success("Shift cancelled.");
      qc.invalidateQueries({ queryKey: ["store-active-shifts", storeId] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      if (cancelled?.store_id) await initForStore(cancelled.store_id).catch(() => {});
    },
    onError: (err) => {
      toast.error(typeof err === "string" ? err : "Failed to cancel shift.");
    },
  });

  // Store-wide totals across all active shifts
  const storeTotalSales = activeShifts.reduce(
    (s, sh) => s + parseFloat(sh.total_sales ?? 0), 0,
  );
  const storeTotalTxns = activeShifts.reduce(
    (s, sh) => s + (sh.transaction_count ?? 0), 0,
  );

  return (
    <div className="space-y-5">

      {/* Store-wide KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            icon: Users,
            iconColor: "text-primary",
            iconBg:    "bg-primary/10 border-primary/20",
            label:     "Active Cashiers",
            value:     String(activeShifts.length),
            sub:       activeShifts.length === 0 ? "no shifts open" : "shifts running",
          },
          {
            icon: TrendingUp,
            iconColor: "text-success",
            iconBg:    "bg-success/10 border-success/20",
            label:     "Store Sales Today",
            value:     formatCurrency(storeTotalSales),
            sub:       "across all shifts",
          },
          {
            icon: ShoppingCart,
            iconColor: "text-warning",
            iconBg:    "bg-warning/10 border-warning/20",
            label:     "Total Transactions",
            value:     String(storeTotalTxns),
            sub:       "completed this session",
          },
        ].map(({ icon: Icon, iconColor, iconBg, label, value, sub }) => (
          <div key={label} className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", iconBg)}>
              <Icon className={cn("h-4 w-4", iconColor)} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {label}
              </p>
              {isLoading ? (
                <div className="h-5 w-20 rounded skeleton-shimmer" />
              ) : (
                <p className="text-[15px] font-bold tabular-nums text-foreground leading-tight">
                  {value}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Active shift cards */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="flex h-2 w-2 rounded-full bg-success animate-pulse" />
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Active Shifts
            </h2>
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground">
            Auto-refreshes every 30s
          </span>
        </div>

        <div className="p-5">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-border overflow-hidden">
                  <div className="h-[3px] w-full skeleton-shimmer" />
                  <div className="p-4 space-y-3">
                    <div className="h-4 w-32 rounded skeleton-shimmer" />
                    <div className="grid grid-cols-3 gap-2">
                      {[1,2,3].map((j) => (
                        <div key={j} className="h-12 rounded-lg skeleton-shimmer" />
                      ))}
                    </div>
                    <div className="h-3 w-full rounded skeleton-shimmer" />
                  </div>
                </div>
              ))}
            </div>
          ) : activeShifts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted mb-3">
                <Clock className="h-7 w-7 text-muted-foreground/30" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">
                No active shifts
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                No cashiers have opened a shift yet. Shifts will appear here as cashiers log in and start their sessions.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeShifts.map((shift) => (
                <ActiveShiftCard
                  key={shift.id}
                  shift={shift}
                  onClick={() => navigate(`/shifts/${shift.id}`)}
                  currentUserId={currentUserId}
                  onCancel={(id) => cancelMutation.mutate(id)}
                  isCancelling={cancelMutation.isPending && cancelMutation.variables === shift.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASHIER VIEW — Own active shift
// Existing behaviour, unchanged.
// ─────────────────────────────────────────────────────────────────────────────
function NoShiftState({ onOpen }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16 px-6 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-3xl bg-muted/60 blur-xl scale-125" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-border bg-card">
          <Timer className="h-9 w-9 text-muted-foreground/40" />
        </div>
      </div>
      <div className="max-w-xs">
        <h2 className="text-lg font-bold text-foreground">No Active Shift</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Open a shift to start accepting payments,
          tracking cash movements, and recording sales.
        </p>
      </div>
      <Button
        variant="success"
        size="xl"
        onClick={onOpen}
        className="shadow-lg shadow-success/20 px-10"
      >
        <Timer className="h-5 w-5" />
        Open Shift
      </Button>
      <p className="text-[11px] text-muted-foreground">
        View your shift history in the table below.
      </p>
    </div>
  );
}

function ActiveShiftPanel({ activeShift, shiftNumber, summary, summaryLoading, onClose, onCashMove }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="h-[3px] w-full bg-success" />
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <div className="flex h-2 w-2 rounded-full bg-success pulse-dot" />
              <span className="text-xs font-bold uppercase tracking-wider text-success">
                Shift Active
              </span>
              {shiftNumber && (
                <span className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-mono font-semibold text-muted-foreground">
                  <Hash className="h-2.5 w-2.5" />
                  {shiftNumber}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <ShiftMeta icon={User}        label="Cashier" value={activeShift.cashier_name ?? "—"} />
              <ShiftMeta icon={CalendarDays} label="Started" value={formatDateTime(activeShift.opened_at)} />
              {activeShift.opening_notes && (
                <ShiftMeta icon={StickyNote} label="Note" value={activeShift.opening_notes} />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={onCashMove}>
              <Plus className="h-3.5 w-3.5" />
              Cash Movement
            </Button>
            <Button variant="outline-destructive" size="sm" onClick={onClose}>
              <XCircle className="h-3.5 w-3.5" />
              Close Shift
            </Button>
          </div>
        </div>
        <ShiftSummaryCards
          summary={summary}
          activeShift={activeShift}
          isLoading={summaryLoading}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page root
// ─────────────────────────────────────────────────────────────────────────────
export default function ShiftsPage() {
  const [openShiftOpen,  setOpenShiftOpen]  = useState(false);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [cashMoveOpen,   setCashMoveOpen]   = useState(false);

  const user       = useAuthStore((s) => s.user);
  const isGlobal   = user?.is_global === true;

  const { activeShift, isShiftOpen, isLoading: shiftLoading, shiftNumber, shiftId, storeId } = useShift();
  const initForStore = useShiftStore((s) => s.initForStore);

  useEffect(() => {
    if (storeId) initForStore(storeId).catch(() => {});
  }, [storeId, initForStore]);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey:        ["shift-summary", shiftId],
    queryFn:         () => getShiftSummary(shiftId),
    enabled:         isShiftOpen && !!shiftId,
    refetchInterval: 30_000,
    staleTime:       0,
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">

      <PageHeader
        title="Shifts"
        description={
          isGlobal
            ? "Monitor all active cashier shifts across this store."
            : "Manage your shift, track cash movements, and reconcile the drawer."
        }
        badge={
          isGlobal
            ? undefined                         // global users have no personal shift badge
            : isShiftOpen
              ? <StatusBadge status="open" />
              : undefined
        }
        action={
          // Only cashiers get the "Open Shift" header button — never global users
          !isGlobal && !isShiftOpen && !shiftLoading ? (
            <Button variant="success" size="sm" onClick={() => setOpenShiftOpen(true)}>
              <Timer className="h-3.5 w-3.5" />
              Open Shift
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* ── GLOBAL USER VIEW ─────────────────────────────────────────── */}
          {isGlobal && (
            <GlobalShiftsView storeId={storeId} currentUserId={user?.id} />
          )}

          {/* ── CASHIER VIEW ─────────────────────────────────────────────── */}
          {!isGlobal && (
            <>
              {!isShiftOpen && !shiftLoading && (
                <NoShiftState onOpen={() => setOpenShiftOpen(true)} />
              )}

              {isShiftOpen && (
                <ActiveShiftPanel
                  activeShift={activeShift}
                  shiftNumber={shiftNumber}
                  summary={summary}
                  summaryLoading={summaryLoading}
                  onClose={() => setCloseShiftOpen(true)}
                  onCashMove={() => setCashMoveOpen(true)}
                />
              )}

              {isShiftOpen && (
                <Section
                  title="Cash Movements"
                  action={
                    <Button variant="ghost" size="xs" onClick={() => setCashMoveOpen(true)} className="h-7 gap-1">
                      <Plus className="h-3 w-3" />
                      Add
                    </Button>
                  }
                >
                  <CashMovementsList shiftId={shiftId} />
                </Section>
              )}
            </>
          )}

          {/* ── Shift history — always visible for everyone ───────────────── */}
          <Section title={isGlobal ? "All Shift History" : "My Shift History"}>
            <ShiftHistoryTable />
          </Section>

        </div>
      </div>

      <OpenShiftModal  open={openShiftOpen}  onOpenChange={setOpenShiftOpen} />
      <CloseShiftModal open={closeShiftOpen} onOpenChange={setCloseShiftOpen} />
      <CashMovementModal open={cashMoveOpen} onOpenChange={setCashMoveOpen} />
    </div>
  );
}
