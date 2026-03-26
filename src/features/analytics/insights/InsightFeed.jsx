// features/analytics/insights/InsightFeed.jsx
// Renders a prioritised list of insight cards.
// Used on the analytics landing page (up to 10 cards) and section headers (up to 3 cards).

import { Lightbulb } from "lucide-react";
import { InsightCard } from "./InsightCard";

/**
 * @param {object} props
 * @param {import("./index").Insight[]} props.insights
 * @param {number}  [props.max=10]         — cap on cards shown
 * @param {boolean} [props.compact=false]  — omit body text (for section headers)
 * @param {string}  [props.emptyMessage]   — text shown when no insights
 */
export function InsightFeed({ insights, max = 10, compact = false, emptyMessage }) {
  if (!insights?.length) {
    if (!emptyMessage) return null;
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
        <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-[12px] text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  const shown = insights.slice(0, max);

  return (
    <div className="flex flex-col gap-3">
      {shown.map((insight) => (
        <InsightCard key={insight.id} insight={insight} compact={compact} />
      ))}
    </div>
  );
}
