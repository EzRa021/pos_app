// features/analytics/insights/index.js
// Aggregates all domain insight generators, deduplicates, and sorts by severity.
//
// Usage:
//   import { computeInsights, LEVEL_ORDER } from "@/features/analytics/insights";
//
//   const insights = computeInsights({ health, summary, revenue, velocity, ... });
//   // insights is sorted: critical → warning → info → success
//
// Insight shape:
//   {
//     id:     string   — unique key (used as React key + dedup)
//     level:  "critical" | "warning" | "info" | "success"
//     title:  string   — one bold sentence
//     body:   string   — 2–3 sentence explanation with specific numbers
//     action: { label: string, href: string } | null
//     data:   object   — raw values used to generate the insight (for debugging / drill-down)
//   }

import { evaluateSalesInsights }         from "./sales";
import { evaluateInventoryInsights }     from "./inventory";
import { evaluateProductInsights }       from "./products";
import { evaluateCustomerInsights }      from "./customers";
import { evaluateOperationsInsights }    from "./operations";
import { evaluateProfitabilityInsights } from "./profitability";

// ── Types (JSDoc only — no TS) ─────────────────────────────────────────────

/**
 * @typedef {Object} Insight
 * @property {string}            id
 * @property {"critical"|"warning"|"info"|"success"} level
 * @property {string}            title
 * @property {string}            body
 * @property {{label:string, href:string}|null} action
 * @property {object}            data
 */

// ── Level ordering (lower index = higher priority) ─────────────────────────
export const LEVEL_ORDER = ["critical", "warning", "info", "success"];

function levelRank(level) {
  const idx = LEVEL_ORDER.indexOf(level);
  return idx === -1 ? 99 : idx;
}

// ── Colour / style metadata for each level ─────────────────────────────────
export const LEVEL_META = {
  critical: { color: "text-destructive", bg: "bg-destructive/8",  border: "border-destructive/25", strip: "bg-destructive", label: "Critical" },
  warning:  { color: "text-warning",     bg: "bg-warning/8",      border: "border-warning/25",     strip: "bg-warning",     label: "Warning"  },
  info:     { color: "text-primary",     bg: "bg-primary/8",      border: "border-primary/25",     strip: "bg-primary",     label: "Info"     },
  success:  { color: "text-success",     bg: "bg-success/8",      border: "border-success/25",     strip: "bg-success",     label: "Success"  },
};

// ── Main aggregator ────────────────────────────────────────────────────────

/**
 * Evaluate all insight rules across all domains and return a sorted, deduplicated list.
 *
 * @param {object} inputs — all analytics data already fetched by the page
 * @param {object|null}  inputs.health       — BusinessHealthSummary
 * @param {object|null}  inputs.summary      — SalesSummary
 * @param {Array|null}   inputs.revenue      — RevenueByPeriod rows
 * @param {Array|null}   inputs.items        — ItemAnalytics rows
 * @param {object|null}  inputs.profit       — ProfitAnalysis { by_item: [] }
 * @param {object|null}  inputs.pl           — ProfitLossSummary
 * @param {Array|null}   inputs.lowMargin    — LowMarginItems rows
 * @param {Array|null}   inputs.velocity     — StockVelocity rows
 * @param {Array|null}   inputs.deadStock    — DeadStock rows
 * @param {Array|null}   inputs.cashiers     — CashierPerformance rows
 * @param {object|null}  inputs.discounts    — DiscountAnalytics
 * @param {object|null}  inputs.returns      — ReturnAnalysisReport
 * @param {object|null}  inputs.customers    — CustomerAnalyticsReport
 * @param {object|null}  inputs.comparison   — ComparisonReport
 * @param {number}       [inputs.maxInsights=10] — cap on total insights returned
 * @returns {Insight[]}
 */
export function computeInsights({
  health      = null,
  summary     = null,
  revenue     = null,
  items       = null,
  profit      = null,
  pl          = null,
  lowMargin   = null,
  velocity    = null,
  deadStock   = null,
  cashiers    = null,
  discounts   = null,
  returns     = null,
  customers   = null,
  comparison  = null,
  maxInsights = 10,
} = {}) {
  // Collect raw insights from all domains
  const all = [
    ...evaluateSalesInsights({ health, revenue }),
    ...evaluateInventoryInsights({ health, velocity, deadStock }),
    ...evaluateProductInsights({ health, items: Array.isArray(items) ? items : items?.by_item ?? null, profit: profit?.by_item ?? profit, lowMargin }),
    ...evaluateCustomerInsights({ health, customers }),
    ...evaluateOperationsInsights({ health, cashiers, discounts, returns, salesSummary: summary }),
    ...evaluateProfitabilityInsights({ health, pl, comparison }),
  ];

  // Deduplicate by id (first occurrence wins)
  const seen = new Set();
  const deduped = all.filter((ins) => {
    if (seen.has(ins.id)) return false;
    seen.add(ins.id);
    return true;
  });

  // Sort: critical → warning → info → success
  deduped.sort((a, b) => levelRank(a.level) - levelRank(b.level));

  return deduped.slice(0, maxInsights);
}

/**
 * Filter insights to a specific domain subset (by id prefix).
 * Useful for section-level insight strips.
 *
 * @param {Insight[]} insights
 * @param {string[]}  prefixes — e.g. ["sales_", "inventory_"]
 * @param {number}    [max=3]
 * @returns {Insight[]}
 */
export function filterInsights(insights, prefixes, max = 3) {
  return insights
    .filter((ins) => prefixes.some((p) => ins.id.startsWith(p)))
    .slice(0, max);
}
