import { ReturnDetailPanel } from "@/features/returns/ReturnDetailPanel";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

export default function ReturnDetailPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ErrorBoundary pageLevel={true} fallback={null}>
        <ReturnDetailPanel />
      </ErrorBoundary>
    </div>
  );
}
