// pages/CustomerDetailPage.jsx — thin wrapper
import { CustomerDetailPanel } from "@/features/customers/CustomerDetailPanel";
export default function CustomerDetailPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CustomerDetailPanel />
    </div>
  );
}
