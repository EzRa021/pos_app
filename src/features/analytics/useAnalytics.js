// features/analytics/useAnalytics.js
import { useQuery } from "@tanstack/react-query";
import {
  getSalesSummary, getRevenueByPeriod, getDailySummary,
  getItemAnalytics, getCategoryAnalytics, getDepartmentAnalytics,
  getProfitAnalysis, getProfitLossSummary, getLowMarginItems,
  getSlowMovingItems, getDeadStock, getStockVelocity,
  getCashierPerformance, getPeakHoursAnalysis,
  getComparisonReport, getCustomerAnalytics,
  getPaymentMethodSummary, getDiscountAnalytics, getTaxReport,
  getReturnAnalysis,
} from "@/commands/analytics";
import { useBranchStore } from "@/stores/branch.store";

// ── Base hook factory ─────────────────────────────────────────────────────────
function makeHook(queryKey, fn, params = {}, staleMs = 2 * 60_000) {
  return function useAnalyticsQuery(extraParams = {}) {
    const storeId = useBranchStore((s) => s.activeStore?.id);
    const merged  = { ...params, ...extraParams };
    const { data, isLoading, error } = useQuery({
      queryKey:  [queryKey, storeId, merged],
      queryFn:   () => fn(storeId, merged),
      enabled:   !!storeId,
      staleTime: staleMs,
    });
    return { data, isLoading, error: error ?? null };
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export const useSalesSummary         = makeHook("analytics-sales-summary",     getSalesSummary);
export const useRevenueByPeriod      = makeHook("analytics-revenue-period",    getRevenueByPeriod);
export const useItemAnalytics        = makeHook("analytics-items",             getItemAnalytics);
export const useCategoryAnalytics    = makeHook("analytics-categories",        getCategoryAnalytics);
export const useDepartmentAnalytics  = makeHook("analytics-departments",       getDepartmentAnalytics);
export const useProfitAnalysis       = makeHook("analytics-profit",            getProfitAnalysis);
export const useProfitLossSummary    = makeHook("analytics-pl",                getProfitLossSummary);
export const useLowMarginItems       = makeHook("analytics-low-margin",        getLowMarginItems);
export const useSlowMovingItems      = makeHook("analytics-slow-moving",       getSlowMovingItems);
export const useDeadStock            = makeHook("analytics-dead-stock",        getDeadStock);
export const useStockVelocity        = makeHook("analytics-stock-velocity",    getStockVelocity);
export const useCashierPerformance   = makeHook("analytics-cashiers",          getCashierPerformance);
export const usePeakHoursAnalysis    = makeHook("analytics-peak-hours",        getPeakHoursAnalysis);
export const useComparisonReport     = makeHook("analytics-comparison",        getComparisonReport);
export const useCustomerAnalytics    = makeHook("analytics-customers",        getCustomerAnalytics);
export const usePaymentMethodSummary = makeHook("analytics-payment-methods",   getPaymentMethodSummary);
export const useDiscountAnalytics    = makeHook("analytics-discounts",         getDiscountAnalytics);
export const useReturnAnalysis       = makeHook("analytics-returns",           getReturnAnalysis);
export const useTaxReport            = makeHook("analytics-tax",               getTaxReport);
