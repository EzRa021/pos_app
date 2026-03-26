// features/analytics/insights/profitability.js
// Pure functions — takes profitability analytics data, returns Insight[] for the profitability domain.

import { formatCurrencyCompact } from "@/lib/format";

/**
 * Evaluate all profitability-domain insight rules.
 *
 * @param {object} p
 * @param {object|null}  p.health    — BusinessHealthSummary { gross_profit_margin, month_revenue }
 * @param {object|null}  p.pl        — ProfitLossSummary { gross_profit, net_profit, expenses, gross_sales }
 * @param {object|null}  p.comparison — ComparisonReport with metrics array
 * @returns {import("./index").Insight[]}
 */
export function evaluateProfitabilityInsights({ health, pl, comparison }) {
  const insights = [];

  if (!health && !pl) return insights;

  // ── Gross margin health ───────────────────────────────────────────────────
  const margin = parseFloat(health?.gross_profit_margin ?? 0);
  if (margin > 0) {
    if (margin < 15) {
      insights.push({
        id:    "profitability_low_margin",
        level: "critical",
        title: `Gross margin is only ${margin.toFixed(1)}% this month`,
        body:  `A gross margin below 15% leaves very little room to cover operating expenses and still turn a profit. Review your cost of goods — supplier pricing increases or discount policies may be compressing margins.`,
        action: { label: "View profitability", href: "/analytics/profitability" },
        data:   { margin },
      });
    } else if (margin < 25) {
      insights.push({
        id:    "profitability_margin_low_warning",
        level: "warning",
        title: `Gross margin is ${margin.toFixed(1)}% — below healthy retail range`,
        body:  `A gross margin between 15–25% is below the healthy retail range of 25–40%. Consider reviewing your pricing strategy, reducing discounts, or renegotiating supplier costs.`,
        action: { label: "View profitability", href: "/analytics/profitability" },
        data:   { margin },
      });
    } else if (margin >= 35) {
      insights.push({
        id:    "profitability_strong_margin",
        level: "success",
        title: `Strong gross margin of ${margin.toFixed(1)}% this month`,
        body:  `Your gross margin of ${margin.toFixed(1)}% is in a healthy range for retail. This means you are retaining ${margin.toFixed(1)} cents of every naira earned after cost of goods. Keep monitoring supplier costs to maintain this level.`,
        action: { label: "View profitability", href: "/analytics/profitability" },
        data:   { margin },
      });
    }
  }

  // ── P&L derived insights ──────────────────────────────────────────────────
  if (pl) {
    const grossSales  = parseFloat(pl.gross_sales   ?? 0);
    const expenses    = parseFloat(pl.expenses      ?? 0);
    const netProfit   = parseFloat(pl.net_profit    ?? 0);
    const grossProfit = parseFloat(pl.gross_profit  ?? 0);

    // Expenses eating too much of gross profit
    if (grossProfit > 0 && expenses > 0) {
      const expenseRatio = (expenses / grossProfit) * 100;
      if (expenseRatio > 60) {
        insights.push({
          id:    "profitability_high_expenses",
          level: "warning",
          title: `Operating expenses are ${expenseRatio.toFixed(0)}% of gross profit`,
          body:  `With ${formatCurrencyCompact(expenses)} in operating expenses against ${formatCurrencyCompact(grossProfit)} gross profit, only ${formatCurrencyCompact(Math.max(0, netProfit))} remains as net profit. Review recurring expenses for opportunities to reduce fixed costs.`,
          action: { label: "View profitability", href: "/analytics/profitability" },
          data:   { expenseRatio, expenses, grossProfit, netProfit },
        });
      }
    }

    // Operating at a loss
    if (netProfit < 0 && grossSales > 0) {
      insights.push({
        id:    "profitability_net_loss",
        level: "critical",
        title: `Operating at a net loss of ${formatCurrencyCompact(Math.abs(netProfit))}`,
        body:  `After all costs and expenses, the business shows a net loss of ${formatCurrencyCompact(Math.abs(netProfit))} this period. This requires immediate attention — review both the cost structure and revenue drivers.`,
        action: { label: "View profitability", href: "/analytics/profitability" },
        data:   { netProfit, grossSales },
      });
    }
  }

  // ── Margin compression from comparison data ───────────────────────────────
  if (Array.isArray(comparison?.metrics)) {
    const revRow = comparison.metrics.find(
      (m) => (m.metric ?? "").toLowerCase().includes("revenue") || (m.metric ?? "").toLowerCase().includes("profit"),
    );
    if (revRow) {
      const changePct = parseFloat(revRow.change_percent ?? 0);
      if (changePct < -10) {
        insights.push({
          id:    "profitability_comparison_decline",
          level: "warning",
          title: `Revenue is down ${Math.abs(changePct).toFixed(1)}% versus last period`,
          body:  `Comparing current versus previous period shows a ${Math.abs(changePct).toFixed(1)}% revenue decline. Monitor whether this continues into the next period to determine if action is needed.`,
          action: { label: "View comparison report", href: "/analytics" },
          data:   { changePct },
        });
      }
    }
  }

  return insights;
}
