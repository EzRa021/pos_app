// commands/analytics.js — Reports and dashboard data
import { rpc } from "@/lib/apiClient";

// ── Existing ──────────────────────────────────────────────────────────────────

// Returns: today_revenue, today_transactions, week_revenue, month_revenue,
//          gross_profit_margin, low_stock_count, out_of_stock_count,
//          open_credit_total, overdue_credit_count, pending_expenses_count,
//          pending_po_count, top_item_name, top_cashier_name, growth %s
export const getBusinessHealthSummary = (storeId, params = {}) =>
  rpc("get_business_health_summary", { store_id: storeId, ...params });

export const getTopItems = (storeId, params = {}) =>
  rpc("get_top_items", { store_id: storeId, ...params });
// params: { limit?, date_from?, date_to? }

export const getTopCategories = (storeId, params = {}) =>
  rpc("get_top_categories", { store_id: storeId, ...params });
// params: { limit?, date_from?, date_to? }

// ── Sales & Revenue ───────────────────────────────────────────────────────────

// Returns: gross_sales, net_sales, total_tax, total_discounts, avg_order_value,
//          transactions_count
export const getSalesSummary = (storeId, params = {}) =>
  rpc("get_sales_summary", { store_id: storeId, ...params });

// Returns: [{ period_label, revenue, transactions, avg_basket }]
export const getRevenueByPeriod = (storeId, params = {}) =>
  rpc("get_revenue_by_period", { store_id: storeId, ...params });
// params: { period: "day"|"week"|"month"|"year", date_from?, date_to? }

// Returns full daily P&L snapshot for a single date
export const getDailySummary = (storeId, date) =>
  rpc("get_daily_summary", { store_id: storeId, date });

// ── Product Analytics ─────────────────────────────────────────────────────────

// Returns: [{ item_id, item_name, sku, qty_sold, revenue, avg_price }]
// params: { limit?, date_from?, date_to?, sort_by?: "qty_sold"|"revenue",
//           direction?: "asc"|"desc" }
export const getItemAnalytics = (storeId, params = {}) =>
  rpc("get_item_analytics", { store_id: storeId, ...params });

// Returns: [{ category_name, qty_sold, revenue, transactions_count }]
export const getCategoryAnalytics = (storeId, params = {}) =>
  rpc("get_category_analytics", { store_id: storeId, ...params });

// Returns: [{ department_name, qty_sold, revenue, transactions_count }]
export const getDepartmentAnalytics = (storeId, params = {}) =>
  rpc("get_department_analytics", { store_id: storeId, ...params });

// ── Profit & Margin ───────────────────────────────────────────────────────────

// Returns per-item: qty_sold, revenue, cost_of_goods, gross_profit, margin_percent
// params: { date_from?, date_to?, limit?, sort_by?: "gross_profit"|"margin_percent"|"revenue" }
export const getProfitAnalysis = (storeId, params = {}) =>
  rpc("get_profit_analysis", { store_id: storeId, ...params });

// Returns waterfall P&L: gross_sales, discounts, net_sales, cogs, gross_profit,
//   expenses, net_profit, tax_collected
export const getProfitLossSummary = (storeId, params = {}) =>
  rpc("get_profit_loss_summary", { store_id: storeId, ...params });

// Returns items below margin threshold
// params: { date_from?, date_to?, min_margin_percent? }
export const getLowMarginItems = (storeId, params = {}) =>
  rpc("get_low_margin_items", { store_id: storeId, ...params });

// ── Stock Analytics ───────────────────────────────────────────────────────────

// Returns slow-movers ordered by qty_sold ASC, last_sold_at ASC
// params: { date_from?, date_to?, limit? }
export const getSlowMovingItems = (storeId, params = {}) =>
  rpc("get_slow_moving_items", { store_id: storeId, ...params });

// Returns items with qty > 0 but zero sales in last N days
// params: { days?: 30|60|90, limit? }
export const getDeadStock = (storeId, params = {}) =>
  rpc("get_dead_stock", { store_id: storeId, ...params });

// Returns: item_name, sku, current_stock, avg_daily_sales, days_of_stock_remaining, stock_value_at_cost
export const getStockVelocity = (storeId, params = {}) =>
  rpc("get_stock_velocity", { store_id: storeId, ...params });

// ── Cashier Performance ───────────────────────────────────────────────────────

// Returns per-cashier: total_transactions, total_value, avg_transaction,
//   total_discounts, voids_count, voids_value, refunds_count, credit_sales_pct
// params: { date_from?, date_to?, cashier_id? }
export const getCashierPerformance = (storeId, params = {}) =>
  rpc("get_cashier_performance", { store_id: storeId, ...params });

// ── Time & Pattern Analytics ──────────────────────────────────────────────────

// Returns: [{ hour_of_day, day_of_week, transaction_count, revenue, avg_basket }]
export const getPeakHoursAnalysis = (storeId, params = {}) =>
  rpc("get_peak_hours", { store_id: storeId, ...params });

// Returns side-by-side current vs previous period with growth_amount + growth_percent
// params: { metric: "revenue"|"transactions"|"profit", period: "week"|"month"|"year" }
export const getComparisonReport = (storeId, params = {}) =>
  rpc("get_comparison_report", { store_id: storeId, ...params });

// ── Customer Analytics ────────────────────────────────────────────────────────

// Returns top customers, frequency, avg basket, lapsed, credit utilization
// params: { date_from?, date_to?, lapsed_days?, limit? }
export const getCustomerAnalytics = (storeId, params = {}) =>
  rpc("get_customer_analytics", { store_id: storeId, ...params });

// ── Payment & Financial ───────────────────────────────────────────────────────

// Returns totals per payment method
export const getPaymentMethodSummary = (storeId, params = {}) =>
  rpc("get_payment_method_summary", { store_id: storeId, ...params });

// Discounts per cashier, per item, over-limit transactions
// params: { date_from?, date_to? }
export const getDiscountAnalytics = (storeId, params = {}) =>
  rpc("get_discount_analytics", { store_id: storeId, ...params });

// VAT / FIRS-ready: total_vat, gross_sales, net_sales, vat_by_category
// params: { month: "YYYY-MM" }
export const getTaxReport = (storeId, params = {}) =>
  rpc("get_tax_report", { store_id: storeId, ...params });

// ── Returns ───────────────────────────────────────────────────────────────────

// Returns: top returned items, return_rate, by cashier, reason breakdown
export const getReturnAnalysis = (storeId, params = {}) =>
  rpc("get_return_analysis", { store_id: storeId, ...params });
