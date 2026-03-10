// pages/CreditSalesPage.jsx — thin wrapper
import { CreditSalesPanel } from "@/features/credit_sales/CreditSalesPanel";
export default function CreditSalesPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CreditSalesPanel />
    </div>
  );
}
