// pages/PurchaseOrdersPage.jsx — thin wrapper
import { PurchaseOrdersPanel } from "@/features/purchase_orders/PurchaseOrdersPanel";
export default function PurchaseOrdersPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PurchaseOrdersPanel />
    </div>
  );
}
