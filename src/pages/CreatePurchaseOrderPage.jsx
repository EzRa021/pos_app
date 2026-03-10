// pages/CreatePurchaseOrderPage.jsx — thin wrapper
import { CreatePOPanel } from "@/features/purchase_orders/CreatePOPanel";
export default function CreatePurchaseOrderPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CreatePOPanel />
    </div>
  );
}
