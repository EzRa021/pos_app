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

import { create } from "zustand";
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
export function calcCartTotals(cartItems, cartDiscount = 0, cartDiscountPct = 0) {
  const subtotal = cartItems.reduce(
    (sum, item) => sum + (item.price * item.quantity) - (item.discount ?? 0),
    0
  );
  const tax = cartItems.reduce((sum, item) => {
    const lineTotal = item.price * item.quantity - (item.discount ?? 0);
    return sum + lineTotal * ((item.taxRate ?? 0) / 100);
  }, 0);
  const discountAmt = cartDiscountPct > 0
    ? subtotal * (cartDiscountPct / 100)
    : cartDiscount;
  const total = Math.max(0, subtotal + tax - discountAmt);
  return { subtotal, tax, discountAmt, total };
}

export const useCartStore = create((set, get) => ({
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
}));
