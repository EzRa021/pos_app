import { useParams } from "react-router-dom";
import { ItemDetailView } from "@/features/items/ItemDetailView";

export default function ItemDetailPage() {
  const { id } = useParams();
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ItemDetailView itemId={id} />
    </div>
  );
}
