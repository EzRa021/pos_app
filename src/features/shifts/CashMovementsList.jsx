// ============================================================================
// features/shifts/CashMovementsList.jsx
// ============================================================================
// CashMovement model fields:
//   id, shift_id, movement_type, amount, reason, reference?, created_by, created_at
//   (NO cashier_name — created_by is a user id)
//
// movement_type values: "deposit" | "withdrawal" | "payout" | "adjustment"
// ============================================================================

import { useQuery }          from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, DollarSign, SlidersHorizontal, Inbox } from "lucide-react";

import { getCashMovements }           from "@/commands/cash_movements";
import { formatCurrency, formatTime } from "@/lib/format";
import { CASH_MOVEMENT_TYPES }        from "@/lib/constants";
import { cn }                         from "@/lib/utils";

const TYPE_CONFIG = {
  [CASH_MOVEMENT_TYPES.DEPOSIT]: {
    label:    "Deposit",
    icon:     ArrowDownLeft,
    dotColor: "bg-success",
    amtColor: "text-success",
    badgeCls: "bg-success/10 text-success border-success/20",
    prefix:   "+",
  },
  [CASH_MOVEMENT_TYPES.WITHDRAWAL]: {
    label:    "Withdrawal",
    icon:     ArrowUpRight,
    dotColor: "bg-destructive",
    amtColor: "text-destructive",
    badgeCls: "bg-destructive/10 text-destructive border-destructive/20",
    prefix:   "−",
  },
  [CASH_MOVEMENT_TYPES.PAYOUT]: {
    label:    "Payout",
    icon:     DollarSign,
    dotColor: "bg-warning",
    amtColor: "text-warning",
    badgeCls: "bg-warning/10 text-warning border-warning/20",
    prefix:   "−",
  },
  [CASH_MOVEMENT_TYPES.ADJUSTMENT]: {
    label:    "Adjustment",
    icon:     SlidersHorizontal,
    dotColor: "bg-primary",
    amtColor: "text-primary",
    badgeCls: "bg-primary/10 text-primary border-primary/20",
    prefix:   "",
  },
};

const FALLBACK_CONFIG = TYPE_CONFIG[CASH_MOVEMENT_TYPES.DEPOSIT];

function MovementRow({ movement, isLast }) {
  const config = TYPE_CONFIG[movement.movement_type] ?? FALLBACK_CONFIG;
  const amount = parseFloat(movement.amount ?? "0");

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex flex-col items-center shrink-0 mt-1">
        <div className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-card shrink-0", config.dotColor)} />
        {!isLast && <div className="w-px flex-1 bg-border/50 mt-1 min-h-[1.5rem]" />}
      </div>

      <div className="flex flex-1 items-start justify-between gap-3 min-w-0 pb-1">
        <div className="min-w-0">
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            config.badgeCls
          )}>
            {config.label}
          </span>
          {movement.reason && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {movement.reason}
            </p>
          )}
          {movement.reference && (
            <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono">
              ref: {movement.reference}
            </p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className={cn("text-sm font-bold tabular-nums font-mono", config.amtColor)}>
            {config.prefix}{formatCurrency(amount)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {formatTime(movement.created_at)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function CashMovementsList({ shiftId }) {
  const { data: movements = [], isLoading } = useQuery({
    queryKey:        ["cash-movements", shiftId],
    queryFn:         () => getCashMovements(shiftId),
    enabled:         !!shiftId,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full skeleton-shimmer shrink-0" />
            <div className="flex-1">
              <div className="h-3 w-16 rounded skeleton-shimmer mb-1.5" />
              <div className="h-3 w-32 rounded skeleton-shimmer" />
            </div>
            <div className="h-4 w-20 rounded skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted mb-3">
          <Inbox className="h-5 w-5 text-muted-foreground/40" />
        </div>
        <p className="text-xs font-medium text-muted-foreground">No cash movements yet</p>
        <p className="text-[11px] text-muted-foreground/60 mt-0.5">
          Deposits, withdrawals, and payouts will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {movements.map((m, idx) => (
        <MovementRow
          key={m.id}
          movement={m}
          isLast={idx === movements.length - 1}
        />
      ))}
    </div>
  );
}
