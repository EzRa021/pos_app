// ============================================================================
// features/pos/usePos.js — POS data hook
// ============================================================================
// After every successful charge the shift-summary query is invalidated so the
// active-shift KPI cards (Total Sales, Expected Cash) stay current without the
// cashier having to navigate away.
// ============================================================================

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import { useShiftStore }  from "@/stores/shift.store";
import { getItems, getItemByBarcode } from "@/commands/items";
import { getCategories } from "@/commands/categories";
import { getCustomers }  from "@/commands/customers";
import { createTransaction } from "@/commands/transactions";
import { queryClient }   from "@/lib/queryClient";

// ── usePos ────────────────────────────────────────────────────────────────────
export function usePos({
  search   = "",
  catId    = null,
  page     = 1,
  limit    = 20,
} = {}) {
  const storeId     = useBranchStore((s) => s.activeStore?.id);
  const activeShift = useShiftStore((s) => s.activeShift);

  // ── Items (POS-available, active, paginated) ──────────────────────────────
  const itemFilters = useMemo(() => ({
    store_id:          storeId ?? null,
    available_for_pos: true,
    is_active:         true,
    search:            search || null,
    category_id:       catId  ?? null,
    page,
    limit,
  }), [storeId, search, catId, page, limit]);

  const {
    data:      itemsData,
    isLoading: itemsLoading,
    isFetching: itemsFetching,
  } = useQuery({
    queryKey:        ["pos-items", itemFilters],
    queryFn:         () => getItems(itemFilters),
    enabled:         !!storeId,
    staleTime:       60_000,
    placeholderData: (prev) => prev,
  });

  // ── Categories ────────────────────────────────────────────────────────────
  const { data: catsRaw } = useQuery({
    queryKey:  ["categories", storeId],
    queryFn:   () => getCategories(storeId),
    enabled:   !!storeId,
    staleTime: 5 * 60_000,
  });

  const items      = useMemo(() => itemsData?.data ?? [], [itemsData]);
  const itemsTotal = itemsData?.total       ?? 0;
  const totalPages = itemsData?.total_pages ?? 1;
  const categories = useMemo(() => {
    if (!catsRaw) return [];
    return Array.isArray(catsRaw) ? catsRaw : (catsRaw?.data ?? []);
  }, [catsRaw]);

  // ── Charge (create transaction) ───────────────────────────────────────────
  // After success, refresh the shift summary so KPI cards stay accurate.
  async function charge({ cartItems, payments, discountAmt, customer, note, heldTxId }) {
    if (!storeId)      throw new Error("No store selected");
    if (!cartItems.length) throw new Error("Cart is empty");
    if (!payments.length)  throw new Error("No payment entered");

    // Determine single method vs split
    const uniqueMethods  = [...new Set(payments.map((p) => p.type))];
    const paymentMethod  = uniqueMethods.length === 1 ? uniqueMethods[0] : "split";
    const amountTendered = payments.reduce((s, p) => s + p.amount, 0);

    const result = await createTransaction({
      store_id:        storeId,
      customer_id:     customer?.id ?? null,
      payment_method:  paymentMethod,
      amount_tendered: amountTendered,
      notes:           note || null,
      discount_amount: discountAmt > 0.001 ? discountAmt : null,
      held_tx_id:      heldTxId ?? null,
      client_uuid:     crypto.randomUUID(),
      offline_sale:    false,
      items: cartItems.map((item) => ({
        item_id:    item.itemId,
        quantity:   item.quantity,
        unit_price: item.price,
        discount:   item.discount ?? 0,
      })),
    });

    // Refresh shift KPI cards after every sale
    if (activeShift?.id) {
      queryClient.invalidateQueries({ queryKey: ["shift-summary", activeShift.id] });
    }

    // Refresh customer + credit-sales cache when a credit sale changes the outstanding balance
    if (customer?.id && paymentMethod === "credit") {
      queryClient.invalidateQueries({ queryKey: ["customer",       customer.id] });
      queryClient.invalidateQueries({ queryKey: ["customer-stats", customer.id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["credit-sales"] });
      queryClient.invalidateQueries({ queryKey: ["credit-summary"] });
    }

    return result;
  }

  // ── Barcode lookup (for scanner) ──────────────────────────────────────────
  async function lookupBarcode(barcode) {
    return getItemByBarcode(barcode, storeId);
  }

  return {
    storeId,
    // items
    items,
    itemsTotal,
    totalPages,
    itemsLoading,
    itemsFetching,
    // categories
    categories,
    // actions
    charge,
    lookupBarcode,
  };
}

// ── useCustomerSearch ─────────────────────────────────────────────────────────
export function useCustomerSearch(search = "") {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data, isLoading } = useQuery({
    queryKey:  ["customer-search", storeId, search],
    queryFn:   () => getCustomers({ store_id: storeId, search, page: 1, limit: 20 }),
    enabled:   !!storeId && search.length >= 1,
    staleTime: 30_000,
  });

  const customers = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data : (data?.data ?? []);
  }, [data]);

  return { customers, isLoading };
}
