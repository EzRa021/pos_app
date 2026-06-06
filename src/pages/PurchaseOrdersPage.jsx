// pages/PurchaseOrdersPage.jsx — thin wrapper
import { PurchaseOrdersPanel } from "@/features/purchase_orders/PurchaseOrdersPanel";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
export default function PurchaseOrdersPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ErrorBoundary pageLevel={true} fallback={null}>
        <PurchaseOrdersPanel />
      </ErrorBoundary>
    </div>
  );
}
