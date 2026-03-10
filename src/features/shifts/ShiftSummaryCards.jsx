// ============================================================================
// features/shifts/ShiftSummaryCards.jsx
// ============================================================================
// KPI cards displayed on the active-shift panel.
// ShiftSummary fields: total_sales, total_refunds, expected_balance
//   (transaction_count is not in the backend summary model)
// ============================================================================

import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Banknote, Timer } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { cn }             from "@/lib/utils";

function useLiveDuration(startIso) {
  const [label, setLabel] = useState("—");

  useEffect(() => {
    if (!startIso) return;

    function tick() {
      const mins = Math.floor(
        (Date.now() - new Date(startIso).getTime()) / 60_000
      );
      if (mins < 1)  return setLabel("< 1m");
      if (mins < 60) return setLabel(`${mins}m`);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      setLabel(m > 0 ? `${h}h ${m}m` : `${h}h`);
    }

    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [startIso]);

  return label;
}

function KpiCard({ icon: Icon, iconColor, iconBg, label, value, subValue, isLoading }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
        iconBg
      )}>
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
        {subValue && !isLoading && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{subValue}</p>
        )}
      </div>
    </div>
  );
}

export function ShiftSummaryCards({ summary, activeShift, isLoading }) {
  const duration = useLiveDuration(activeShift?.opened_at);

  const totalSales      = parseFloat(summary?.total_sales      ?? "0");
  const totalRefunds    = parseFloat(summary?.total_returns    ?? "0");
  const expectedBalance = parseFloat(summary?.expected_balance ?? "0");

  // Net sales = sales minus refunds
  const netSales = Math.max(0, totalSales - totalRefunds);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        icon={TrendingUp}
        iconColor="text-success"
        iconBg="bg-success/10 border-success/20"
        label="Total Sales"
        value={formatCurrency(totalSales)}
        subValue={totalRefunds > 0 ? `Net: ${formatCurrency(netSales)}` : undefined}
        isLoading={isLoading}
      />
      <KpiCard
        icon={TrendingDown}
        iconColor="text-destructive"
        iconBg="bg-destructive/10 border-destructive/20"
        label="Refunds"
        value={formatCurrency(totalRefunds)}
        subValue={totalRefunds > 0 ? "returned" : "none this shift"}
        isLoading={isLoading}
      />
      <KpiCard
        icon={Banknote}
        iconColor="text-warning"
        iconBg="bg-warning/10 border-warning/20"
        label="Expected Cash"
        value={formatCurrency(expectedBalance)}
        subValue="in drawer"
        isLoading={isLoading}
      />
      <KpiCard
        icon={Timer}
        iconColor="text-muted-foreground"
        iconBg="bg-muted border-border"
        label="Duration"
        value={duration}
        subValue="shift time"
        isLoading={false}
      />
    </div>
  );
}
