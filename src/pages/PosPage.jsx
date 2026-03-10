// ============================================================================
// pages/PosPage.jsx — Point of Sale
// ============================================================================
// Layout:
//   ┌────────────────────────────────────────────────────────────┐
//   │  LEFT 55%: Products panel (search, category filter, grid)  │
//   ├────────────────────────────────────────────────────────────┤
//   │  RIGHT 45%: Cart panel (items, qty controls, totals)       │
//   ├────────────────────────────────────────────────────────────┤
//   │  BOTTOM BAR: Payment methods · Actions · Summary           │
//   └────────────────────────────────────────────────────────────┘
//
// Shift guard: cashier must have an open shift before any sale.
// Payment: Cash / Card / Transfer / Credit (requires customer).
//   Split: multiple payment entries → method stored as "split".
// Hold flow: save cart → HoldDrawer → recall back.
// Receipt: shown on success, closes with "New Sale".
// ============================================================================

import {
  useState, useRef, useMemo, useEffect, useCallback,
} from "react";
import { toast } from "sonner";
import {
  ShoppingCart, Package, Search, Filter,
  Grid3X3, List, Plus, Minus, Trash2,
  Banknote, CreditCard, Smartphone, Receipt,
  ArrowLeft, ArrowRight, Clock, X, User,
  Tag, CheckCircle2, Loader2, ChevronDown,
} from "lucide-react";

import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Badge }    from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useCartStore, calcCartTotals } from "@/stores/cart.store";
import { useBranchStore }  from "@/stores/branch.store";
import { useShiftStore }   from "@/stores/shift.store";
import { useAuthStore }    from "@/stores/auth.store";

import { usePos }               from "@/features/pos/usePos";
import { HoldDrawer }           from "@/features/pos/HoldDrawer";
import { CustomerSearchBar }    from "@/features/pos/CustomerSearchBar";
import { ReceiptModal }         from "@/features/pos/ReceiptModal";
import { deleteHeldTransaction } from "@/commands/transactions";

import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 20;

const PM_CONFIG = {
  [PAYMENT_METHODS.CASH]: {
    label:    "Cash",
    Icon:     Banknote,
    btnCls:   "border-success/50 text-success hover:bg-success/10 hover:border-success",
    badgeCls: "bg-success/15 text-success border-success/20",
    dotCls:   "bg-success",
  },
  [PAYMENT_METHODS.CARD]: {
    label:    "Card",
    Icon:     CreditCard,
    btnCls:   "border-primary/50 text-primary hover:bg-primary/10 hover:border-primary",
    badgeCls: "bg-primary/15 text-primary border-primary/20",
    dotCls:   "bg-primary",
  },
  [PAYMENT_METHODS.TRANSFER]: {
    label:    "Transfer",
    Icon:     Smartphone,
    btnCls:   "border-warning/50 text-warning hover:bg-warning/10 hover:border-warning",
    badgeCls: "bg-warning/15 text-warning border-warning/20",
    dotCls:   "bg-warning",
  },
  [PAYMENT_METHODS.CREDIT]: {
    label:    "Credit",
    Icon:     Receipt,
    btnCls:   "border-rose-500/50 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500",
    badgeCls: "bg-rose-500/15 text-rose-400 border-rose-500/20",
    dotCls:   "bg-rose-400",
  },
};

const AVATAR_PALETTE = [
  "bg-blue-500/20   text-blue-400",
  "bg-violet-500/20 text-violet-400",
  "bg-amber-500/20  text-amber-400",
  "bg-emerald-500/20 text-emerald-400",
  "bg-rose-500/20   text-rose-400",
  "bg-cyan-500/20   text-cyan-400",
  "bg-orange-500/20 text-orange-400",
  "bg-indigo-500/20 text-indigo-400",
];
function avatarCls(name = "") {
  return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// PosPage
// ─────────────────────────────────────────────────────────────────────────────

export default function PosPage() {
  const storeId     = useBranchStore((s) => s.activeStore?.id);
  const storeName   = useBranchStore((s) => s.activeStore?.store_name);
  const user        = useAuthStore((s) => s.user);
  const activeShift = useShiftStore((s) => s.activeShift);
  const isShiftOpen = activeShift?.status === "open";

  // ── Cart ─────────────────────────────────────────────────────────────────
  const cartItems       = useCartStore((s) => s.cartItems);
  const cartDiscount    = useCartStore((s) => s.cartDiscount);
  const cartDiscountPct = useCartStore((s) => s.cartDiscountPct);
  const activeCustomer  = useCartStore((s) => s.activeCustomer);
  const note            = useCartStore((s) => s.note);
  const heldTransactions= useCartStore((s) => s.heldTransactions);
  const heldTxId        = useCartStore((s) => s.heldTxId);

  const addItem      = useCartStore((s) => s.addItem);
  const removeItem   = useCartStore((s) => s.removeItem);
  const setQuantity  = useCartStore((s) => s.setQuantity);
  const clearCart    = useCartStore((s) => s.clearCart);
  const setCustomer  = useCartStore((s) => s.setCustomer);
  const clearCustomer= useCartStore((s) => s.clearCustomer);
  const setCartDiscount= useCartStore((s) => s.setCartDiscount);
  const loadHeld     = useCartStore((s) => s.loadHeldTransactions);
  const holdCurrent  = useCartStore((s) => s.holdCurrentCart);
  const recallHeld   = useCartStore((s) => s.recallHeldTransaction);

  // ── Products filter state ─────────────────────────────────────────────────
  const [searchTerm,  setSearchTerm]  = useState("");
  const [debSearch,   setDebSearch]   = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [catId,       setCatId]       = useState(null);
  const [viewMode,    setViewMode]    = useState("grid");
  const searchRef = useRef(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showHoldDrawer,    setShowHoldDrawer]    = useState(false);
  const [showCustomerSearch,setShowCustomerSearch]= useState(false);
  const [showReceipt,       setShowReceipt]       = useState(false);
  const [lastTransaction,   setLastTransaction]   = useState(null);
  const [isCharging,        setIsCharging]        = useState(false);
  const [isHolding,         setIsHolding]         = useState(false);

  // ── Payment state ─────────────────────────────────────────────────────────
  const [payments, setPayments] = useState([]);
  const [popover,  setPopover]  = useState({ open: false, type: null, amount: "" });

  // ── Load held transactions on mount / store change ────────────────────────
  useEffect(() => {
    if (storeId) loadHeld(storeId);
  }, [storeId, loadHeld]);

  // ── POS data hook ─────────────────────────────────────────────────────────
  const { items, itemsTotal, totalPages, itemsLoading, categories, charge, lookupBarcode } = usePos({
    search: debSearch,
    catId,
    page:   currentPage,
    limit:  ITEMS_PER_PAGE,
  });

  // ── Debounce search → reset page ─────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { setDebSearch(searchTerm); setCurrentPage(1); }, 280);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => { setCurrentPage(1); }, [catId]);

  // ── Totals ────────────────────────────────────────────────────────────────
  const { subtotal, tax, discountAmt, total } = useMemo(
    () => calcCartTotals(cartItems, cartDiscount, cartDiscountPct),
    [cartItems, cartDiscount, cartDiscountPct],
  );

  const totalPaid = useMemo(
    () => payments.reduce((s, p) => s + p.amount, 0),
    [payments],
  );
  const remaining  = total - totalPaid;
  const change     = remaining < -0.01 ? Math.abs(remaining) : 0;
  const amountDue  = remaining >  0.01 ? remaining : 0;
  const isBalanced = isShiftOpen && cartItems.length > 0 && payments.length > 0 && Math.abs(remaining) <= 0.01;

  // Auto-adjust last payment entry when cart total changes
  useEffect(() => {
    if (payments.length === 0) return;
    setPayments((prev) => {
      if (prev.length === 1) return [{ ...prev[0], amount: total }];
      const othersTotal = prev.slice(0, -1).reduce((s, p) => s + p.amount, 0);
      const adjusted    = Math.max(0, total - othersTotal);
      return [...prev.slice(0, -1), { ...prev[prev.length - 1], amount: adjusted }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  // ── Cart action handlers ──────────────────────────────────────────────────
  const handleAddToCart = useCallback((item) => {
    const effectivePrice = item.discount_price
      ? parseFloat(item.discount_price)
      : parseFloat(item.selling_price);

    addItem({
      itemId:        item.id,
      sku:           item.sku ?? "",
      name:          item.item_name,
      price:         effectivePrice,
      originalPrice: parseFloat(item.selling_price),
      hasDiscount:   !!item.discount_price && parseFloat(item.discount_price) < parseFloat(item.selling_price),
      quantity:      1,
      taxRate:       item.taxable ? parseFloat(item.tax_rate ?? "7.5") : 0,
      discount:      0,
      unit:          item.unit ?? "unit",
      categoryName:  item.category_name ?? "",
    });
  }, [addItem]);

  const handleClearCart = useCallback(() => {
    clearCart();
    setPayments([]);
  }, [clearCart]);

  // ── Payment handlers ──────────────────────────────────────────────────────
  const handlePaymentClick = useCallback((type) => {
    // Credit requires a customer
    if (type === PAYMENT_METHODS.CREDIT && !activeCustomer) {
      toast.error("Select a customer before adding a credit payment");
      setShowCustomerSearch(true);
      return;
    }
    const rem = Math.max(0, remaining);
    setPopover({ open: true, type, amount: rem > 0 ? rem.toFixed(2) : "" });
  }, [remaining, activeCustomer]);

  const handlePaymentSubmit = useCallback(() => {
    const amount = parseFloat(popover.amount);
    if (!isNaN(amount) && amount > 0) {
      setPayments((prev) => [...prev, { id: Date.now(), type: popover.type, amount }]);
    }
    setPopover({ open: false, type: null, amount: "" });
  }, [popover]);

  const handleRemovePayment = useCallback((id) => {
    setPayments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ── Charge ────────────────────────────────────────────────────────────────
  const handleCharge = useCallback(async () => {
    if (!isBalanced || isCharging) return;
    setIsCharging(true);
    try {
      const result = await charge({
        cartItems,
        payments,
        discountAmt,
        customer: activeCustomer,
        note,
        heldTxId,
      });
      setLastTransaction(result);
      setShowReceipt(true);
      clearCart();
      setPayments([]);
      // Refresh held transactions (heldTxId was just deleted by backend)
      if (storeId) loadHeld(storeId);
    } catch (err) {
      const msg = typeof err === "string" ? err : (err?.message ?? "Transaction failed. Please try again.");
      toast.error(msg);
    } finally {
      setIsCharging(false);
    }
  }, [isBalanced, isCharging, charge, cartItems, payments, discountAmt, activeCustomer, note, heldTxId, clearCart, storeId, loadHeld]);

  // ── Hold ──────────────────────────────────────────────────────────────────
  const handleHoldCurrent = useCallback(async (label = "") => {
    if (!storeId) return;
    setIsHolding(true);
    try {
      await holdCurrent(storeId, label);
      setPayments([]);
      toast.success("Cart saved to hold");
    } catch (err) {
      const msg = typeof err === "string" ? err : (err?.message ?? "Failed to hold cart");
      toast.error(msg);
      throw err;
    } finally {
      setIsHolding(false);
    }
  }, [storeId, holdCurrent]);

  const handleOpenHoldDrawer = useCallback(() => {
    setShowHoldDrawer(true);
  }, []);

  const handleRecallHeld = useCallback(async (id) => {
    setPayments([]); // clear payments when recalling
    await recallHeld(storeId, id);
    toast.success("Cart recalled from hold");
  }, [recallHeld, storeId]);

  const handleDeleteHeld = useCallback(async (id) => {
    try {
      await deleteHeldTransaction(id);
      await loadHeld(storeId);
      toast.success("Hold deleted");
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Failed to delete hold");
    }
  }, [loadHeld, storeId]);

  // ── Barcode / keyboard shortcut ───────────────────────────────────────────
  // Focus search on any alphanumeric keypress
  useEffect(() => {
    const onKey = (e) => {
      if (
        /^[a-zA-Z0-9]$/.test(e.key) &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) &&
        !e.ctrlKey && !e.altKey && !e.metaKey
      ) {
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Shift guard ───────────────────────────────────────────────────────────
  if (!isShiftOpen) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-5 text-center py-20">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-card">
          <Clock className="h-9 w-9 text-muted-foreground/30" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-foreground">No Active Shift</p>
          <p className="text-xs text-muted-foreground">
            Open a shift from the Shifts page before making sales.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.history.back()}>
          Go to Shifts
        </Button>
      </div>
    );
  }

  const grossSubtotal = subtotal + discountAmt;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">

      {/* ── Main split: Products + Cart ─────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ─────────────────────── LEFT 55%: Products panel ─────────── */}
        <div className="w-[55%] flex flex-col overflow-hidden border-r border-border">

          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15">
                <Package className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-[13px] font-bold text-foreground">Products</span>
              {!itemsLoading && itemsTotal > 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  ({itemsTotal.toLocaleString()})
                </span>
              )}
            </div>

            {/* Grid / List toggle */}
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background/80 p-0.5">
              {["grid", "list"].map((m) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={cn(
                    "flex h-6 w-7 items-center justify-center rounded-md transition-all duration-150",
                    viewMode === m
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m === "grid" ? <Grid3X3 className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          </div>

          {/* Search + category filter */}
          <div className="flex gap-2 px-3 py-2 shrink-0 border-b border-border bg-card/20">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchRef}
                placeholder="Search items or scan barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-8 h-8 text-[12px] bg-background/50 border-border/60"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Select
              value={catId ? String(catId) : "all"}
              onValueChange={(v) => setCatId(v === "all" ? null : parseInt(v))}
            >
              <SelectTrigger className="w-40 h-8 text-[11px] bg-background/50 border-border/60">
                <Filter className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.category_name ?? c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Items area */}
          <div className="flex-1 overflow-auto min-h-0">
            {itemsLoading ? (
              <div className={cn(
                "p-3",
                viewMode === "grid" ? "grid grid-cols-3 gap-2.5" : "space-y-1.5"
              )}>
                {Array.from({ length: 12 }).map((_, i) =>
                  viewMode === "grid"
                    ? <div key={i} className="h-[118px] rounded-xl border border-border/30 bg-card/50 animate-pulse" />
                    : <div key={i} className="h-12 rounded-lg border border-border/30 bg-card/50 animate-pulse" />
                )}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted/10">
                  <Package className="h-8 w-8 text-muted-foreground/20" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">No products found</p>
                  {(searchTerm || catId) && (
                    <p className="text-[11px] text-muted-foreground/50 mt-1">
                      Try adjusting your search or category filter
                    </p>
                  )}
                </div>
                {(searchTerm || catId) && (
                  <Button
                    variant="ghost" size="xs"
                    onClick={() => { setSearchTerm(""); setCatId(null); }}
                    className="text-xs text-muted-foreground"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-3 gap-2.5 p-3">
                {items.map((item) => (
                  <ItemCard key={item.id} item={item} onAdd={handleAddToCart} />
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {items.map((item, idx) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    index={(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}
                    onAdd={handleAddToCart}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="shrink-0 flex items-center justify-between border-t border-border px-4 py-2 bg-card/40">
              <Button
                variant="ghost" size="xs"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => p - 1)}
                className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" /> Prev
              </Button>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="ghost" size="xs"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
                className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Next <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        {/* ─────────────────────── RIGHT 45%: Cart panel ────────────── */}
        <div className="w-[45%] flex flex-col overflow-hidden">

          {/* Cart header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-success/15">
                <ShoppingCart className="h-3.5 w-3.5 text-success" />
              </div>
              <span className="text-[13px] font-bold text-foreground">Cart</span>
              {cartItems.length > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/20 px-1.5 text-[10px] font-bold text-primary tabular-nums leading-none">
                  {cartItems.length}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Held transactions badge */}
              <button
                onClick={handleOpenHoldDrawer}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold transition-all",
                  heldTransactions.length > 0
                    ? "text-warning hover:bg-warning/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                )}
              >
                <Clock className="h-3 w-3" />
                Held
                {heldTransactions.length > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning/20 px-1 text-[9px] font-bold text-warning leading-none tabular-nums">
                    {heldTransactions.length}
                  </span>
                )}
              </button>

              {cartItems.length > 0 && (
                <button
                  onClick={handleClearCart}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-destructive/40 hover:text-destructive hover:bg-destructive/10 transition-all"
                  title="Clear cart"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Cart items */}
          {cartItems.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-muted/10">
                <ShoppingCart className="h-9 w-9 text-muted-foreground/15" />
              </div>
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Cart is empty</p>
                <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                  Click a product on the left to add it
                </p>
              </div>
              {heldTransactions.length > 0 && (
                <Button
                  variant="outline" size="sm"
                  className="gap-1.5 text-[11px] border-warning/30 text-warning hover:bg-warning/10 hover:border-warning"
                  onClick={handleOpenHoldDrawer}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Recall Held ({heldTransactions.length})
                </Button>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-auto min-h-0 px-3 py-2.5 space-y-1.5">
              {cartItems.map((item) => (
                <CartItemRow
                  key={item.itemId}
                  item={item}
                  onRemove={removeItem}
                  onSetQty={setQuantity}
                />
              ))}
            </div>
          )}

          {/* Cart discount input (shown when cart has items) */}
          {cartItems.length > 0 && (
            <div className="px-3 py-2 border-t border-border/40 bg-card/20 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground shrink-0">Discount (₦)</span>
                <Input
                  type="number"
                  placeholder="0"
                  value={cartDiscount > 0 ? cartDiscount : ""}
                  onChange={(e) => setCartDiscount(parseFloat(e.target.value) || 0)}
                  className="h-7 text-[11px] bg-background/50 border-border/50 flex-1 font-mono"
                  min="0"
                  step="1"
                />
                {cartDiscount > 0 && (
                  <button
                    onClick={() => setCartDiscount(0)}
                    className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom bar ──────────────────────────────────────────────────── */}
      <BottomBar
        cartItems={cartItems}
        payments={payments}
        popover={popover}
        setPopover={setPopover}
        onPaymentClick={handlePaymentClick}
        onPaymentSubmit={handlePaymentSubmit}
        onRemovePayment={handleRemovePayment}
        onHold={() => setShowHoldDrawer(true)}
        onClear={handleClearCart}
        onCharge={handleCharge}
        activeCustomer={activeCustomer}
        onCustomerClick={() => setShowCustomerSearch(true)}
        subtotal={subtotal}
        tax={tax}
        discountAmt={discountAmt}
        grossSubtotal={grossSubtotal}
        total={total}
        totalPaid={totalPaid}
        remaining={remaining}
        change={change}
        amountDue={amountDue}
        isBalanced={isBalanced}
        isCharging={isCharging}
      />

      {/* ── Modals / sheets ──────────────────────────────────────────────── */}
      <HoldDrawer
        open={showHoldDrawer}
        onOpenChange={setShowHoldDrawer}
        heldTransactions={heldTransactions}
        onHoldCurrent={handleHoldCurrent}
        onRecall={handleRecallHeld}
        onDelete={handleDeleteHeld}
        cartIsEmpty={cartItems.length === 0}
        isHolding={isHolding}
      />

      <CustomerSearchBar
        open={showCustomerSearch}
        onOpenChange={setShowCustomerSearch}
        activeCustomer={activeCustomer}
        onSelect={setCustomer}
        onClear={clearCustomer}
      />

      <ReceiptModal
        open={showReceipt}
        onClose={() => setShowReceipt(false)}
        transaction={lastTransaction}
        storeName={storeName}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ItemCard — grid tile
// ─────────────────────────────────────────────────────────────────────────────
function ItemCard({ item, onAdd }) {
  const price       = parseFloat(item.discount_price ?? item.selling_price ?? "0");
  const origPrice   = parseFloat(item.selling_price ?? "0");
  const hasDiscount = !!item.discount_price && price < origPrice;
  const stock       = parseFloat(item.available_quantity ?? "0");
  const minStock    = item.min_stock_level ?? 5;
  const isTracked   = item.track_stock;
  const isOut       = isTracked && stock <= 0;
  const isLow       = isTracked && !isOut && stock <= minStock;

  return (
    <button
      onClick={() => !isOut && onAdd(item)}
      disabled={isOut}
      className={cn(
        "group relative flex flex-col w-full rounded-xl border text-left overflow-hidden select-none",
        "transition-all duration-150",
        isOut
          ? "opacity-40 cursor-not-allowed border-border bg-card"
          : "cursor-pointer border-border bg-card hover:border-primary/40 hover:shadow-lg hover:shadow-black/30 active:scale-[0.98]"
      )}
    >
      {/* Letter avatar header */}
      <div className={cn(
        "flex items-center justify-center h-[52px] w-full border-b border-border/30",
        "text-[22px] font-bold leading-none",
        avatarCls(item.item_name),
      )}>
        {(item.item_name ?? "?").charAt(0).toUpperCase()}
      </div>

      <div className="px-2.5 pt-2 pb-2.5 flex flex-col gap-1.5 flex-1">
        <p className="text-[11px] font-semibold text-foreground leading-snug line-clamp-2 min-h-[2.4em]">
          {item.item_name}
        </p>
        <div className="flex items-end justify-between gap-1">
          <div>
            <p className="text-[13px] font-bold text-foreground tabular-nums leading-none">
              {formatCurrency(price)}
            </p>
            {hasDiscount && (
              <p className="text-[10px] text-muted-foreground/50 line-through tabular-nums mt-0.5">
                {formatCurrency(origPrice)}
              </p>
            )}
          </div>
          {isTracked && (
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none shrink-0",
              isOut ? "bg-destructive/15 text-destructive" :
              isLow ? "bg-warning/15 text-warning"        :
                      "bg-muted text-muted-foreground"
            )}>
              {isOut ? "Out" : String(stock)}
            </span>
          )}
        </div>
      </div>

      {hasDiscount && (
        <div className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-success/20">
          <Tag className="h-2.5 w-2.5 text-success" />
        </div>
      )}

      {!isOut && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40">
            <Plus className="h-4 w-4" />
          </div>
        </div>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ItemRow — list view
// ─────────────────────────────────────────────────────────────────────────────
function ItemRow({ item, index, onAdd }) {
  const price       = parseFloat(item.discount_price ?? item.selling_price ?? "0");
  const origPrice   = parseFloat(item.selling_price ?? "0");
  const hasDiscount = !!item.discount_price && price < origPrice;
  const stock       = parseFloat(item.available_quantity ?? "0");
  const isOut       = item.track_stock && stock <= 0;
  const isLow       = item.track_stock && !isOut && stock <= (item.min_stock_level ?? 5);

  return (
    <div
      onClick={() => !isOut && onAdd(item)}
      className={cn(
        "grid grid-cols-12 items-center gap-2 px-4 py-2.5 group transition-colors duration-100 select-none",
        isOut ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-muted/30 active:bg-muted/50"
      )}
    >
      <div className="col-span-1">
        <span className="text-[10px] text-muted-foreground/40 tabular-nums">{index}</span>
      </div>
      <div className="col-span-5 min-w-0">
        <p className="text-[12px] font-medium text-foreground truncate">{item.item_name}</p>
        {item.category_name && (
          <p className="text-[10px] text-muted-foreground/60 truncate">{item.category_name}</p>
        )}
      </div>
      <div className="col-span-3 flex items-center gap-1.5">
        <span className="text-[12px] font-bold text-foreground tabular-nums">
          {formatCurrency(price)}
        </span>
        {hasDiscount && (
          <>
            <span className="text-[10px] text-muted-foreground/40 line-through tabular-nums">
              {formatCurrency(origPrice)}
            </span>
            <Tag className="h-3 w-3 text-success shrink-0" />
          </>
        )}
      </div>
      <div className="col-span-2">
        {item.track_stock ? (
          <span className={cn(
            "text-[10px] tabular-nums",
            isOut ? "text-destructive" : isLow ? "text-warning" : "text-muted-foreground/60"
          )}>
            {isOut ? "Out of stock" : `${stock} left`}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/30">—</span>
        )}
      </div>
      <div className="col-span-1 flex justify-end">
        <div className={cn(
          "h-6 w-6 rounded-md border flex items-center justify-center transition-all duration-100",
          "border-transparent text-transparent",
          !isOut && "group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary",
        )}>
          <Plus className="h-3 w-3" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CartItemRow
// ─────────────────────────────────────────────────────────────────────────────
function CartItemRow({ item, onRemove, onSetQty }) {
  const lineTotal = Math.max(0, item.price * item.quantity - (item.discount ?? 0));

  return (
    <div className="group flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 hover:border-border/60 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-foreground truncate leading-snug">
          {item.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {formatCurrency(item.price)}
          </span>
          {item.hasDiscount && (
            <>
              <span className="text-[10px] text-muted-foreground/40 line-through tabular-nums">
                {formatCurrency(item.originalPrice)}
              </span>
              <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold text-success leading-none">DISC</span>
            </>
          )}
          {item.categoryName && (
            <span className="text-[10px] text-muted-foreground/40">· {item.categoryName}</span>
          )}
        </div>
      </div>

      {/* Qty controls */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => onSetQty(item.itemId, item.quantity - 1)}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
        >
          <Minus className="h-2.5 w-2.5" />
        </button>
        <Input
          type="number"
          value={item.quantity}
          onChange={(e) => onSetQty(item.itemId, parseFloat(e.target.value) || 0)}
          onFocus={(e) => e.target.select()}
          className="h-6 w-14 text-center text-[12px] px-1 tabular-nums font-mono border-border bg-background/50"
          min="0"
          step="1"
        />
        <button
          onClick={() => onSetQty(item.itemId, item.quantity + 1)}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
        >
          <Plus className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Line total */}
      <div className="shrink-0 w-[76px] text-right">
        <p className="text-[13px] font-bold text-foreground tabular-nums font-mono">
          {formatCurrency(lineTotal)}
        </p>
      </div>

      {/* Remove */}
      <button
        onClick={() => onRemove(item.itemId)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-destructive/30 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
        title="Remove item"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BottomBar
// ─────────────────────────────────────────────────────────────────────────────
function BottomBar({
  cartItems, payments, popover, setPopover,
  onPaymentClick, onPaymentSubmit, onRemovePayment,
  onHold, onClear, onCharge,
  activeCustomer, onCustomerClick,
  subtotal, tax, discountAmt, grossSubtotal, total,
  totalPaid, remaining, change, amountDue,
  isBalanced, isCharging,
}) {
  const hasCart = cartItems.length > 0;
  const popCfg  = popover.type ? PM_CONFIG[popover.type] : null;
  const PopIcon = popCfg?.Icon;

  const customerName = activeCustomer
    ? [activeCustomer.first_name, activeCustomer.last_name].filter(Boolean).join(" ") || activeCustomer.name || "Customer"
    : "Walk-in";

  return (
    <div className="shrink-0 border-t border-border bg-card shadow-[0_-6px_32px_rgba(0,0,0,0.4)]">
      <div className="flex items-stretch">

        {/* ── ZONE 1: Payment method buttons ──────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-3">
          <Popover
            open={popover.open}
            onOpenChange={(v) => !v && setPopover({ open: false, type: null, amount: "" })}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline" size="sm"
                disabled={!hasCart}
                onClick={() => onPaymentClick(PAYMENT_METHODS.CASH)}
                className={cn("h-10 gap-1.5 text-[12px] font-semibold transition-all", PM_CONFIG[PAYMENT_METHODS.CASH].btnCls, "disabled:opacity-30")}
              >
                <Banknote className="h-4 w-4" /> Cash
              </Button>
            </PopoverTrigger>

            {/* Card + Transfer + Credit outside trigger — same controlled popover */}
            {[
              [PAYMENT_METHODS.CARD,     CreditCard, "Card"],
              [PAYMENT_METHODS.TRANSFER, Smartphone, "Transfer"],
              [PAYMENT_METHODS.CREDIT,   Receipt,    "Credit"],
            ].map(([method, Icon, label]) => (
              <Button
                key={method}
                variant="outline" size="sm"
                disabled={!hasCart}
                onClick={() => onPaymentClick(method)}
                className={cn("h-10 gap-1.5 text-[12px] font-semibold transition-all", PM_CONFIG[method].btnCls, "disabled:opacity-30")}
              >
                <Icon className="h-4 w-4" /> {label}
              </Button>
            ))}

            {/* Amount entry popover */}
            <PopoverContent
              side="top" align="start" sideOffset={10}
              className="w-72 p-4 bg-card border-border/80 shadow-2xl shadow-black/70"
            >
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {PopIcon && (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                      <PopIcon className="h-4 w-4 text-foreground" />
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-bold text-foreground leading-tight">
                      {popCfg?.label ?? ""} Payment
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                      Balance:{" "}
                      <span className={cn(
                        "font-semibold tabular-nums font-mono",
                        remaining > 0.01 ? "text-warning" : "text-success"
                      )}>
                        {formatCurrency(Math.max(0, remaining))}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₦</span>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={popover.amount}
                    onChange={(e) => setPopover((p) => ({ ...p, amount: e.target.value }))}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => e.key === "Enter" && onPaymentSubmit()}
                    className="pl-7 h-12 font-mono tabular-nums text-base bg-background/60 border-border"
                    autoFocus
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm" className="flex-1"
                    onClick={() => setPopover({ open: false, type: null, amount: "" })}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm" className="flex-1"
                    disabled={!popover.amount || parseFloat(popover.amount) <= 0}
                    onClick={onPaymentSubmit}
                  >
                    Add Payment
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="w-px bg-border my-2" />

        {/* ── ZONE 2: Hold · Cancel · Charge ──────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-3">
          <Button
            variant="ghost" size="sm"
            disabled={!hasCart}
            onClick={onHold}
            className="h-10 gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <Clock className="h-3.5 w-3.5" /> Hold
          </Button>

          <Button
            variant="outline-destructive" size="sm"
            disabled={!hasCart}
            onClick={onClear}
            className="h-10 text-[12px]"
          >
            Cancel
          </Button>

          <Button
            variant="success"
            size="lg"
            disabled={!isBalanced || isCharging}
            onClick={onCharge}
            className={cn(
              "h-10 px-6 text-[13px] font-bold gap-1.5 transition-all",
              isBalanced && !isCharging ? "shadow-lg shadow-success/20" : "opacity-40 cursor-not-allowed"
            )}
          >
            {isCharging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              isBalanced && <CheckCircle2 className="h-4 w-4" />
            )}
            {isCharging ? "Processing…" : "Charge"}
          </Button>
        </div>

        {/* ── ZONE 3: Summary ─────────────────────────────────────── */}
        <div className="ml-auto border-l border-border px-5 py-3 w-[300px] shrink-0 flex flex-col justify-center">
          <div className="space-y-0.5 text-[11px]">

            {/* Customer — clickable */}
            <button
              onClick={onCustomerClick}
              className="flex items-center justify-between w-full py-0.5 group"
              title="Change customer"
            >
              <span className="flex items-center gap-1 text-muted-foreground group-hover:text-foreground transition-colors">
                <User className="h-3 w-3" /> Customer
              </span>
              <span className={cn(
                "flex items-center gap-1 font-medium transition-colors group-hover:text-primary",
                activeCustomer ? "text-primary" : "text-foreground"
              )}>
                {customerName}
                <ChevronDown className="h-2.5 w-2.5 opacity-50" />
              </span>
            </button>

            {/* Items qty */}
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground">Items</span>
              <span className="font-semibold tabular-nums text-foreground">
                {cartItems.length}
                <span className="text-muted-foreground font-normal ml-1">
                  ({cartItems.reduce((s, i) => s + i.quantity, 0)} qty)
                </span>
              </span>
            </div>

            {/* Payment entries */}
            {payments.map((p) => {
              const cfg  = PM_CONFIG[p.type] ?? PM_CONFIG[PAYMENT_METHODS.CASH];
              const Icon = cfg.Icon;
              return (
                <div key={p.id} className="flex items-center justify-between py-0.5">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dotCls)} />
                    <Icon className="h-3 w-3" />
                    {cfg.label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold tabular-nums font-mono text-foreground">
                      {formatCurrency(p.amount)}
                    </span>
                    <button
                      onClick={() => onRemovePayment(p.id)}
                      className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="!my-1.5 border-t border-border/50" />

            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold tabular-nums font-mono text-foreground">
                {formatCurrency(grossSubtotal)}
              </span>
            </div>

            {discountAmt > 0 && (
              <div className="flex items-center justify-between py-0.5">
                <span className="text-success">Discount</span>
                <span className="font-semibold tabular-nums font-mono text-success">
                  −{formatCurrency(discountAmt)}
                </span>
              </div>
            )}

            {tax > 0.001 && (
              <div className="flex items-center justify-between py-0.5">
                <span className="text-muted-foreground">Tax (VAT)</span>
                <span className="font-semibold tabular-nums font-mono text-muted-foreground">
                  +{formatCurrency(tax)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between py-1.5 border-t border-border/30 mt-0.5">
              <span className="text-[13px] font-bold text-foreground">Total</span>
              <span className="text-[14px] font-bold tabular-nums font-mono text-foreground">
                {formatCurrency(total)}
              </span>
            </div>

            {amountDue > 0.01 && (
              <div className="flex items-center justify-between py-0.5">
                <span className="font-bold text-destructive">Amount Due</span>
                <span className="font-bold tabular-nums font-mono text-destructive">
                  {formatCurrency(amountDue)}
                </span>
              </div>
            )}

            {change > 0.01 && (
              <div className="flex items-center justify-between py-0.5">
                <span className="font-bold text-success">Change</span>
                <span className="font-bold tabular-nums font-mono text-success">
                  {formatCurrency(change)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
