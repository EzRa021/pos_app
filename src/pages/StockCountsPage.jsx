import { StockCountList } from "@/features/inventory/StockCountList";

export default function StockCountsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <StockCountList />
      </div>
    </div>
  );
}
