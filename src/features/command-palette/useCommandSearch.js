// ============================================================================
// features/command-palette/useCommandSearch.js
// ============================================================================
// Fires debounced parallel searches against items, customers, suppliers, and
// transactions whenever the query string changes. Returns flat result buckets
// ready for the CommandPalette to render.
//
// Results are capped at MAX_PER_GROUP per entity type to keep the list tight.
// All entity searches are scoped to the active store via branch.store.
//
// Design notes:
//   - No React Query — fire-and-forget searches with local state so the query
//     cache isn't polluted with every keystroke.
//   - 250ms debounce: fast enough to feel instant, light enough on the backend.
//   - Empty query → clear results immediately, no network call.
// ============================================================================

import { useState, useEffect, useRef } from "react";
import { useBranchStore }         from "@/stores/branch.store";
import { searchItems }            from "@/commands/items";
import { searchCustomers }        from "@/commands/customers";
import { searchSuppliers }        from "@/commands/suppliers";
import { searchTransactions }     from "@/commands/transactions";
import { searchPurchaseOrders }   from "@/commands/purchase_orders";
import { searchReturns }          from "@/commands/returns";
import { searchTransfers }        from "@/commands/stock_transfers";

const DEBOUNCE_MS   = 250;
const MAX_PER_GROUP = 5;

/**
 * @param {string} query  Raw search string from the palette input.
 * @returns {{
 *   items:        Array<{ id, label, subtitle }>,
 *   customers:    Array<{ id, label, subtitle }>,
 *   suppliers:    Array<{ id, label, subtitle }>,
 *   transactions: Array<{ id, label, subtitle }>,
 *   isLoading:    boolean,
 * }}
 */
export function useCommandSearch(query) {
  const storeId = useBranchStore((s) => s.activeStore?.id ?? null);

  const [isLoading,       setIsLoading]       = useState(false);
  const [items,           setItems]           = useState([]);
  const [customers,       setCustomers]       = useState([]);
  const [suppliers,       setSuppliers]       = useState([]);
  const [transactions,    setTransactions]    = useState([]);
  const [purchaseOrders,  setPurchaseOrders]  = useState([]);
  const [returns,         setReturns]         = useState([]);
  const [transfers,       setTransfers]       = useState([]);

  // Track the latest request so stale responses from slower calls are dropped.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();

    // Nothing typed → clear results immediately, no network call.
    if (!trimmed || !storeId) {
      setItems([]);
      setCustomers([]);
      setSuppliers([]);
      setTransactions([]);
      setPurchaseOrders([]);
      setReturns([]);
      setTransfers([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const myId = ++requestIdRef.current;

    const timerId = setTimeout(async () => {
      try {
        const [rawItems, rawCustomers, rawSuppliers, rawTransactions, rawPOs, rawReturns, rawTransfers] =
          await Promise.allSettled([
            searchItems(trimmed, storeId, MAX_PER_GROUP),
            searchCustomers(trimmed, storeId, MAX_PER_GROUP),
            searchSuppliers(trimmed, storeId, MAX_PER_GROUP),
            searchTransactions(trimmed, storeId, MAX_PER_GROUP),
            searchPurchaseOrders(trimmed, storeId, MAX_PER_GROUP),
            searchReturns(trimmed, storeId, MAX_PER_GROUP),
            searchTransfers(trimmed, storeId, MAX_PER_GROUP),
          ]);

        // Drop stale responses if a newer request fired while we were waiting.
        if (myId !== requestIdRef.current) return;

        // ── Items ─────────────────────────────────────────────────────────
        if (rawItems.status === "fulfilled") {
          const arr = Array.isArray(rawItems.value)
            ? rawItems.value
            : (rawItems.value?.data ?? []);
          setItems(
            arr.slice(0, MAX_PER_GROUP).map((it) => ({
              id:       it.id,
              label:    it.item_name ?? it.name ?? "Unnamed item",
              subtitle: it.sku
                ? `SKU: ${it.sku}`
                : it.barcode
                  ? `Barcode: ${it.barcode}`
                  : (it.category_name ?? ""),
            }))
          );
        } else {
          setItems([]);
        }

        // ── Customers ─────────────────────────────────────────────────────
        if (rawCustomers.status === "fulfilled") {
          const arr = Array.isArray(rawCustomers.value)
            ? rawCustomers.value
            : (rawCustomers.value?.data ?? []);
          setCustomers(
            arr.slice(0, MAX_PER_GROUP).map((c) => ({
              id:       c.id,
              label:    [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Unnamed",
              subtitle: c.phone ?? c.email ?? "",
            }))
          );
        } else {
          setCustomers([]);
        }

        // ── Suppliers ─────────────────────────────────────────────────────
        if (rawSuppliers.status === "fulfilled") {
          const arr = Array.isArray(rawSuppliers.value)
            ? rawSuppliers.value
            : (rawSuppliers.value?.data ?? []);
          setSuppliers(
            arr.slice(0, MAX_PER_GROUP).map((s) => ({
              id:       s.id,
              label:    s.supplier_name ?? "Unnamed supplier",
              subtitle: s.city ?? s.phone ?? s.email ?? "",
            }))
          );
        } else {
          setSuppliers([]);
        }

        // ── Transactions ──────────────────────────────────────────────────
        if (rawTransactions.status === "fulfilled") {
          const arr = Array.isArray(rawTransactions.value)
            ? rawTransactions.value
            : (rawTransactions.value?.data ?? []);
          setTransactions(
            arr.slice(0, MAX_PER_GROUP).map((t) => ({
              id:       t.id,
              label:    t.reference_no,
              // Show customer name if present, otherwise cashier, otherwise payment method
              subtitle: t.customer_name?.trim()
                ? t.customer_name.trim()
                : t.cashier_name?.trim()
                  ? `Cashier: ${t.cashier_name.trim()}`
                  : (t.payment_method ?? ""),
            }))
          );
        } else {
          setTransactions([]);
        }

        // ── Purchase Orders ───────────────────────────────────────────────
        if (rawPOs.status === "fulfilled") {
          const arr = Array.isArray(rawPOs.value) ? rawPOs.value : (rawPOs.value?.data ?? []);
          setPurchaseOrders(
            arr.slice(0, MAX_PER_GROUP).map((po) => ({
              id:       po.id,
              label:    po.po_number,
              subtitle: po.supplier_name
                ? `${po.supplier_name} · ${po.status}`
                : po.status,
            }))
          );
        } else {
          setPurchaseOrders([]);
        }

        // ── Returns ───────────────────────────────────────────────────────
        if (rawReturns.status === "fulfilled") {
          const arr = Array.isArray(rawReturns.value) ? rawReturns.value : (rawReturns.value?.data ?? []);
          setReturns(
            arr.slice(0, MAX_PER_GROUP).map((r) => ({
              id:       r.id,
              label:    r.reference_no,
              subtitle: r.customer_name?.trim()
                ? `${r.customer_name.trim()} · ${r.return_type}`
                : r.return_type,
            }))
          );
        } else {
          setReturns([]);
        }

        // ── Stock Transfers ───────────────────────────────────────────────
        if (rawTransfers.status === "fulfilled") {
          const arr = Array.isArray(rawTransfers.value) ? rawTransfers.value : (rawTransfers.value?.data ?? []);
          setTransfers(
            arr.slice(0, MAX_PER_GROUP).map((t) => ({
              id:       t.id,
              label:    t.transfer_number,
              subtitle: [t.from_store_name, t.to_store_name].filter(Boolean).join(" → ") || t.status,
            }))
          );
        } else {
          setTransfers([]);
        }

      } catch {
        // Silently swallow — palette is best-effort, not mission-critical.
        if (myId === requestIdRef.current) {
          setItems([]);
          setCustomers([]);
          setSuppliers([]);
          setTransactions([]);
          setPurchaseOrders([]);
          setReturns([]);
          setTransfers([]);
        }
      } finally {
        if (myId === requestIdRef.current) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timerId);
  }, [query, storeId]);

  return { items, customers, suppliers, transactions, purchaseOrders, returns, transfers, isLoading };
}
