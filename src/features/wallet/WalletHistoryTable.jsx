// features/wallet/WalletHistoryTable.jsx
import { useMemo } from "react";
import { Wallet } from "lucide-react";
import { useWalletHistory } from "./useWallet";
import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn }         from "@/lib/utils";
import { formatCurrency, formatDateTime } from "@/lib/format";

const TYPE_STYLES = {
  deposit:    "bg-success/10 text-success border-success/20",
  debit:      "bg-destructive/10 text-destructive border-destructive/20",
  refund:     "bg-primary/10 text-primary border-primary/20",
  adjustment: "bg-warning/10 text-warning border-warning/20",
};

export function WalletHistoryTable({ customerId }) {
  const { history, isLoading } = useWalletHistory(customerId, 50);

  const columns = useMemo(() => [
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <span className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
          TYPE_STYLES[row.type] ?? "bg-muted/50 text-muted-foreground border-border/60",
        )}>
          {row.type}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => {
        const amt = parseFloat(row.amount ?? 0);
        const isPositive = row.type === "deposit" || row.type === "refund";
        return (
          <span className={cn(
            "text-xs font-mono font-bold tabular-nums",
            isPositive ? "text-success" : "text-destructive",
          )}>
            {isPositive ? "+" : ""}{formatCurrency(amt)}
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
          {formatCurrency(parseFloat(row.balance_after ?? 0))}
        </span>
      ),
    },
    {
      key: "reference",
      header: "Reference",
      render: (row) => (
        <span className="text-xs text-muted-foreground font-mono">{row.reference ?? "—"}</span>
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
          icon={Wallet}
          title="No wallet transactions"
          description="Deposits and debits will appear here."
          compact
        />
      }
    />
  );
}
