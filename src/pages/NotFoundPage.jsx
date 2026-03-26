// ============================================================================
// pages/NotFoundPage.jsx — 404 catch-all
// ============================================================================
import { useNavigate, useLocation } from "react-router-dom";
import { Home, ArrowLeft, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  const navigate  = useNavigate();
  const location  = useLocation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center py-20 px-4">
      {/* Icon */}
      <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-border/60 bg-card shadow-inner">
        <SearchX className="h-10 w-10 text-muted-foreground/25" />
      </div>

      {/* Copy */}
      <div className="space-y-2 max-w-sm">
        <p className="text-4xl font-black text-foreground/10 tabular-nums tracking-tight">404</p>
        <p className="text-base font-bold text-foreground">Page not found</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded border border-border/60">
            {location.pathname}
          </span>
          {" "}doesn't exist.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={() => navigate(-1)}
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        <Button
          onClick={() => navigate("/analytics", { replace: true })}
          className="gap-1.5"
        >
          <Home className="h-4 w-4" />
          Go Home
        </Button>
      </div>
    </div>
  );
}
