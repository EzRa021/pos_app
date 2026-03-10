// pages/TransactionsPage.jsx
import { TransactionsPanel } from "@/features/transactions/TransactionsPanel";

export default function TransactionsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TransactionsPanel />
    </div>
  );
}
