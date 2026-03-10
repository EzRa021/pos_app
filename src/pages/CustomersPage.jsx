// pages/CustomersPage.jsx — thin wrapper
import { CustomersPanel } from "@/features/customers/CustomersPanel";
export default function CustomersPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CustomersPanel />
    </div>
  );
}
