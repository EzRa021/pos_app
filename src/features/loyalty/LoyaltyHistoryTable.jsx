// features/loyalty/LoyaltyHistoryTable.jsx
import { useMemo } from "react";
import { Star } from "lucide-react";
import { useCustomerLoyalty } from "./useLoyalty";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn }         from "@/lib/utils";
import { formatDateTime } from "@/lib/format";

const TYPE_STYLES = {
  earn:       "bg-success/10 text-success border-success/20",
  redeem:     "bg-primary/10 text-primary border-primary/20",
  adjust:     "bg-warning/10 text-warning border-warning/20",
  expire:     "bg-muted/40 text-muted-foreground border-border/40",
};

export function LoyaltyHistoryTable({ customerId }) {
  const { history, isLoading } = useCustomerLoyalty(customerId);

  const columns = useMemo(() => [
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <span className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
          TYPE_STYLES[row.type] ?? "bg-muted/40 text-muted-foreground border-border/40",
        )}>
          {row.type}
        </span>
      ),
    },
    {
      key: "points",
      header: "Points",
      align: "right",
      render: (row) => {
        const pts = parseInt(row.points ?? 0, 10);
        const isAdd = row.type === "earn" || (row.type === "adjust" && pts > 0);
        return (
          <span className={cn(
            "text-xs font-mono font-bold tabular-nums",
            isAdd ? "text-success" : "text-destructive",
          )}>
            {isAdd ? "+" : ""}{pts.toLocaleString()}
          </span>
        );
      },
    },
    {
      key: "balance_after",
      header: "Balance",
      align: "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums text-foreground">
          {parseInt(row.balance_after ?? 0, 10).toLocaleString()} pts
        </span>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{row.source ?? "—"}</span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{row.notes ?? "—"}</span>
      ),
    },
    {
      key: "created_at",
      header: "Date",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>
      ),
    },
  ], []);

  return (
    <DataTable
      columns={columns}
      data={history}
      isLoading={isLoading}
      emptyState={
        <EmptyState
          icon={Star}
          title="No loyalty transactions"
          description="Points earned and redeemed will appear here."
          compact
        />
      }
    />
  );
}
