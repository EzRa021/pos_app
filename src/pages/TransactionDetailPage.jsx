// pages/TransactionDetailPage.jsx
import { TransactionDetailPanel } from "@/features/transactions/TransactionDetailPanel";

export default function TransactionDetailPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TransactionDetailPanel />
    </div>
  );
}
