// pages/CustomersPage.jsx — thin wrapper
import { CustomersPanel } from "@/features/customers/CustomersPanel";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
export default function CustomersPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ErrorBoundary>
        <CustomersPanel />
      </ErrorBoundary>
    </div>
  );
}
