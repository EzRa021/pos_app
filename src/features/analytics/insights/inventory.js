// features/analytics/insights/inventory.js
// Pure functions — takes inventory analytics data, returns Insight[] for the inventory domain.

import { formatCurrencyCompact } from "@/lib/format";

/**
 * Evaluate all inventory-domain insight rules.
 *
 * @param {object} p
 * @param {object|null}  p.health    — BusinessHealthSummary
 * @param {Array|null}   p.velocity  — StockVelocity rows (days_of_stock_remaining, item_name, etc.)
 * @param {Array|null}   p.deadStock — DeadStock rows
 * @returns {import("./index").Insight[]}
 */
export function evaluateInventoryInsights({ health, velocity, deadStock }) {
  const insights = [];

  // ── Out of stock (from health summary) ───────────────────────────────────
  if (health) {
    const outCount  = parseInt(health.out_of_stock_count  ?? 0, 10);
    const lowCount  = parseInt(health.low_stock_count     ?? 0, 10);

    if (outCount > 0) {
      insights.push({
        id:    "inventory_out_of_stock",
        level: "critical",
        title: `${outCount} item${outCount === 1 ? "" : "s"} ${outCount === 1 ? "is" : "are"} completely out of stock`,
        body:  `You currently have ${outCount} active, tracked item${outCount === 1 ? "" : "s"} with zero stock on hand. Every day without stock costs potential revenue and risks losing customers to competitors.`,
        action: { label: "View inventory", href: "/analytics/inventory" },
        data:   { outCount },
      });
    }

    if (lowCount > 0) {
      insights.push({
        id:    "inventory_low_stock",
        level: lowCount >= 5 ? "warning" : "info",
        title: `${lowCount} item${lowCount === 1 ? "" : "s"} ${lowCount === 1 ? "is" : "are"} running low`,
        body:  `${lowCount} item${lowCount === 1 ? "" : "s"} ${lowCount === 1 ? "has" : "have"} stock below the reorder point. Place purchase orders soon to avoid stockouts.`,
        action: { label: "View low stock items", href: "/analytics/inventory" },
        data:   { lowCount },
      });
    }
  }

  // ── Critical days remaining (from velocity) ───────────────────────────────
  if (Array.isArray(velocity) && velocity.length > 0) {
    const critical = velocity.filter((r) => {
      const days = parseFloat(r.days_of_stock_remaining ?? 999);
      return days <= 3 && parseFloat(r.current_stock ?? 0) > 0;
    });

    const lowDays = velocity.filter((r) => {
      const days = parseFloat(r.days_of_stock_remaining ?? 999);
      return days > 3 && days <= 7 && parseFloat(r.current_stock ?? 0) > 0;
    });

    if (critical.length > 0) {
      const names = critical.slice(0, 3).map((r) => r.item_name).join(", ");
      const more  = critical.length > 3 ? ` and ${critical.length - 3} more` : "";
      insights.push({
        id:    "inventory_critical_days",
        level: "critical",
        title: `${critical.length} item${critical.length === 1 ? "" : "s"} will run out in ≤3 days`,
        body:  `${names}${more} will be out of stock within 3 days based on current sales velocity. Place emergency purchase orders immediately to avoid stockouts.`,
        action: { label: "Create Purchase Order", href: "/purchase-orders/create" },
        data:   { items: critical.slice(0, 5) },
      });
    }

    if (lowDays.length > 0) {
      const names = lowDays.slice(0, 3).map((r) => r.item_name).join(", ");
      const more  = lowDays.length > 3 ? ` and ${lowDays.length - 3} more` : "";
      insights.push({
        id:    "inventory_low_days",
        level: "warning",
        title: `${lowDays.length} item${lowDays.length === 1 ? "" : "s"} will run out within a week`,
        body:  `${names}${more} ${lowDays.length === 1 ? "has" : "have"} 4–7 days of stock remaining. Order this week to maintain supply continuity.`,
        action: { label: "View stock velocity", href: "/analytics/inventory" },
        data:   { items: lowDays.slice(0, 5) },
      });
    }

    // ── Overstocked ────────────────────────────────────────────────────────
    const overstocked = velocity.filter((r) => {
      const days  = parseFloat(r.days_of_stock_remaining ?? 0);
      const value = parseFloat(r.stock_value_at_cost     ?? 0);
      return days > 180 && value > 10000;
    });

    if (overstocked.length > 0) {
      const totalValue = overstocked.reduce((s, r) => s + parseFloat(r.stock_value_at_cost ?? 0), 0);
      insights.push({
        id:    "inventory_overstocked",
        level: "info",
        title: `${overstocked.length} item${overstocked.length === 1 ? " is" : "s are"} overstocked (>180 days supply)`,
        body:  `${formatCurrencyCompact(totalValue)} of capital is tied up in slow-moving stock with more than 6 months of supply. Consider promotions or price reductions to free up cash flow.`,
        action: { label: "View stock velocity", href: "/analytics/inventory" },
        data:   { overstocked: overstocked.slice(0, 5), totalValue },
      });
    }
  }

  // ── Dead stock ────────────────────────────────────────────────────────────
  if (Array.isArray(deadStock) && deadStock.length > 0) {
    const totalDeadValue = deadStock.reduce((s, r) => s + parseFloat(r.stock_value ?? r.stock_value_at_cost ?? 0), 0);
    insights.push({
      id:    "inventory_dead_stock",
      level: "warning",
      title: `${deadStock.length} item${deadStock.length === 1 ? " has" : "s have"} not sold in 30+ days`,
      body:  `${formatCurrencyCompact(totalDeadValue)} worth of stock has had no sales in over 30 days. Consider running a promotion, marking down prices, or returning to supplier to recover capital.`,
      action: { label: "View dead stock", href: "/analytics/inventory" },
      data:   { count: deadStock.length, totalDeadValue },
    });
  }

  return insights;
}
