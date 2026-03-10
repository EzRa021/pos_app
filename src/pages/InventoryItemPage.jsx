import { useParams } from "react-router-dom";
import { InventoryItemDetail } from "@/features/inventory/InventoryItemDetail";

export default function InventoryItemPage() {
  const { itemId } = useParams();
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <InventoryItemDetail itemId={itemId} />
    </div>
  );
}
