// pages/PurchaseOrderDetailPage.jsx — thin wrapper
import { PurchaseOrderDetailPanel } from "@/features/purchase_orders/PurchaseOrderDetailPanel";
export default function PurchaseOrderDetailPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PurchaseOrderDetailPanel />
    </div>
  );
}
