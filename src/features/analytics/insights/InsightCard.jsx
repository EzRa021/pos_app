// features/analytics/insights/InsightCard.jsx
// Renders a single Insight object as a card with severity strip, icon, title, body, action.

import { Link } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, Info, XCircle,
  TrendingUp, Package, Users, DollarSign, ShoppingCart, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LEVEL_META } from "./index";

// Pick an icon based on insight id prefix
function insightIcon(id) {
  if (id.startsWith("sales_"))         return TrendingUp;
  if (id.startsWith("inventory_"))     return Package;
  if (id.startsWith("products_"))      return ShoppingCart;
  if (id.startsWith("customers_"))     return Users;
  if (id.startsWith("operations_"))    return Clock;
  if (id.startsWith("profitability_")) return DollarSign;
  return Info;
}

function levelIcon(level) {
  switch (level) {
    case "critical": return XCircle;
    case "warning":  return AlertTriangle;
    case "success":  return CheckCircle2;
    default:         return Info;
  }
}

/**
 * @param {{ insight: import("./index").Insight, compact?: boolean }} props
 */
export function InsightCard({ insight, compact = false }) {
  const meta   = LEVEL_META[insight.level] ?? LEVEL_META.info;
  const DomainIcon = insightIcon(insight.id);
  const LevelIcon  = levelIcon(insight.level);

  return (
    <div className={cn(
      "relative rounded-xl border overflow-hidden transition-all duration-150",
      meta.border, meta.bg,
    )}>
      {/* Severity strip */}
      <div className={cn("h-0.75 w-full", meta.strip)} />

      <div className="px-4 py-3.5 flex gap-3">
        {/* Domain icon */}
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
          meta.border, meta.bg,
        )}>
          <DomainIcon className={cn("h-4 w-4", meta.color)} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Level badge + title */}
          <div className="flex items-start gap-2 mb-1">
            <LevelIcon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", meta.color)} />
            <p className="text-[13px] font-semibold text-foreground leading-snug">
              {insight.title}
            </p>
          </div>

          {/* Body */}
          {!compact && (
            <p className="text-[11px] text-muted-foreground leading-relaxed mb-2.5">
              {insight.body}
            </p>
          )}

          {/* Action */}
          {insight.action && (
            <Link
              to={insight.action.href}
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold underline-offset-2 hover:underline",
                meta.color,
              )}
            >
              {insight.action.label} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
