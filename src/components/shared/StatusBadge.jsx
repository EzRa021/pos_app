// ============================================================================
// components/shared/StatusBadge.jsx
// ============================================================================
// Maps backend status strings → colored badges with semantic meaning.
// Uses the badge variants defined in components/ui/badge.jsx.
//
// Props:
//   status   string   — raw status value from the backend
//   size     "sm"|"md"  — default: "sm"
//
// Status → variant mapping covers all domain status values defined in
// lib/constants.js. Unknown statuses fall back to a neutral outline badge.
// ============================================================================

import { Badge } from "@/components/ui/badge";
import { cn }    from "@/lib/utils";
import { formatStatus } from "@/lib/format";

// Status → badge variant + optional dot color
const STATUS_MAP = {
  // ── Transaction ────────────────────────────────────────────────────────────
  completed:   { variant: "success",     dot: "bg-success"     },
  voided:      { variant: "destructive", dot: "bg-destructive" },
  held:        { variant: "warning",     dot: "bg-warning"     },
  refunded:      { variant: "warning",     dot: "bg-warning"     },
  partial_refund: { variant: "warning",     dot: "bg-warning"     },

  // ── Shift ──────────────────────────────────────────────────────────────────
  open:        { variant: "success",     dot: "bg-success"     },
  closed:      { variant: "secondary",   dot: "bg-muted-foreground" },

  // ── Purchase order ─────────────────────────────────────────────────────────
  draft:       { variant: "secondary",   dot: "bg-muted-foreground" },
  sent:        { variant: "hot",         dot: "bg-primary"     },
  received:    { variant: "success",     dot: "bg-success"     },
  partial:     { variant: "warning",     dot: "bg-warning"     },
  cancelled:   { variant: "destructive", dot: "bg-destructive" },

  // ── Expense ────────────────────────────────────────────────────────────────
  pending:     { variant: "warning",     dot: "bg-warning"     },
  approved:    { variant: "success",     dot: "bg-success"     },
  rejected:    { variant: "destructive", dot: "bg-destructive" },

  // ── Credit sale ────────────────────────────────────────────────────────────
  outstanding: { variant: "destructive", dot: "bg-destructive" },
  paid:        { variant: "success",     dot: "bg-success"     },

  // ── Generic ────────────────────────────────────────────────────────────────
  active:      { variant: "success",     dot: "bg-success"     },
  inactive:    { variant: "secondary",   dot: "bg-muted-foreground" },
  in_progress: { variant: "hot",         dot: "bg-primary"     },
};

export function StatusBadge({ status, size = "sm", className }) {
  const config = STATUS_MAP[status?.toLowerCase?.()] ?? {
    variant: "outline",
    dot: "bg-muted-foreground",
  };

  return (
    <Badge
      variant={config.variant}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium",
        size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1",
        className
      )}
    >
      {/* Status dot */}
      <span
        className={cn(
          "rounded-full shrink-0",
          config.dot,
          size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2"
        )}
      />
      {formatStatus(status)}
    </Badge>
  );
}
