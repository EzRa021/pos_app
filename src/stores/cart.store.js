// ============================================================================
// stores/cart.store.js — POS cart state
// ============================================================================
// Manages the cashier's active cart: line items, discounts, held transactions.
//
// Cart totals are always derived from cartItems — never stored separately.
// All monetary input from the backend is a Decimal string; convert with
// parseFloat() before storing in the cart.
//
// CartItem shape (frontend-only, not a DB model):
//   itemId, sku, name, price (number), quantity (number), taxRate (number),
//   discount (number — per-line), unit (string), originalPrice (number),
//   hasDiscount (bool), categoryName (string)
// ============================================================================

import Big from "big.js";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { rpc } from "@/lib/apiClient";

const EMPTY_CART = {
  cartItems:          [],       // CartItem[]
  cartDiscount:       0,        // flat discount on entire cart (₦)
  cartDiscountPct:    0,        // percentage discount on entire cart (%)
  activeCustomer:     null,     // Customer | null — for credit sales
  heldTransactions:   [],       // HeldTransaction[] — loaded on demand
  note:               "",       // optional order note
  heldTxId:          null,      // id of held transaction recalled into cart
};

// ── Derive totals from cartItems ──────────────────────────────────────────────
//
// taxInclusive = true  (default, Nigeria standard):
//   Prices already include VAT. Tax is EXTRACTED for display only, never added.
//   Formula: taxComponent = lineTotal × rate / (100 + rate)
//   Example: ₦107.50 at 7.5% → tax = ₦7.50 (inside price) → total = ₦107.50
//
// taxInclusive = false:
//   Prices exclude VAT. Tax is ADDED on top at checkout.
//   Formula: taxComponent = baseLineTotal × rate / 100
//   Example: ₦100.00 at 7.5% → tax = ₦7.50 → total = ₦107.50
//
export function calcCartTotals(cartItems, cartDiscount = 0, cartDiscountPct = 0, taxInclusive = true) {
  let subtotal = new Big(0);  // pre-discount line totals (excl. tax when taxInclusive=false)
  let tax      = new Big(0);

  for (const item of cartItems) {
    const price    = new Big(item.price    ?? 0);
    const qty      = new Big(item.quantity ?? 0);
    const discount = new Big(item.discount ?? 0);
    const lineTotal = price.times(qty).minus(discount);
    subtotal = subtotal.plus(lineTotal);

    const rate = item.taxRate ?? 0;
    if (rate > 0) {
      const r = new Big(rate);
      if (taxInclusive) {
        // Extract VAT already embedded: lineTotal × rate / (100 + rate)
        tax = tax.plus(lineTotal.times(r).div(new Big(100).plus(r)));
      } else {
        // Add VAT on top: lineTotal × rate / 100
        tax = tax.plus(lineTotal.times(r).div(100));
      }
    }
  }

  // Cart-level discount (percentage takes priority over flat amount)
  let discountAmt;
  if (cartDiscountPct > 0) {
    discountAmt = subtotal.times(new Big(cartDiscountPct)).div(100);
  } else {
    discountAmt = new Big(cartDiscount ?? 0);
  }

  const afterDiscount = subtotal.minus(discountAmt);
  const base          = afterDiscount.lt(0) ? new Big(0) : afterDiscount;

  // Tax-exclusive: total = base + tax. Tax-inclusive: total = base (tax already embedded).
  const total = taxInclusive ? base : base.plus(tax);

  return {
    subtotal:     Number(subtotal.toFixed(4)),
    tax:          Number(tax.toFixed(4)),
    discountAmt:  Number(discountAmt.toFixed(4)),
    total:        Number(total.toFixed(4)),
    taxInclusive,
  };
}

export const useCartStore = create(
  persist(
    (set, get) => ({
  ...EMPTY_CART,

  // ── Add / update an item ──────────────────────────────────────────────────
  addItem(item) {
    const { cartItems } = get();
    const existing = cartItems.find((i) => i.itemId === item.itemId);
    if (existing) {
      set({
        cartItems: cartItems.map((i) =>
          i.itemId === item.itemId
            ? { ...i, quantity: i.quantity + (item.quantity ?? 1) }
            : i
        ),
      });
    } else {
      set({
        cartItems: [
          ...cartItems,
          { ...item, quantity: item.quantity ?? 1, discount: item.discount ?? 0 },
        ],
      });
    }
  },

  // ── Remove an item by itemId ───────────────────────────────────────────────
  removeItem(itemId) {
    set({ cartItems: get().cartItems.filter((i) => i.itemId !== itemId) });
  },

  // ── Update quantity directly ──────────────────────────────────────────────
  setQuantity(itemId, quantity) {
    if (quantity <= 0) { get().removeItem(itemId); return; }
    set({
      cartItems: get().cartItems.map((i) =>
        i.itemId === itemId ? { ...i, quantity } : i
      ),
    });
  },

  // ── Set a per-line discount ───────────────────────────────────────────────
  setLineDiscount(itemId, discount) {
    set({
      cartItems: get().cartItems.map((i) =>
        i.itemId === itemId ? { ...i, discount: Math.max(0, discount) } : i
      ),
    });
  },

  // ── Cart-level discount ───────────────────────────────────────────────────
  setCartDiscount(amount) {
    set({ cartDiscount: Math.max(0, amount), cartDiscountPct: 0 });
  },
  setCartDiscountPct(pct) {
    set({ cartDiscountPct: Math.min(100, Math.max(0, pct)), cartDiscount: 0 });
  },

  // ── Customer ──────────────────────────────────────────────────────────────
  setCustomer(customer) { set({ activeCustomer: customer }); },
  clearCustomer()       { set({ activeCustomer: null }); },

  // ── Note ──────────────────────────────────────────────────────────────────
  setNote(note) { set({ note }); },

  // ── Held transactions ─────────────────────────────────────────────────────
  async loadHeldTransactions(storeId) {
    try {
      const held = await rpc("get_held_transactions", { store_id: storeId });
      set({ heldTransactions: held ?? [] });
    } catch {
      set({ heldTransactions: [] });
    }
  },

  // Saves current cart to the backend as a held transaction.
  // cart_data is a JSON blob that stores all cart state for later recall.
  async holdCurrentCart(storeId, label = "") {
    const { cartItems, activeCustomer, note } = get();
    if (cartItems.length === 0) throw new Error("Cart is empty");

    const cartData = {
      items:    cartItems,
      customer: activeCustomer ?? null,
      note:     label || note || "",
    };

    await rpc("hold_transaction", {
      store_id:  storeId,
      label:     label || note || null,
      cart_data: cartData,
    });

    get().clearCart();
    await get().loadHeldTransactions(storeId);
  },

  // Restores cart from a held transaction and deletes the hold record.
  async recallHeldTransaction(storeId, transactionId) {
    const held = get().heldTransactions.find((t) => t.id === transactionId);
    if (!held) return;

    // cart_data may come back as a parsed object or a JSON string depending
    // on the sqlx driver version — handle both.
    const cartData =
      held.cart_data && typeof held.cart_data === "object"
        ? held.cart_data
        : JSON.parse(held.cart_data ?? "{}");

    set({
      cartItems:      Array.isArray(cartData.items)   ? cartData.items   : [],
      activeCustomer: cartData.customer ?? null,
      note:           cartData.note     ?? "",
      heldTxId:       held.id,
    });

    await rpc("delete_held_transaction", { id: transactionId });
    set({
      heldTransactions: get().heldTransactions.filter((t) => t.id !== transactionId),
    });
  },

  // ── Clear ─────────────────────────────────────────────────────────────────
  clearCart() {
    set({ ...EMPTY_CART, heldTransactions: get().heldTransactions });
  },

  // ── Derived totals (call in components via useMemo or directly) ───────────
  getTotals() {
    const { cartItems, cartDiscount, cartDiscountPct } = get();
    return calcCartTotals(cartItems, cartDiscount, cartDiscountPct);
  },
    }),
    {
      name: "qpos_cart",
      storage: createJSONStorage(() => sessionStorage),
      // heldTransactions is transient server data — never persist it
      partialize: (state) => ({
        cartItems:       state.cartItems,
        cartDiscount:    state.cartDiscount,
        cartDiscountPct: state.cartDiscountPct,
        activeCustomer:  state.activeCustomer,
        note:            state.note,
        heldTxId:        state.heldTxId,
      }),
    }
  )
);
