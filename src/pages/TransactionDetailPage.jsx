// pages/TransactionDetailPage.jsx
import { TransactionDetailPanel } from "@/features/transactions/TransactionDetailPanel";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

export default function TransactionDetailPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ErrorBoundary pageLevel={true} fallback={null}>
        <TransactionDetailPanel />
      </ErrorBoundary>
    </div>
  );
}
