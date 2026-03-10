// pages/SuppliersPage.jsx — thin wrapper
import { SuppliersPanel } from "@/features/suppliers/SuppliersPanel";
export default function SuppliersPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SuppliersPanel />
    </div>
  );
}
