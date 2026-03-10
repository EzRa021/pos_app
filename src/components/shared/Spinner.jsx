// ============================================================================
// components/shared/Spinner.jsx
// ============================================================================
// Reusable loading states: full-page, inline, and overlay variants.
//
// Props:
//   variant   "page" | "inline" | "overlay"    default: "page"
//   message   string                           optional label under the spinner
//   size      "sm" | "md" | "lg"              default: "md"
// ============================================================================

import { Loader2 } from "lucide-react";
import { cn }      from "@/lib/utils";

const SIZE = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

export function Spinner({ variant = "page", message, size = "md", className }) {
  const icon = (
    <Loader2 className={cn(SIZE[size], "animate-spin text-primary shrink-0")} />
  );

  // ── Inline ─────────────────────────────────────────────────────────────────
  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        {icon}
        {message && (
          <span className="text-xs text-muted-foreground">{message}</span>
        )}
      </span>
    );
  }

  // ── Overlay ────────────────────────────────────────────────────────────────
  if (variant === "overlay") {
    return (
      <div
        className={cn(
          "absolute inset-0 z-20 flex flex-col items-center justify-center gap-3",
          "bg-background/80 backdrop-blur-[2px] rounded-inherit",
          className
        )}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-card border border-border shadow-xl">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
        {message && (
          <p className="text-xs font-medium text-muted-foreground">{message}</p>
        )}
      </div>
    );
  }

  // ── Page (default) ─────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-4 py-20",
        className
      )}
    >
      {/* Glow ring */}
      <div className="relative flex h-14 w-14 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-primary/10 blur-md" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </div>
      {message && (
        <p className="text-sm text-muted-foreground font-medium">{message}</p>
      )}
    </div>
  );
}
