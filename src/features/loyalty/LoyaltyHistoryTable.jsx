// features/loyalty/LoyaltyHistoryTable.jsx
import { useMemo } from "react";
import { Star } from "lucide-react";
import { useCustomerLoyalty } from "./useLoyalty";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn }         from "@/lib/utils";
import { formatDateTime } from "@/lib/format";

const TYPE_META = {
  earn:   { label: "Earn",   cls: "bg-success/10 text-success border-success/20"       },
  redeem: { label: "Redeem", cls: "bg-primary/10 text-primary border-primary/20"       },
  adjust: { label: "Adjust", cls: "bg-warning/10 text-warning border-warning/20"       },
  expire: { label: "Expire", cls: "bg-muted/40 text-muted-foreground border-border/40" },
};

export function LoyaltyHistoryTable({ customerId }) {
  const { history, isLoading } = useCustomerLoyalty(customerId);

  const columns = useMemo(() => [
    {
      key: "type",
      header: "Type",
      render: (row) => {
        const meta = TYPE_META[row.type] ?? {
          label: row.type,
          cls: "bg-muted/40 text-muted-foreground border-border/40",
        };
        return (
          <span className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
            meta.cls,
          )}>
            {meta.label}
          </span>
        );
      },
    },
    {
      key: "points",
      header: "Points",
      align: "right",
      render: (row) => {
        // Stored as signed int: earn=+N, redeem/expire=-N, adjust=±N
        const pts = parseInt(row.points ?? 0, 10);
        const positive = pts > 0;
        return (
          <span className={cn(
            "text-xs font-mono font-bold tabular-nums",
            positive ? "text-success" : "text-destructive",
          )}>
            {positive ? "+" : ""}{pts.toLocaleString()}
          </span>
        );
      },
    },
    {
      key: "balance_after",
      header: "Balance After",
      align: "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums text-foreground">
          {parseInt(row.balance_after ?? 0, 10).toLocaleString()} pts
        </span>
      ),
    },
    {
      key: "transaction_id",
      header: "Transaction",
      render: (row) => (
        <span className="text-xs font-mono text-muted-foreground">
          {row.transaction_id ? `#${row.transaction_id}` : "—"}
        </span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      render: (row) => (
        <span
          className="text-xs text-muted-foreground max-w-[200px] truncate block"
          title={row.notes ?? ""}
        >
          {row.notes ?? "—"}
        </span>
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
