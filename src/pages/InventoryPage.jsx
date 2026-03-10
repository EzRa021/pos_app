import { InventoryDashboard } from "@/features/inventory/InventoryDashboard";

export default function InventoryPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <InventoryDashboard />
      </div>
    </div>
  );
}
