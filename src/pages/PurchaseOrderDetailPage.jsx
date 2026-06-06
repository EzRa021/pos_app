// pages/PurchaseOrderDetailPage.jsx — thin wrapper
import { PurchaseOrderDetailPanel } from "@/features/purchase_orders/PurchaseOrderDetailPanel";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
export default function PurchaseOrderDetailPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ErrorBoundary pageLevel={true} fallback={null}>
        <PurchaseOrderDetailPanel />
      </ErrorBoundary>
    </div>
  );
}
