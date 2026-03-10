// ============================================================================
// components/shared/PageHeader.jsx
// ============================================================================
// Top-of-page header used by every feature screen.
//
// Props:
//   title       string         — Page name (required)
//   description string         — Short subtitle (optional)
//   action      ReactNode      — Primary CTA button slot (top-right, optional)
//   children    ReactNode      — Extra content below the title row (optional)
//                                Use for filter bars, tabs, etc.
//   badge       ReactNode      — Status badge next to the title (optional)
//   backHref    string         — If set, renders a back chevron NavLink (optional)
//
// Design: flush with the AppShell header, uses a bottom border separator.
// The title uses a slightly larger weight to anchor the hierarchy clearly.
// ============================================================================

import { ChevronLeft } from "lucide-react";
import { NavLink }     from "react-router-dom";
import { cn }          from "@/lib/utils";

export function PageHeader({
  title,
  description,
  action,
  children,
  badge,
  backHref,
  className,
}) {
  return (
    <div className={cn("border-b border-border bg-card/40", className)}>
      {/* ── Main row ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
        <div className="flex items-start gap-3 min-w-0">
          {/* Back link */}
          {backHref && (
            <NavLink
              to={backHref}
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center",
                "rounded-md border border-border bg-muted/50",
                "text-muted-foreground hover:text-foreground hover:bg-muted",
                "transition-colors duration-150"
              )}
            >
              <ChevronLeft className="h-4 w-4" />
            </NavLink>
          )}

          {/* Title block */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[15px] font-bold leading-none tracking-tight text-foreground">
                {title}
              </h1>
              {badge && <div className="shrink-0">{badge}</div>}
            </div>
            {description && (
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed max-w-prose">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Action slot */}
        {action && (
          <div className="shrink-0 flex items-center gap-2">{action}</div>
        )}
      </div>

      {/* ── Sub-row slot (filters, tabs, search bar) ───────────────────────── */}
      {children && (
        <div className="px-6 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}
