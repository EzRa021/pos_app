// features/analytics/insights/operations.js
// Pure functions — takes operational analytics data, returns Insight[] for the operations domain.

import { formatCurrencyCompact } from "@/lib/format";

/**
 * Evaluate all operations-domain insight rules.
 *
 * @param {object} p
 * @param {object|null}  p.health     — BusinessHealthSummary
 * @param {Array|null}   p.cashiers   — CashierPerformance rows
 * @param {object|null}  p.discounts  — DiscountAnalytics { total_discounts_given, transactions_with_discounts,
 *                                       avg_discount_per_transaction, by_cashier: [] }
 * @param {object|null}  p.returns    — ReturnAnalysisReport { summary: { return_rate, ... }, by_cashier: [] }
 * @param {object|null}  p.salesSummary — SalesSummary { gross_sales }
 * @returns {import("./index").Insight[]}
 */
export function evaluateOperationsInsights({ health, cashiers, discounts, returns, salesSummary }) {
  const insights = [];

  // ── High void rate per cashier ────────────────────────────────────────────
  if (Array.isArray(cashiers) && cashiers.length > 0) {
    const highVoidCashiers = cashiers.filter((c) => {
      const txCount  = parseInt(c.transaction_count ?? c.total_transactions ?? 0, 10);
      const voidCount = parseInt(c.void_count ?? c.voids_count ?? 0, 10);
      return txCount >= 10 && voidCount / txCount > 0.03;
    });

    highVoidCashiers.forEach((c) => {
      const txCount   = parseInt(c.transaction_count ?? c.total_transactions ?? 0, 10);
      const voidCount = parseInt(c.void_count ?? c.voids_count ?? 0, 10);
      const voidRate  = txCount > 0 ? ((voidCount / txCount) * 100).toFixed(1) : "0";
      const voidValue = parseFloat(c.voids_value ?? 0);
      const name      = c.cashier_name ?? "A cashier";
      insights.push({
        id:    `operations_high_void_${c.cashier_id ?? c.user_id ?? name}`,
        level: "warning",
        title: `${name}'s void rate is ${voidRate}% this period`,
        body:  `${name} has voided ${voidCount} transaction${voidCount === 1 ? "" : "s"}${voidValue > 0 ? ` worth ${formatCurrencyCompact(voidValue)}` : ""} — a rate of ${voidRate}%, above the recommended 2% threshold. This may indicate training issues, technical problems, or requires investigation.`,
        action: { label: "View cashier performance", href: "/analytics/cashiers" },
        data:   { cashier: c, voidRate, voidCount, voidValue },
      });
    });
  }

  // ── High discount rate overall ────────────────────────────────────────────
  if (discounts && salesSummary) {
    const grossSales     = parseFloat(salesSummary.gross_sales ?? 0);
    const totalDiscounts = parseFloat(discounts.total_discounts_given ?? 0);
    if (grossSales > 0 && totalDiscounts > 0) {
      const discountRate = (totalDiscounts / grossSales) * 100;
      if (discountRate > 15) {
        insights.push({
          id:    "operations_high_discount_rate",
          level: "warning",
          title: `Discounts are ${discountRate.toFixed(1)}% of gross sales`,
          body:  `${formatCurrencyCompact(totalDiscounts)} in discounts have been given this period — ${discountRate.toFixed(1)}% of gross sales. This is above the recommended 15% threshold. Review discount authorisation policies to protect margins.`,
          action: { label: "View discount analytics", href: "/analytics" },
          data:   { discountRate, totalDiscounts, grossSales },
        });
      }
    }
  }

  // ── High return rate ──────────────────────────────────────────────────────
  if (returns?.summary && salesSummary) {
    const grossSales  = parseFloat(salesSummary.gross_sales ?? 0);
    const returnValue = parseFloat(returns.summary.total_return_value ?? 0);
    if (grossSales > 0 && returnValue > 0) {
      const returnRate = (returnValue / grossSales) * 100;
      if (returnRate > 5) {
        insights.push({
          id:    "operations_high_return_rate",
          level: "warning",
          title: `Return value is ${returnRate.toFixed(1)}% of gross sales`,
          body:  `${formatCurrencyCompact(returnValue)} worth of goods were returned this period — ${returnRate.toFixed(1)}% of gross sales, above the 5% threshold. Investigate the top returned items to identify quality, description, or training issues.`,
          action: { label: "View returns", href: "/returns" },
          data:   { returnRate, returnValue, grossSales },
        });
      }
    }
  }

  // ── Pending approvals (expenses) ──────────────────────────────────────────
  if (health) {
    const pendingExpenses = parseInt(health.pending_expenses_count ?? 0, 10);
    const pendingPOs      = parseInt(health.pending_po_count       ?? 0, 10);

    if (pendingExpenses > 3) {
      insights.push({
        id:    "operations_pending_expenses",
        level: "info",
        title: `${pendingExpenses} expense${pendingExpenses === 1 ? "" : "s"} awaiting approval`,
        body:  `There ${pendingExpenses === 1 ? "is" : "are"} ${pendingExpenses} expense${pendingExpenses === 1 ? "" : "s"} pending approval. Review and process these to keep financial records up to date.`,
        action: { label: "View expenses", href: "/expenses" },
        data:   { pendingExpenses },
      });
    }

    if (pendingPOs > 0) {
      insights.push({
        id:    "operations_pending_pos",
        level: "info",
        title: `${pendingPOs} purchase order${pendingPOs === 1 ? "" : "s"} pending`,
        body:  `${pendingPOs} purchase order${pendingPOs === 1 ? "" : "s"} ${pendingPOs === 1 ? "is" : "are"} awaiting processing. Follow up with suppliers to ensure timely stock delivery.`,
        action: { label: "View purchase orders", href: "/purchase-orders" },
        data:   { pendingPOs },
      });
    }
  }

  return insights;
}
