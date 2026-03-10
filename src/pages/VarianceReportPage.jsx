import { useParams } from "react-router-dom";
import { VarianceReportView } from "@/features/inventory/VarianceReportView";

export default function VarianceReportPage() {
  const { id } = useParams();
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <VarianceReportView sessionId={parseInt(id)} />
    </div>
  );
}
