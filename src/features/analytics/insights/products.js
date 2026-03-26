// features/analytics/insights/products.js
// Pure functions — takes product/item analytics data, returns Insight[] for the products domain.

import { formatCurrencyCompact, formatQuantity } from "@/lib/format";

/**
 * Evaluate all product-domain insight rules.
 *
 * @param {object} p
 * @param {object|null}  p.health      — BusinessHealthSummary
 * @param {Array|null}   p.items       — ItemAnalytics rows (item_id, item_name, qty_sold, revenue, avg_price)
 * @param {Array|null}   p.profit      — ProfitAnalysis rows (item_name, margin_percent, gross_profit, revenue)
 * @param {Array|null}   p.lowMargin   — LowMarginItems rows
 * @returns {import("./index").Insight[]}
 */
export function evaluateProductInsights({ health, items, profit, lowMargin }) {
  const insights = [];

  // ── Top performer from health summary ─────────────────────────────────────
  if (health?.top_item_name) {
    const qty = formatQuantity(parseFloat(health.top_item_qty ?? 0));
    insights.push({
      id:    "products_top_performer",
      level: "success",
      title: `"${health.top_item_name}" is your best-selling item this month`,
      body:  `${health.top_item_name} has sold ${qty} units this month, making it your top product by volume. Ensure stock levels are maintained to avoid missing demand.`,
      action: { label: "View item analytics", href: "/analytics/products" },
      data:   { name: health.top_item_name, qty: health.top_item_qty },
    });
  }

  // ── Revenue concentration (top 3 items = big % of total) ──────────────────
  if (Array.isArray(items) && items.length >= 5) {
    const totalRev = items.reduce((s, r) => s + parseFloat(r.revenue ?? 0), 0);
    if (totalRev > 0) {
      const top3Rev = items.slice(0, 3).reduce((s, r) => s + parseFloat(r.revenue ?? 0), 0);
      const top3Pct = (top3Rev / totalRev) * 100;
      if (top3Pct >= 50) {
        const names = items.slice(0, 3).map((r) => r.item_name).join(", ");
        insights.push({
          id:    "products_revenue_concentration",
          level: top3Pct >= 70 ? "warning" : "info",
          title: `Top 3 items account for ${top3Pct.toFixed(0)}% of revenue`,
          body:  `${names} together generated ${formatCurrencyCompact(top3Rev)} this period — ${top3Pct.toFixed(0)}% of total product revenue. ${top3Pct >= 70 ? "This concentration is high; a stockout on any of these items would significantly impact revenue." : "Monitor these items closely to maintain supply continuity."}`,
          action: { label: "View item performance", href: "/analytics/products" },
          data:   { top3Pct, top3Rev, totalRev },
        });
      }
    }
  }

  // ── Low margin items ──────────────────────────────────────────────────────
  if (Array.isArray(lowMargin) && lowMargin.length > 0) {
    const totalLowRevenue = lowMargin.reduce((s, r) => s + parseFloat(r.revenue ?? 0), 0);
    const totalLowProfit  = lowMargin.reduce((s, r) => s + parseFloat(r.gross_profit ?? 0), 0);
    insights.push({
      id:    "products_low_margin",
      level: "warning",
      title: `${lowMargin.length} item${lowMargin.length === 1 ? "" : "s"} selling below 10% margin`,
      body:  `${lowMargin.length} item${lowMargin.length === 1 ? "" : "s"} generated ${formatCurrencyCompact(totalLowRevenue)} in revenue but only ${formatCurrencyCompact(totalLowProfit)} in gross profit. Review supplier costs or selling prices for these items.`,
      action: { label: "View profitability", href: "/analytics/profitability" },
      data:   { count: lowMargin.length, totalLowRevenue, totalLowProfit },
    });
  }

  // ── Any loss-making items ─────────────────────────────────────────────────
  if (Array.isArray(profit) && profit.length > 0) {
    const lossMakers = profit.filter((r) => parseFloat(r.margin_percent ?? 0) < 0);
    if (lossMakers.length > 0) {
      const names = lossMakers.slice(0, 2).map((r) => r.item_name).join(" and ");
      const more  = lossMakers.length > 2 ? ` and ${lossMakers.length - 2} more` : "";
      insights.push({
        id:    "products_loss_makers",
        level: "critical",
        title: `${lossMakers.length} item${lossMakers.length === 1 ? " is" : "s are"} being sold at a loss`,
        body:  `${names}${more} ${lossMakers.length === 1 ? "has" : "have"} a negative gross margin. Every unit sold costs more than the selling price. Immediate price review or product discontinuation is recommended.`,
        action: { label: "View profitability", href: "/analytics/profitability" },
        data:   { items: lossMakers.slice(0, 5) },
      });
    }
  }

  return insights;
}
