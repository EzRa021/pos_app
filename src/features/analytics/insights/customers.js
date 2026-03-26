// features/analytics/insights/customers.js
// Pure functions — takes customer analytics data, returns Insight[] for the customers domain.

import { formatCurrencyCompact } from "@/lib/format";

/**
 * Evaluate all customer-domain insight rules.
 *
 * @param {object} p
 * @param {object|null}  p.health      — BusinessHealthSummary
 * @param {object|null}  p.customers   — CustomerAnalyticsReport { total_customers, active_customers,
 *                                        lapsed_customers, avg_lifetime_value, top_customers: [] }
 * @returns {import("./index").Insight[]}
 */
export function evaluateCustomerInsights({ health, customers }) {
  const insights = [];

  if (!customers) return insights;

  const total   = parseInt(customers.total_customers  ?? 0, 10);
  const active  = parseInt(customers.active_customers ?? 0, 10);
  const lapsed  = parseInt(customers.lapsed_customers ?? 0, 10);
  const avgLTV  = parseFloat(customers.avg_lifetime_value ?? 0);

  // ── Lapsed customers ─────────────────────────────────────────────────────
  if (lapsed > 0 && total > 0) {
    const lapsedPct = ((lapsed / total) * 100).toFixed(0);
    insights.push({
      id:    "customers_lapsed",
      level: lapsed >= 10 ? "warning" : "info",
      title: `${lapsed} customer${lapsed === 1 ? "" : "s"} haven't purchased in 60–365 days`,
      body:  `${lapsedPct}% of your customer base (${lapsed} customer${lapsed === 1 ? "" : "s"}) purchased previously but not in the last 2 months. ${avgLTV > 0 ? `These customers had an average lifetime value of ${formatCurrencyCompact(avgLTV)}. ` : ""}A targeted promotion or loyalty incentive could bring them back.`,
      action: { label: "View customers", href: "/analytics/customers" },
      data:   { lapsed, lapsedPct, avgLTV },
    });
  }

  // ── Overdue credit from health summary ────────────────────────────────────
  if (health) {
    const overdueCount = parseInt(health.overdue_credit_count ?? 0, 10);
    const openCredit   = parseFloat(health.open_credit_total  ?? 0);

    if (overdueCount > 0) {
      insights.push({
        id:    "customers_overdue_credit",
        level: overdueCount >= 3 ? "critical" : "warning",
        title: `${overdueCount} customer${overdueCount === 1 ? " has an" : "s have"} overdue credit payment${overdueCount === 1 ? "" : "s"}`,
        body:  `${openCredit > 0 ? `${formatCurrencyCompact(openCredit)} is outstanding in total credit balances. ` : ""}${overdueCount} credit sale${overdueCount === 1 ? "" : "s"} ${overdueCount === 1 ? "is" : "are"} past the due date. Collecting overdue balances is a high-priority cash flow action.`,
        action: { label: "Review credit sales", href: "/credit-sales" },
        data:   { overdueCount, openCredit },
      });
    } else if (openCredit > 50000) {
      // Large open credit balance even if not overdue
      insights.push({
        id:    "customers_high_credit",
        level: "info",
        title: `${formatCurrencyCompact(openCredit)} in open credit balances`,
        body:  `You have ${formatCurrencyCompact(openCredit)} outstanding across customer credit accounts. While not overdue, monitoring these balances regularly prevents cash flow surprises.`,
        action: { label: "Review credit sales", href: "/credit-sales" },
        data:   { openCredit },
      });
    }
  }

  // ── Very low active customer rate ─────────────────────────────────────────
  if (total > 5 && active > 0) {
    const activeRate = (active / total) * 100;
    if (activeRate < 30) {
      insights.push({
        id:    "customers_low_retention",
        level: "warning",
        title: `Only ${activeRate.toFixed(0)}% of customers are active this quarter`,
        body:  `${active} out of ${total} customers have made a purchase in the last 90 days. A low active rate suggests retention challenges. Consider a loyalty programme or targeted outreach to re-engage inactive customers.`,
        action: { label: "View customers", href: "/analytics/customers" },
        data:   { active, total, activeRate },
      });
    }
  }

  return insights;
}
