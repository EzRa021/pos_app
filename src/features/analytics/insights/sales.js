// features/analytics/insights/sales.js
// Pure functions — takes analytics data, returns Insight[] for the sales domain.
// No React, no side effects, no imports from other features.

import { formatCurrency, formatCurrencyCompact } from "@/lib/format";

/**
 * Evaluate all sales-domain insight rules.
 *
 * @param {object} p
 * @param {object|null} p.health   — BusinessHealthSummary from get_business_health_summary
 * @param {Array|null}  p.revenue  — RevenueByPeriod rows
 * @returns {import("./index").Insight[]}
 */
export function evaluateSalesInsights({ health, revenue }) {
  const insights = [];

  if (!health) return insights;

  const weekPct   = parseFloat(health.week_vs_last_week   ?? 0);
  const monthPct  = parseFloat(health.month_vs_last_month ?? 0);
  const todayPct  = parseFloat(health.today_vs_yesterday  ?? 0);
  const weekRev   = parseFloat(health.week_revenue        ?? 0);
  const monthRev  = parseFloat(health.month_revenue       ?? 0);
  const todayRev  = parseFloat(health.today_revenue       ?? 0);

  // ── Weekly growth ─────────────────────────────────────────────────────────
  if (Math.abs(weekPct) >= 10) {
    const isUp = weekPct > 0;
    const changeAmt = weekRev * (weekPct / (100 + weekPct));
    insights.push({
      id:    "sales_weekly_growth",
      level: isUp ? "success" : "warning",
      title: isUp
        ? `Sales are up ${Math.abs(weekPct).toFixed(1)}% this week`
        : `Sales are down ${Math.abs(weekPct).toFixed(1)}% this week`,
      body: isUp
        ? `Revenue this week reached ${formatCurrencyCompact(weekRev)} — ${formatCurrencyCompact(Math.abs(changeAmt))} above last week. Strong momentum heading into the rest of the week.`
        : `Revenue this week is ${formatCurrencyCompact(Math.abs(changeAmt))} below last week's figure. Consider a promotional push to recover volume on slower days.`,
      action: { label: "View sales report", href: "/analytics/sales" },
      data:   { weekPct, weekRev },
    });
  }

  // ── Monthly growth ────────────────────────────────────────────────────────
  if (Math.abs(monthPct) >= 5) {
    const isUp = monthPct > 0;
    insights.push({
      id:    "sales_monthly_growth",
      level: isUp ? "success" : "warning",
      title: isUp
        ? `Monthly revenue is up ${Math.abs(monthPct).toFixed(1)}%`
        : `Monthly revenue is down ${Math.abs(monthPct).toFixed(1)}%`,
      body: isUp
        ? `This month's revenue stands at ${formatCurrencyCompact(monthRev)}, outpacing last month by ${Math.abs(monthPct).toFixed(1)}%. You are on track for a strong close.`
        : `Month-to-date revenue of ${formatCurrencyCompact(monthRev)} is ${Math.abs(monthPct).toFixed(1)}% behind the same point last month. Review pricing or run a promotion to close the gap.`,
      action: { label: "View comparison", href: "/analytics/sales" },
      data:   { monthPct, monthRev },
    });
  }

  // ── Today slow period ─────────────────────────────────────────────────────
  if (todayPct < -30 && todayRev > 0) {
    insights.push({
      id:    "sales_slow_today",
      level: "warning",
      title: `Today's revenue is ${Math.abs(todayPct).toFixed(0)}% below yesterday`,
      body:  `Today has generated ${formatCurrency(todayRev)} so far. Yesterday's total was significantly higher. This could be seasonal — monitor through the end of the trading day.`,
      action: { label: "View today's sales", href: "/analytics/sales" },
      data:   { todayPct, todayRev },
    });
  }

  // ── Today strong ──────────────────────────────────────────────────────────
  if (todayPct > 20) {
    insights.push({
      id:    "sales_strong_today",
      level: "success",
      title: `Today is tracking ${todayPct.toFixed(0)}% ahead of yesterday`,
      body:  `Revenue today is already at ${formatCurrency(todayRev)} — well ahead of the same point yesterday. Great trading day so far.`,
      action: { label: "View today's sales", href: "/analytics/sales" },
      data:   { todayPct, todayRev },
    });
  }

  // ── Revenue trend from period data ────────────────────────────────────────
  if (Array.isArray(revenue) && revenue.length >= 7) {
    const recent  = revenue.slice(-7);
    const earlier = revenue.slice(-14, -7);
    if (earlier.length === 7) {
      const recentAvg  = recent.reduce((s, r)  => s + parseFloat(r.revenue ?? 0), 0) / 7;
      const earlierAvg = earlier.reduce((s, r) => s + parseFloat(r.revenue ?? 0), 0) / 7;
      const trend = earlierAvg > 0 ? ((recentAvg - earlierAvg) / earlierAvg) * 100 : 0;
      if (trend < -15) {
        insights.push({
          id:    "sales_trend_decline",
          level: "warning",
          title: "Revenue trend is declining over the past 2 weeks",
          body:  `Average daily revenue in the last 7 days (${formatCurrencyCompact(recentAvg)}) is ${Math.abs(trend).toFixed(1)}% below the previous 7 days (${formatCurrencyCompact(earlierAvg)}). This is a sustained decline worth investigating.`,
          action: { label: "View revenue chart", href: "/analytics/sales" },
          data:   { trend, recentAvg, earlierAvg },
        });
      }
    }
  }

  return insights;
}
