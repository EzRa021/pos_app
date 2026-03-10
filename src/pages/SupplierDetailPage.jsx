// pages/SupplierDetailPage.jsx — thin wrapper
import { SupplierDetailPanel } from "@/features/suppliers/SupplierDetailPanel";
export default function SupplierDetailPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SupplierDetailPanel />
    </div>
  );
}
