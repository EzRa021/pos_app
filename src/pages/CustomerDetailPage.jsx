// pages/CustomerDetailPage.jsx — thin wrapper
import { CustomerDetailPanel } from "@/features/customers/CustomerDetailPanel";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
export default function CustomerDetailPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ErrorBoundary>
        <CustomerDetailPanel />
      </ErrorBoundary>
    </div>
  );
}
