// pages/CreditSalesPage.jsx — thin wrapper
import { CreditSalesPanel } from "@/features/credit_sales/CreditSalesPanel";
import { useSearchParams } from "react-router-dom";
export default function CreditSalesPage() {
  const [searchParams] = useSearchParams();
  const customerId = parseInt(searchParams.get("customer_id") ?? "", 10);
  const preFilterCustomerId = Number.isFinite(customerId) ? customerId : undefined;
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CreditSalesPanel preFilterCustomerId={preFilterCustomerId} />
    </div>
  );
}
