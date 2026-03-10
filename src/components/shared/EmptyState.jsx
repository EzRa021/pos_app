// ============================================================================
// components/shared/EmptyState.jsx
// ============================================================================
// Shown when a table / list has no results — empty DB query, filtered to zero,
// or a feature the user hasn't used yet.
//
// Props:
//   icon        LucideIcon component      — icon to display (required)
//   title       string                    — short heading (required)
//   description string                    — helper text (optional)
//   action      ReactNode                 — CTA button (optional)
//   compact     boolean                   — reduced padding for use inside cards
// ============================================================================

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className,
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-10 px-4" : "py-20 px-6",
        className
      )}
    >
      {/* Icon container with layered rings for depth */}
      <div className="relative mb-5">
        {/* Outer glow */}
        <div className="absolute inset-0 rounded-2xl bg-muted/40 blur-lg scale-110" />
        {/* Icon box */}
        <div
          className={cn(
            "relative flex items-center justify-center rounded-2xl",
            "border border-border bg-card",
            compact ? "h-12 w-12" : "h-16 w-16"
          )}
        >
          <Icon
            className={cn(
              "text-muted-foreground/50",
              compact ? "h-5 w-5" : "h-7 w-7"
            )}
          />
        </div>
      </div>

      {/* Text */}
      <h3
        className={cn(
          "font-semibold text-foreground",
          compact ? "text-sm" : "text-[15px]"
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            "mt-1.5 text-muted-foreground leading-relaxed max-w-sm",
            compact ? "text-xs" : "text-sm"
          )}
        >
          {description}
        </p>
      )}

      {/* Action */}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
