// ============================================================================
// pages/SupplierPaymentsPage.jsx
// ============================================================================
import { SupplierPaymentsPanel } from "@/features/supplier_payments/SupplierPaymentsPanel";
import { PageHeader }            from "@/components/shared/PageHeader";

export default function SupplierPaymentsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Supplier Payments"
        description="Track what you owe suppliers and record payments against purchase orders."
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <SupplierPaymentsPanel />
        </div>
      </div>
    </div>
  );
}
