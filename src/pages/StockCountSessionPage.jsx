import { useParams } from "react-router-dom";
import { StockCountRunner } from "@/features/inventory/StockCountRunner";

export default function StockCountSessionPage() {
  const { id } = useParams();
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <StockCountRunner sessionId={parseInt(id)} />
    </div>
  );
}
