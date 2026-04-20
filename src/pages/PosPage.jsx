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
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ShoppingCart, Package, Search, Filter,
  Grid3X3, List, Plus, Minus, Trash2,
  Banknote, CreditCard, Smartphone, Receipt,
  ArrowLeft, ArrowRight, Clock, X, User,
  Tag, CheckCircle2, Loader2, ChevronDown,
  Wallet, Star, Lock, Scale, RefreshCw, Copy,
} from "lucide-react";

import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Badge }    from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger, PopoverAnchor,
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
import { useFavourites }        from "@/features/pos/useFavourites";
import { HoldDrawer }           from "@/features/pos/HoldDrawer";
import { CustomerSearchBar }    from "@/features/pos/CustomerSearchBar";
import { ReceiptModal }         from "@/features/pos/ReceiptModal";
import { deleteHeldTransaction } from "@/commands/transactions";
import { getWalletBalance }     from "@/commands/customer_wallet";
import { getLoyaltyBalance, getLoyaltySettings } from "@/commands/loyalty";
import { getStoreSettings }     from "@/commands/store_settings";
import { getPaymentMethods }    from "@/commands/payment_methods";

import { formatCurrency, formatName }  from "@/lib/format";
import { getAutoLockMinutes }          from "@/features/settings/security-utils";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, isActiveShiftStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 20;

// ── Auto-reference generator ──────────────────────────────────────────────────
// Format: {STORE_3_LETTER_PREFIX}-{YYYYMMDD}-{4-digit-random}
// e.g.  QUA-20250417-3842  (store = "Quantum POS")
function generatePaymentRef(storeName = "") {
  const prefix = storeName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .substring(0, 3)
    .padEnd(3, "X");
  const now  = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${date}-${rand}`;
}

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
  [PAYMENT_METHODS.MOBILE_MONEY]: {
    label:    "Mobile Money",
    Icon:     Smartphone,
    btnCls:   "border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500",
    badgeCls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
    dotCls:   "bg-cyan-400",
  },
  [PAYMENT_METHODS.CREDIT]: {
    label:    "Credit",
    Icon:     Receipt,
    btnCls:   "border-rose-500/50 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500",
    badgeCls: "bg-rose-500/15 text-rose-400 border-rose-500/20",
    dotCls:   "bg-rose-400",
  },
  [PAYMENT_METHODS.WALLET]: {
    label:    "Wallet",
    Icon:     Wallet,
    btnCls:   "border-violet-500/50 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500",
    badgeCls: "bg-violet-500/15 text-violet-400 border-violet-500/20",
    dotCls:   "bg-violet-400",
  },
  [PAYMENT_METHODS.LOYALTY]: {
    label:    "Loyalty",
    Icon:     Star,
    btnCls:   "border-amber-500/50 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500",
    badgeCls: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    dotCls:   "bg-amber-400",
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
  const navigate    = useNavigate();
  const storeId     = useBranchStore((s) => s.activeStore?.id);
  const storeName   = useBranchStore((s) => s.activeStore?.store_name);
  const user        = useAuthStore((s) => s.user);
  const isPosLocked = useAuthStore((s) => s.isPosLocked);
  const lockPos     = useAuthStore((s) => s.lockPos);
  const unlockPos   = useAuthStore((s) => s.unlockPos);
  const activeShift      = useShiftStore((s) => s.activeShift);
  const isShiftInitialized = useShiftStore((s) => s.isInitialized);
  // Use isActiveShiftStatus so "active" and "suspended" shifts are also
  // recognised — the status moves from "open" → "active" after the first sale.
  const isShiftOpen = isActiveShiftStatus(activeShift?.status);

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

  // ── Wallet + loyalty queries (live when customer is selected) ──────────────
  const customerId = activeCustomer?.id ?? null;

  const { data: walletData } = useQuery({
    queryKey: ["wallet-balance", customerId],
    queryFn:  () => getWalletBalance(customerId),
    enabled:  !!customerId,
    staleTime: 60_000,
  });
  const walletBalance = parseFloat(walletData?.balance ?? 0);

  const { data: loyaltyData } = useQuery({
    queryKey: ["loyalty-balance", customerId, storeId],
    queryFn:  () => getLoyaltyBalance(customerId, storeId),
    enabled:  !!customerId && !!storeId,
    staleTime: 60_000,
  });
  const loyaltyPoints = parseInt(loyaltyData?.points      ?? 0, 10);
  const loyaltyNaira  = parseFloat(loyaltyData?.naira_value ?? 0);

  // Whether the store's loyalty programme is active.
  // getLoyaltyBalance now includes programme_active, but we also query
  // loyalty settings directly so the button state is correct even before
  // a customer is selected (avoids the button appearing enabled when the
  // programme has never been turned on).
  const { data: loyaltySettings } = useQuery({
    queryKey: ["loyalty-settings", storeId],
    queryFn:  () => getLoyaltySettings(storeId),
    enabled:  !!storeId,
    staleTime: 5 * 60_000,
  });
  const loyaltyProgrammeActive = loyaltySettings?.is_active ?? false;

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
  const [creditLimitError,  setCreditLimitError]  = useState(null); // { available, required, customerName }

  // ── Weigh modal state ─────────────────────────────────────────────────────
  // weighModal.item: the full enriched item being weighed (null = closed)
  // weighModal.qty:  the string the cashier types into the input
  const [weighModal, setWeighModal] = useState({ item: null, qty: "" });

  // ── Payment state ─────────────────────────────────────────────────────────
  const [payments, setPayments] = useState([]);
  const [popover,  setPopover]  = useState({ open: false, type: null, amount: "", reference: "", requireReference: false, referenceLabel: "Reference No.", label: "" });

  // ── Load held transactions on mount / store change ────────────────────────
  useEffect(() => {
    if (storeId) loadHeld(storeId);
  }, [storeId, loadHeld]);

  // ── Auto-lock on inactivity ───────────────────────────────────────────────
  // Reads timeout (minutes) from localStorage key "qpos_lock_timeout_min".
  // 0 or missing = disabled. Cleans up all listeners when the screen locks
  // so the timer doesn't keep firing behind the PIN overlay.
  useEffect(() => {
    if (isPosLocked) return; // already locked — don't arm a second timer
    const minutes = getAutoLockMinutes();
    if (!minutes || minutes <= 0) return; // 0 = disabled

    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => lockPos(), minutes * 60_000);
    };

    const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart"];
    EVENTS.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset(); // arm immediately

    return () => {
      clearTimeout(timer);
      EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [lockPos, isPosLocked]);

  // ── Store settings (tax_inclusive + quick-access config) ─────────────────
  const { data: storeSettings } = useQuery({
    queryKey: ["store-settings", storeId],
    queryFn:  () => getStoreSettings(storeId),
    enabled:  !!storeId,
    staleTime: 5 * 60_000,
  });
  const taxInclusive = storeSettings?.tax_inclusive ?? true;

  // ── Payment methods (store-configured via Settings → Payment Methods) ─────
  const { data: paymentMethodSettings = [] } = useQuery({
    queryKey:  ["payment-methods", storeId],
    queryFn:   () => getPaymentMethods(storeId),
    enabled:   !!storeId,
    staleTime: 5 * 60_000,
  });
  // Wallet & Loyalty are system buttons handled separately — exclude them here.
  const configuredMethods = useMemo(
    () => paymentMethodSettings.filter((m) => m.is_enabled).sort((a, b) => a.sort_order - b.sort_order),
    [paymentMethodSettings],
  );

  // ── Quick-access favourites (DB per store) ───────────────────────────────
  const {
    favourites,
    isPinned:  isFavPinned,
    pinItem:   pinFavItem,
    unpinItem: unpinFavItem,
  } = useFavourites();

  const pinItem   = useCallback((item)   => pinFavItem(item.id),   [pinFavItem]);
  const unpinItem = useCallback((itemId) => unpinFavItem(itemId),  [unpinFavItem]);
  const isPinned  = useCallback((item)   => isFavPinned(item.id),  [isFavPinned]);

  // ── POS data hook ─────────────────────────────────────────────────────────
  const { items, itemsTotal, totalPages, itemsLoading, categories, charge, lookupBarcode } = usePos({
    search: debSearch,
    catId,
    page:   currentPage,
    limit:  ITEMS_PER_PAGE,
  });

  // ── Debounce search → barcode detection → reset page ────────────────────
  // Barcode scanners fire the full code in ~50ms then implicitly "submit".
  // Pattern: 6-30 chars, only digits/letters/hyphens, no spaces — distinct
  // from freeform text which is shorter and typed slowly.
  const BARCODE_RE = /^[A-Za-z0-9-]{6,30}$/;

  useEffect(() => {
    if (!searchTerm) { setDebSearch(""); return; }

    // Short delay — barcode scanners finish in <100ms; humans type slower.
    const t = setTimeout(async () => {
      if (BARCODE_RE.test(searchTerm.trim())) {
        // Looks like a barcode: exact lookup, then add and clear search.
        try {
          const item = await lookupBarcode(searchTerm.trim());
          if (item) {
            handleAddToCart(item);
            setSearchTerm("");
            setDebSearch("");
            return;
          }
        } catch {
          // Fall through to normal text search if barcode lookup fails.
        }
      }
      setDebSearch(searchTerm);
      setCurrentPage(1);
    }, 120); // tighter than typing debounce — scanner fires all chars at once

    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  useEffect(() => { setCurrentPage(1); }, [catId]);

  // ── Totals ────────────────────────────────────────────────────────────────
  const { subtotal, tax, discountAmt, total } = useMemo(
    () => calcCartTotals(cartItems, cartDiscount, cartDiscountPct, taxInclusive),
    [cartItems, cartDiscount, cartDiscountPct, taxInclusive],
  );

  // Loyalty applied as a pre-payment reduction
  const loyaltyEntry        = payments.find((p) => p.type === PAYMENT_METHODS.LOYALTY);
  const loyaltyNairaApplied = loyaltyEntry?.amount ?? 0;
  const effectiveTotal      = Math.max(0, total - loyaltyNairaApplied);

  const totalPaid = useMemo(
    () => payments.filter((p) => p.type !== PAYMENT_METHODS.LOYALTY).reduce((s, p) => s + p.amount, 0),
    [payments],
  );
  const remaining  = effectiveTotal - totalPaid;
  const change     = remaining < -0.01 ? Math.abs(remaining) : 0;
  const amountDue  = remaining >  0.01 ? remaining : 0;
  const realPaymentCount = payments.filter((p) => p.type !== PAYMENT_METHODS.LOYALTY).length;
  // Any weighted cart line with qty ≤ 0 means the cashier hasn't entered a weight yet.
  const hasUnweighedItems = cartItems.some(
    (ci) => ci.measurementType === "weight" && (ci.quantity == null || ci.quantity <= 0)
  );
  const isBalanced = isShiftOpen && cartItems.length > 0 && realPaymentCount > 0 && Math.abs(remaining) <= 0.01 && !hasUnweighedItems;

  // Auto-adjust last REAL payment entry when effective total changes
  useEffect(() => {
    const realPayments = payments.filter((p) => p.type !== PAYMENT_METHODS.LOYALTY);
    if (realPayments.length === 0) return;
    setPayments((prev) => {
      const loyalty = prev.filter((p) => p.type === PAYMENT_METHODS.LOYALTY);
      const real    = prev.filter((p) => p.type !== PAYMENT_METHODS.LOYALTY);
      if (real.length === 1) return [...loyalty, { ...real[0], amount: effectiveTotal }];
      const othersTotal = real.slice(0, -1).reduce((s, p) => s + p.amount, 0);
      const adjusted    = Math.max(0, effectiveTotal - othersTotal);
      return [...loyalty, ...real.slice(0, -1), { ...real[real.length - 1], amount: adjusted }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTotal]);

  // ── Cart action handlers ──────────────────────────────────────────────────
  const handleAddToCart = useCallback((item) => {
    const effectivePrice = item.discount_price_enabled && item.discount_price
      ? parseFloat(item.discount_price)
      : parseFloat(item.selling_price);

    const measurementType = item.measurement_type ?? "quantity";
    const unitLabel = item.unit_type ?? "unit";

    // Items that require weighing: open the weight modal instead of adding directly.
    if (measurementType === "weight" && item.requires_weight) {
      setWeighModal({
        item: {
          itemId:        item.id,
          sku:           item.sku ?? "",
          name:          item.item_name,
          price:         effectivePrice,
          originalPrice: parseFloat(item.selling_price),
          hasDiscount:   !!item.discount_price_enabled && !!item.discount_price && parseFloat(item.discount_price) < parseFloat(item.selling_price),
          taxRate:       item.taxable ? parseFloat(item.tax_rate ?? "7.5") : 0,
          unitLabel,
          measurementType,
          categoryName:  item.category_name ?? "",
        },
        qty: "",
      });
      return;
    }

    // Regular add: weight items without requires_weight start at 0 so
    // the cashier can manually enter the weight; quantity items start at 1.
    const initialQty = measurementType === "weight" ? 0 : 1;

    // Check if item already exists in cart to give feedback
    const existing = cartItems.find((ci) => ci.itemId === item.id);
    if (existing && measurementType !== "weight") {
      const newQty = existing.quantity + initialQty;
      toast(`${item.item_name} — qty updated to ${newQty}`, { duration: 1500 });
    }

    addItem({
      itemId:        item.id,
      sku:           item.sku ?? "",
      name:          item.item_name,
      price:         effectivePrice,
      originalPrice: parseFloat(item.selling_price),
      hasDiscount:   !!item.discount_price_enabled && !!item.discount_price && parseFloat(item.discount_price) < parseFloat(item.selling_price),
      quantity:      initialQty,
      taxRate:       item.taxable ? parseFloat(item.tax_rate ?? "7.5") : 0,
      discount:      0,
      unit:          unitLabel,
      measurementType,
      categoryName:  item.category_name ?? "",
    });
  }, [addItem, cartItems]);

  // ── Weigh modal handlers ─────────────────────────────────────────────────────
  const handleWeighConfirm = useCallback(() => {
    const weight = parseFloat(weighModal.qty);
    if (!weight || weight <= 0) {
      toast.error("Please enter a valid weight greater than zero.");
      return;
    }
    const mi = weighModal.item;
    addItem({
      itemId:        mi.itemId,
      sku:           mi.sku,
      name:          mi.name,
      price:         mi.price,
      originalPrice: mi.originalPrice,
      hasDiscount:   mi.hasDiscount,
      quantity:      weight,
      taxRate:       mi.taxRate,
      discount:      0,
      unit:          mi.unitLabel,
      measurementType: "weight",
      categoryName:  mi.categoryName,
    });
    setWeighModal({ item: null, qty: "" });
  }, [weighModal, addItem]);

  const handleWeighCancel = useCallback(() => {
    setWeighModal({ item: null, qty: "" });
  }, []);

  const handleClearCart = useCallback(() => {
    clearCart();
    setPayments([]);
  }, [clearCart]);

  // ── Wallet pay ────────────────────────────────────────────────────────────
  const handleWalletPay = useCallback(() => {
    if (!activeCustomer) {
      toast.error("Select a customer to use their wallet.");
      setShowCustomerSearch(true);
      return;
    }
    if (walletBalance <= 0) {
      toast.error("Customer wallet balance is ₦0.");
      return;
    }
    if (payments.find((p) => p.type === PAYMENT_METHODS.WALLET)) {
      toast("Wallet payment already added.");
      return;
    }
    const amount = Math.min(walletBalance, Math.max(0, remaining));
    if (amount <= 0) return;
    setPayments((prev) => [...prev, { id: Date.now(), type: PAYMENT_METHODS.WALLET, amount }]);
  }, [activeCustomer, walletBalance, remaining, payments]);

  // ── Loyalty toggle ────────────────────────────────────────────────────────
  const handleLoyaltyToggle = useCallback(() => {
    if (!activeCustomer) {
      toast.error("Select a customer to redeem loyalty points.");
      setShowCustomerSearch(true);
      return;
    }
    if (loyaltyPoints <= 0) {
      toast.error("Customer has no redeemable loyalty points.");
      return;
    }
    const alreadyOn = !!payments.find((p) => p.type === PAYMENT_METHODS.LOYALTY);
    if (alreadyOn) {
      setPayments((prev) => prev.filter((p) => p.type !== PAYMENT_METHODS.LOYALTY));
    } else {
      setPayments((prev) => [...prev, {
        id:            Date.now(),
        type:          PAYMENT_METHODS.LOYALTY,
        amount:        Math.min(loyaltyNaira, total),
        loyaltyPoints,
      }]);
    }
  }, [activeCustomer, loyaltyPoints, loyaltyNaira, total, payments]);

  // ── Payment handlers ──────────────────────────────────────────────────────
  const handlePaymentClick = useCallback((type, opts = {}) => {
    // Credit requires a customer
    if (type === PAYMENT_METHODS.CREDIT && !activeCustomer) {
      toast.error("Select a customer before adding a credit payment");
      setShowCustomerSearch(true);
      return;
    }
    const rem = Math.max(0, remaining);
    // Auto-generate reference immediately when the method requires one.
    // Cashiers never type references manually — the system produces them.
    const autoRef = opts.requireReference ? generatePaymentRef(storeName) : "";
    setPopover({
      open: true, type,
      amount:           rem > 0 ? rem.toFixed(2) : "",
      reference:        autoRef,
      requireReference: opts.requireReference || false,
      referenceLabel:   opts.referenceLabel   || "Reference No.",
      label:            opts.label            || PM_CONFIG[type]?.label || type,
    });
  }, [remaining, activeCustomer, storeName]);

  const handlePaymentSubmit = useCallback(() => {
    const amount = parseFloat(popover.amount);
    if (!isNaN(amount) && amount > 0) {
      setPayments((prev) => [...prev, {
        id: Date.now(), type: popover.type, amount,
        ...(popover.reference ? { reference: popover.reference } : {}),
      }]);
    }
    setPopover({ open: false, type: null, amount: "", reference: "", requireReference: false, referenceLabel: "Reference No.", label: "" });
  }, [popover]);

  const handleRemovePayment = useCallback((id) => {
    setPayments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ── Charge ────────────────────────────────────────────────────────────────
  const handleCharge = useCallback(async () => {
    if (!isBalanced || isCharging) return;
    setIsCharging(true);
    try {
      const loyaltyEntry = payments.find((p) => p.type === PAYMENT_METHODS.LOYALTY);
      const result = await charge({
        cartItems,
        payments,
        discountAmt,
        customer: activeCustomer,
        note,
        heldTxId,
        loyaltyPointsRedeemed: loyaltyEntry?.loyaltyPoints ?? null,
      });
      setLastTransaction(result);
      setShowReceipt(true);
      clearCart();
      setPayments([]);
      // Refresh held transactions (heldTxId was just deleted by backend)
      if (storeId) loadHeld(storeId);
    } catch (err) {
      const msg = typeof err === "string" ? err : (err?.message ?? "Transaction failed. Please try again.");
      // Credit-limit errors get a dedicated dialog instead of a toast so the
      // cashier can clearly see available vs. required amounts.
      const creditMatch = msg.match(/Insufficient credit\.\s*Available:\s*[₦]?([\d,.]+),\s*Required:\s*[₦]?([\d,.]+)/i);
      if (creditMatch) {
        const parse = (s) => parseFloat(s.replace(/,/g, ""));
        setCreditLimitError({
          available:    parse(creditMatch[1]),
          required:     parse(creditMatch[2]),
          customerName: activeCustomer
            ? [activeCustomer.first_name, activeCustomer.last_name].filter(Boolean).join(" ") || "this customer"
            : "this customer",
        });
      } else {
        toast.error(msg);
      }
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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // F1 = Cash · F2 = Card · F3 = Transfer · F10 = Charge · Escape = cancel
  // Any alphanumeric key (no modifier) when not in an input → focus search.
  useEffect(() => {
    const inInput = () => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
    const modalOpen = () => showReceipt || showHoldDrawer || showCustomerSearch || !!weighModal.item;

    const onKey = (e) => {
      // Escape: close popover first, then blur search
      if (e.key === "Escape") {
        if (popover.open) {
          e.preventDefault();
          setPopover({ open: false, type: null, amount: "" });
          return;
        }
        if (inInput()) {
          document.activeElement.blur();
          return;
        }
        return;
      }

      // Skip all other shortcuts when a modal is open or modifier key held
      if (modalOpen() || e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === "F1") { e.preventDefault(); handlePaymentClick(PAYMENT_METHODS.CASH);     return; }
      if (e.key === "F2") { e.preventDefault(); handlePaymentClick(PAYMENT_METHODS.CARD);     return; }
      if (e.key === "F3") { e.preventDefault(); handlePaymentClick(PAYMENT_METHODS.TRANSFER); return; }
      if (e.key === "F10") {
        e.preventDefault();
        if (isBalanced && !isCharging) handleCharge();
        return;
      }

      // Alphanumeric → focus product search
      if (/^[a-zA-Z0-9]$/.test(e.key) && !inInput()) {
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popover.open, showReceipt, showHoldDrawer, showCustomerSearch, weighModal.item,
      isBalanced, isCharging, handlePaymentClick, handleCharge]);

  // ── Shift guard ───────────────────────────────────────────────────────────
  // Show a spinner while the shift store is still initialising (async fetch
  // after login). Without this check, activeShift=null during init would
  // show a false "No Active Shift" screen for ~300 ms on every page load.
  if (!isShiftInitialized) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  if (!isShiftOpen) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-6 text-center py-20">
        <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-border/60 bg-card/80 shadow-inner">
          <Clock className="h-10 w-10 text-muted-foreground/25" />
        </div>
        <div className="space-y-2 max-w-xs">
          <p className="text-base font-bold text-foreground">No Active Shift</p>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            You need to open a shift before you can process sales. Go to the Shifts page and click "Open Shift".
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/shifts")}>
          <Clock className="h-3.5 w-3.5" />Go to Shifts
        </Button>
      </div>
    );
  }

  // grossSubtotal = line totals BEFORE cart discount (subtotal is already pre-discount)
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

            {/* Lock POS button */}
            <button
              onClick={lockPos}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
              title="Lock POS screen"
            >
              <Lock className="h-3 w-3" /> Lock
            </button>

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

          {/* Quick-access panel */}
          {favourites.length > 0 && (
            <div className="shrink-0 border-b border-border bg-muted/10">
              <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                <Star className="h-3 w-3 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quick Access</span>
              </div>
              <div className="flex gap-2 overflow-x-auto px-3 pb-2 scrollbar-none">
                {favourites.map((fav) => {
                  const favPrice = fav.discount_price_enabled && fav.discount_price
                    ? parseFloat(fav.discount_price)
                    : parseFloat(fav.selling_price ?? "0");
                  return (
                    <button
                      key={fav.id}
                      type="button"
                      onClick={() => handleAddToCart(fav)}
                      className="relative flex-shrink-0 flex flex-col gap-0.5 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 active:scale-95 transition-all duration-100 px-3 py-2 text-left min-w-[90px] max-w-[120px]"
                    >
                      <span className="text-[11px] font-semibold text-foreground truncate w-full">{fav.item_name}</span>
                      <span className="text-[10px] font-mono text-amber-400 tabular-nums">{formatCurrency(favPrice)}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); unpinItem(fav.id); }}
                        className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted border border-border/60 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remove from quick access"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
                  <ItemCard
                    key={item.id}
                    item={item}
                    onAdd={handleAddToCart}
                    pinned={isPinned(item)}
                    onPin={() => pinItem(item)}
                    onUnpin={() => unpinItem(item.id)}
                  />
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
                    pinned={isPinned(item)}
                    onPin={() => pinItem(item)}
                    onUnpin={() => unpinItem(item.id)}
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
                  taxInclusive={taxInclusive}
                />
              ))}
            </div>
          )}

          {/* Cart discount input (shown when cart has items) */}
          {cartItems.length > 0 && (
            <div className="px-3 py-2 border-t border-border/40 bg-muted/10 shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 shrink-0">
                  <Tag className="h-3 w-3 text-success/70" />
                  <span className="text-[10px] font-semibold text-muted-foreground">Discount</span>
                </div>
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-bold">₦</span>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={cartDiscount > 0 ? cartDiscount : ""}
                    onChange={(e) => setCartDiscount(parseFloat(e.target.value) || 0)}
                    className="h-7 text-[11px] bg-background/60 border-border/50 pl-5 pr-2 font-mono"
                    min="0"
                    step="0.01"
                  />
                </div>
                {cartDiscount > 0 && (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="rounded-full bg-success/15 border border-success/25 px-1.5 py-0.5 text-[9px] font-bold text-success leading-none tabular-nums">
                      -{formatCurrency(cartDiscount)}
                    </span>
                    <button
                      onClick={() => setCartDiscount(0)}
                      className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
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
        walletBalance={walletBalance}
        loyaltyPoints={loyaltyPoints}
        loyaltyNaira={loyaltyNaira}
        loyaltyProgrammeActive={loyaltyProgrammeActive}
        loyaltyApplied={!!payments.find((p) => p.type === PAYMENT_METHODS.LOYALTY)}
        onWalletPay={handleWalletPay}
        onLoyaltyToggle={handleLoyaltyToggle}
        taxInclusive={taxInclusive}
        configuredMethods={configuredMethods}
        storeName={storeName ?? ""}
      />

      {/* POS lock overlay is rendered globally in App.jsx */}

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

      {/* ── Weigh Item Modal ──────────────────────────────────────────────── */}
      <WeighItemModal
        item={weighModal.item}
        qty={weighModal.qty}
        onQtyChange={(v) => setWeighModal((s) => ({ ...s, qty: v }))}
        onConfirm={handleWeighConfirm}
        onCancel={handleWeighCancel}
      />

      <CreditLimitDialog
        error={creditLimitError}
        onClose={() => setCreditLimitError(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ItemCard — grid tile
// ─────────────────────────────────────────────────────────────────────────────
function ItemCard({ item, onAdd, pinned, onPin, onUnpin }) {
  const origPrice   = parseFloat(item.selling_price ?? "0");
  const hasDiscount = !!item.discount_price_enabled && !!item.discount_price && parseFloat(item.discount_price) < origPrice;
  const price       = hasDiscount ? parseFloat(item.discount_price) : origPrice;
  const stock       = parseFloat(item.available_quantity ?? "0");
  const unitLabel   = item.unit_type ?? null;
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
          : "cursor-pointer border-border/70 bg-card hover:border-primary/50 hover:shadow-xl hover:shadow-black/40 hover:bg-card/80 active:scale-[0.97]"
      )}
    >
      {/* Image / letter avatar header */}
      <div className={cn(
        "relative flex items-center justify-center w-full border-b border-border/20 overflow-hidden",
        item.image_data ? "h-[100px]" : "h-[56px] text-[24px] font-bold leading-none",
        !item.image_data && avatarCls(item.item_name),
      )}>
        {item.image_data ? (
          <img
            src={item.image_data}
            alt={item.item_name}
            className="h-full w-full object-contain bg-muted/20"
          />
        ) : (
          (item.item_name ?? "?").charAt(0).toUpperCase()
        )}
        {/* Discount badge */}
        {hasDiscount && (
          <div className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-success/25 border border-success/30">
            <Tag className="h-2.5 w-2.5 text-success" />
          </div>
        )}
        {/* Pin / Quick-access button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); pinned ? onUnpin() : onPin(); }}
          className={cn(
            "absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-150",
            pinned
              ? "bg-amber-500/25 border-amber-500/40 opacity-100"
              : "bg-black/20 border-transparent opacity-0 group-hover:opacity-100"
          )}
          title={pinned ? "Remove from Quick Access" : "Add to Quick Access"}
        >
          <Star className={cn("h-2.5 w-2.5", pinned ? "text-amber-400 fill-amber-400" : "text-white")} />
        </button>
      </div>

      <div className="px-2.5 pt-2 pb-2.5 flex flex-col gap-1 flex-1">
        <p className="text-[11px] font-semibold text-foreground leading-snug line-clamp-2 min-h-[2.4em]">
          {item.item_name}
        </p>
        {item.category_name && (
          <p className="text-[9px] text-muted-foreground/50 truncate -mt-0.5">{item.category_name}</p>
        )}
        <div className="flex items-end justify-between gap-1 mt-auto pt-1">
          <div>
            <p className="text-[13px] font-bold text-foreground tabular-nums leading-none">
              {formatCurrency(price)}
            </p>
            {hasDiscount && (
              <p className="text-[10px] text-muted-foreground/40 line-through tabular-nums mt-0.5">
                {formatCurrency(origPrice)}
              </p>
            )}
          </div>
          {isTracked && (
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none shrink-0 border",
              isOut ? "bg-destructive/10 text-destructive border-destructive/20" :
              isLow ? "bg-warning/10 text-warning border-warning/20"             :
                      "bg-muted/60 text-muted-foreground border-border/40"
            )}>
              {isOut ? "Out" : unitLabel ? `${stock} ${unitLabel}` : stock}
            </span>
          )}
        </div>
      </div>

      {/* Hover overlay with + button */}
      {!isOut && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-primary/[0.03]">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/50 border border-primary/40">
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
function ItemRow({ item, index, onAdd, pinned, onPin, onUnpin }) {
  const origPrice   = parseFloat(item.selling_price ?? "0");
  const hasDiscount = !!item.discount_price_enabled && !!item.discount_price && parseFloat(item.discount_price) < origPrice;
  const price       = hasDiscount ? parseFloat(item.discount_price) : origPrice;
  const stock       = parseFloat(item.available_quantity ?? "0");
  const unitLabel   = item.unit_type ?? null;
  const isOut       = item.track_stock && stock <= 0;
  const isLow       = item.track_stock && !isOut && stock <= (item.min_stock_level ?? 5);

  return (
    <div
      onClick={() => !isOut && onAdd(item)}
      className={cn(
        "grid grid-cols-12 items-center gap-2 px-4 py-2 group transition-colors duration-100 select-none",
        isOut ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-primary/[0.04] active:bg-muted/40"
      )}
    >
      <div className="col-span-1">
        <span className="text-[10px] text-muted-foreground/30 tabular-nums">{index}</span>
      </div>
      <div className="col-span-5 min-w-0 flex items-center gap-2">
        {/* Thumbnail */}
        <div className={cn(
          "shrink-0 h-7 w-7 rounded-md overflow-hidden border border-border/40 flex items-center justify-center text-[10px] font-bold",
          !item.image_data && avatarCls(item.item_name),
        )}>
          {item.image_data
            ? <img src={item.image_data} alt={item.item_name} className="h-full w-full object-cover" />
            : (item.item_name ?? "?").charAt(0).toUpperCase()
          }
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-foreground truncate">{item.item_name}</p>
          {item.category_name && (
            <p className="text-[9px] text-muted-foreground/50 truncate">{item.category_name}</p>
          )}
        </div>
      </div>
      <div className="col-span-3 flex items-center gap-1.5">
        <span className={cn(
          "text-[12px] font-bold tabular-nums",
          hasDiscount ? "text-success" : "text-foreground"
        )}>
          {formatCurrency(price)}
        </span>
        {hasDiscount && (
          <>
            <span className="text-[10px] text-muted-foreground/35 line-through tabular-nums">
              {formatCurrency(origPrice)}
            </span>
            <Tag className="h-2.5 w-2.5 text-success shrink-0" />
          </>
        )}
      </div>
      <div className="col-span-2">
        {item.track_stock ? (
          <span className={cn(
            "text-[10px] tabular-nums font-medium",
            isOut ? "text-destructive" : isLow ? "text-warning" : "text-muted-foreground/50"
          )}>
            {isOut ? "Out of stock" : unitLabel ? `${stock} ${unitLabel}` : `${stock} left`}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/25">—</span>
        )}
      </div>
      <div className="col-span-1 flex justify-end items-center gap-1">
        {/* Pin button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); pinned ? onUnpin() : onPin(); }}
          className={cn(
            "h-6 w-6 rounded-md border flex items-center justify-center transition-all duration-150",
            pinned
              ? "border-amber-500/40 bg-amber-500/15 text-amber-400 opacity-100"
              : "border-transparent text-transparent group-hover:border-amber-500/30 group-hover:bg-amber-500/10 group-hover:text-amber-400",
          )}
          title={pinned ? "Remove from Quick Access" : "Add to Quick Access"}
        >
          <Star className={cn("h-3 w-3", pinned && "fill-amber-400")} />
        </button>
        {/* Add button */}
        <div className={cn(
          "h-6 w-6 rounded-md border flex items-center justify-center transition-all duration-150",
          "border-transparent text-transparent",
          !isOut && "group-hover:border-primary/40 group-hover:bg-primary/15 group-hover:text-primary",
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
function CartItemRow({ item, onRemove, onSetQty, taxInclusive = true }) {
  const lineTotal = Math.max(0, item.price * item.quantity - (item.discount ?? 0));
  const measurementType = item.measurementType ?? "quantity";
  const isWeighted = measurementType === "weight" || measurementType === "volume" || measurementType === "length";
  const step = isWeighted ? 0.001 : 1;
  const hasTax = (item.taxRate ?? 0) > 0;

  // Parse a raw input value into a valid quantity for this item type.
  // Quantity items must be whole numbers — a cashier should never sell 2.5 pcs.
  // Weight/volume/length items accept up to 3 decimal places.
  function parseQty(raw) {
    const n = parseFloat(raw);
    if (isNaN(n) || n < 0) return 0;
    return isWeighted ? n : Math.round(n);
  }

  return (
    <div className="group flex items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 hover:border-primary/20 hover:bg-card/80 transition-all duration-150">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-foreground truncate leading-tight">
          {item.name}
        </p>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground tabular-nums font-mono">
            {formatCurrency(item.price)}{item.unit ? `/${item.unit}` : ""}
          </span>
          {item.hasDiscount && (
            <>
              <span className="text-[10px] text-muted-foreground/35 line-through tabular-nums">
                {formatCurrency(item.originalPrice)}
              </span>
              <span className="rounded-full bg-success/15 border border-success/20 px-1.5 py-0.5 text-[8px] font-bold text-success leading-none">DISC</span>
            </>
          )}
          {hasTax && (
            <span className="rounded-full bg-warning/10 border border-warning/20 px-1.5 py-0.5 text-[8px] font-bold text-warning/80 leading-none">
              VAT {item.taxRate}%
            </span>
          )}
        </div>
      </div>

      {/* Qty controls */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => onSetQty(item.itemId, Math.max(0, parseQty(item.quantity - step)))}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/10 transition-all"
        >
          <Minus className="h-3 w-3" />
        </button>
        <Input
          type="number"
          value={item.quantity}
          onChange={(e) => onSetQty(item.itemId, parseQty(e.target.value))}
          onFocus={(e) => e.target.select()}
          className="h-8 w-14 text-center text-[12px] px-1 tabular-nums font-mono border-border bg-background/50"
          min="0"
          step={step}
        />
        <button
          onClick={() => onSetQty(item.itemId, parseQty(item.quantity + step))}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/10 transition-all"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Line total */}
      <div className="shrink-0 w-[76px] text-right">
        <p className="text-[13px] font-bold text-foreground tabular-nums font-mono">
          {formatCurrency(lineTotal)}
        </p>
        {hasTax && (
          <p className="text-[9px] text-muted-foreground/50 tabular-nums font-mono italic">
            {taxInclusive
              ? `incl. ${formatCurrency(lineTotal * item.taxRate / (100 + item.taxRate))} VAT`
              : `+ ${formatCurrency(lineTotal * item.taxRate / 100)} VAT`}
          </p>
        )}
      </div>

      {/* Remove */}
      <button
        onClick={() => onRemove(item.itemId)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-destructive/25 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
        title="Remove item"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreditLimitDialog
// ─────────────────────────────────────────────────────────────────────────────
function CreditLimitDialog({ error, onClose }) {
  if (!error) return null;
  const { available, required, customerName } = error;
  const shortfall = required - available;

  return (
    <Dialog open={!!error} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md bg-card border-border shadow-2xl shadow-black/60">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 border border-rose-500/25">
              <CreditCard className="h-5 w-5 text-rose-400" />
            </div>
            <div>
              <DialogTitle className="text-[15px] font-bold text-foreground leading-tight">
                Credit Limit Exceeded
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {customerName} does not have enough credit for this sale.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Breakdown rows */}
          <div className="rounded-xl border border-border/60 bg-muted/10 divide-y divide-border/40 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[12px] text-muted-foreground">Sale total</span>
              <span className="text-[13px] font-bold tabular-nums font-mono text-foreground">
                {formatCurrency(required)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[12px] text-muted-foreground">Available credit</span>
              <span className="text-[13px] font-bold tabular-nums font-mono text-success">
                {formatCurrency(available)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 bg-rose-500/5">
              <span className="text-[12px] font-semibold text-rose-400">Shortfall</span>
              <span className="text-[14px] font-bold tabular-nums font-mono text-rose-400">
                {formatCurrency(shortfall)}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed px-1">
            To complete this sale on credit, either reduce the cart total by at
            least <span className="font-semibold text-foreground">{formatCurrency(shortfall)}</span>, increase
            the customer&apos;s credit limit, or switch to a different payment method.
          </p>
        </div>

        <DialogFooter>
          <Button className="w-full" onClick={onClose}>
            Got it, adjust the sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WeighItemModal
// ─────────────────────────────────────────────────────────────────────────────
function WeighItemModal({ item, qty, onQtyChange, onConfirm, onCancel }) {
  const isValid = parseFloat(qty) > 0;

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-sm bg-card border-border shadow-2xl shadow-black/60">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 border border-primary/20">
              <Scale className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-[15px] font-bold text-foreground leading-tight">
                {item?.name ?? "Weigh Item"}
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Unit: <span className="font-semibold text-foreground">{item?.unitLabel ?? "unit"}</span>
                {item?.price != null && (
                  <span className="ml-2">· {formatCurrency(item.price)}<span className="text-muted-foreground/60">/{item?.unitLabel ?? "unit"}</span></span>
                )}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2">
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
            Weight ({item?.unitLabel ?? "unit"})
          </label>
          <div className="relative">
            <Input
              type="number"
              placeholder="0.250"
              value={qty}
              onChange={(e) => onQtyChange(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (e.key === "Enter" && isValid) onConfirm(); }}
              className="h-12 text-base font-mono tabular-nums pr-16 bg-background/60 border-border focus:border-primary"
              min="0.001"
              step="0.001"
              autoFocus
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-muted-foreground">
              {item?.unitLabel ?? "unit"}
            </span>
          </div>
          {qty && !isValid && (
            <p className="text-[11px] text-destructive mt-1.5">
              Weight must be greater than zero.
            </p>
          )}
          {isValid && (
            <p className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
              Line total ≈ <span className="font-semibold text-foreground">{formatCurrency((item?.price ?? 0) * parseFloat(qty))}</span>
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!isValid}
            onClick={onConfirm}
          >
            <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
            Add to Cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  walletBalance, loyaltyPoints, loyaltyNaira, loyaltyApplied,
  loyaltyProgrammeActive,
  onWalletPay, onLoyaltyToggle,
  taxInclusive,
  configuredMethods = [],
  storeName = "",
}) {
  const hasCart = cartItems.length > 0;
  const popCfg  = popover.type
    ? (PM_CONFIG[popover.type] ?? { label: popover.label, Icon: Banknote, badgeCls: "bg-muted/30 text-foreground border-border/50", btnCls: "", dotCls: "" })
    : null;
  const PopIcon = popCfg?.Icon;

  const customerName = activeCustomer
    ? [activeCustomer.first_name, activeCustomer.last_name].filter(Boolean).join(" ") || activeCustomer.name || "Customer"
    : "Walk-in";

  // Helper: is this method already in the payments list?
  const methodAdded = (type) => payments.some((p) => p.type === type);

  return (
    <div className="shrink-0 border-t border-border bg-card shadow-[0_-8px_40px_rgba(0,0,0,0.45)]">

      {/* ── ROW 1: Payment method buttons ───────────────────────────── */}
      <div className="border-b border-border/50 bg-muted/10">
        <Popover
          open={popover.open}
          onOpenChange={(v) => !v && setPopover({ open: false, type: null, amount: "", reference: "", requireReference: false, referenceLabel: "Reference No.", label: "" })}
        >
          {/* PopoverAnchor — positions the floating popover without toggle behaviour */}
          <PopoverAnchor asChild>
            <div className="flex items-center gap-2 px-4 py-2">

              <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider shrink-0 mr-1">
                Pay via
              </span>

              {/* Configurable payment methods (from Settings → Payment Methods) */}
              {configuredMethods.map((m) => {
                const cfg  = PM_CONFIG[m.method_key] ?? PM_CONFIG[PAYMENT_METHODS.CASH];
                const Icon = cfg.Icon;
                return (
                  <Button
                    key={m.method_key}
                    variant="outline" size="sm"
                    disabled={!hasCart}
                    onClick={() => onPaymentClick(m.method_key, {
                      requireReference: m.require_reference,
                      referenceLabel:   m.reference_label || "Reference No.",
                      label:            m.display_name,
                    })}
                    className={cn(
                      "h-8 gap-1.5 text-[11px] font-semibold transition-all",
                      cfg.btnCls,
                      "disabled:opacity-30",
                      methodAdded(m.method_key) && `ring-1 ${cfg.badgeCls.split(" ").find((c) => c.startsWith("border-"))} bg-opacity-10`,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {m.display_name}
                  </Button>
                );
              })}

              <div className="w-px h-5 bg-border/60 mx-1" />

              {/* Wallet */}
              <Button
                variant="outline" size="sm"
                disabled={!hasCart}
                onClick={onWalletPay}
                className={cn(
                  "h-8 gap-1.5 text-[11px] font-semibold transition-all",
                  PM_CONFIG[PAYMENT_METHODS.WALLET].btnCls,
                  "disabled:opacity-30",
                  methodAdded(PAYMENT_METHODS.WALLET) && "ring-1 ring-violet-500/40 bg-violet-500/10",
                )}
                title={activeCustomer ? `Wallet balance: ${formatCurrency(walletBalance)}` : "Select a customer first"}
              >
                <Wallet className="h-3.5 w-3.5" />
                Wallet
                {activeCustomer && walletBalance > 0 && (
                  <span className="ml-0.5 text-[9px] opacity-70 tabular-nums">{formatCurrency(walletBalance)}</span>
                )}
              </Button>

              {/* Loyalty */}
              <Button
                variant="outline" size="sm"
                disabled={!hasCart || !loyaltyProgrammeActive}
                onClick={onLoyaltyToggle}
                className={cn(
                  "h-8 gap-1.5 text-[11px] font-semibold transition-all",
                  loyaltyProgrammeActive
                    ? PM_CONFIG[PAYMENT_METHODS.LOYALTY].btnCls
                    : "border-border/40 text-muted-foreground/40 cursor-not-allowed",
                  "disabled:opacity-40",
                  loyaltyApplied && "ring-1 ring-amber-500/40 bg-amber-500/10",
                )}
                title={
                  !loyaltyProgrammeActive
                    ? "Loyalty programme is not active — enable it in Settings → Loyalty"
                    : activeCustomer
                      ? `${loyaltyPoints} pts = ${formatCurrency(loyaltyNaira)}`
                      : "Select a customer first"
                }
              >
                <Star className="h-3.5 w-3.5" />
                {loyaltyApplied ? "Loyalty ✓" : "Loyalty"}
                {loyaltyProgrammeActive && activeCustomer && loyaltyPoints > 0 && (
                  <span className="ml-0.5 text-[9px] opacity-70 tabular-nums">{loyaltyPoints}pts</span>
                )}
                {!loyaltyProgrammeActive && (
                  <span className="ml-0.5 text-[9px] opacity-60">off</span>
                )}
              </Button>

              {/* Remaining hint */}
              {hasCart && remaining > 0.01 && (
                <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                  Remaining: <span className="font-semibold text-foreground">{formatCurrency(remaining)}</span>
                </span>
              )}
            </div>
          </PopoverAnchor>

          {/* Amount entry popover — anchored to the whole button row above */}
          <PopoverContent
            side="top" align="start" sideOffset={8}
            className="w-72 p-0 bg-card border-border/80 shadow-2xl shadow-black/70 overflow-hidden"
          >
            {popCfg && (
              <div className={cn("flex items-center gap-3 px-4 py-3 border-b border-border/50", popCfg.badgeCls)}>
                {PopIcon && <PopIcon className="h-4 w-4 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold leading-tight">{popover.label || popCfg.label} Payment</p>
                  <p className="text-[10px] opacity-80 leading-tight mt-0.5 tabular-nums">
                    Remaining: {formatCurrency(Math.max(0, remaining))}
                  </p>
                </div>
              </div>
            )}
            <div className="p-4 space-y-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₦</span>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={popover.amount}
                  onChange={(e) => setPopover((p) => ({ ...p, amount: e.target.value }))}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => e.key === "Enter" && onPaymentSubmit()}
                  className="pl-7 h-12 font-mono tabular-nums text-base bg-background/60 border-border focus:border-primary"
                  autoFocus
                  min="0"
                  step="0.01"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm" className="flex-1"
                  onClick={() => setPopover({ open: false, type: null, amount: "", reference: "", requireReference: false, referenceLabel: "Reference No.", label: "" })}
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

      {/* ── ROW 2: Actions + Summary ────────────────────────────────── */}
      <div className="flex items-stretch">

        {/* Actions: Hold · Cancel · Charge */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 shrink-0">
          <Button
            variant="ghost" size="sm"
            disabled={!hasCart}
            onClick={onHold}
            className="h-10 gap-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40"
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
              "h-10 px-8 text-[13px] font-bold gap-2 transition-all duration-200",
              isBalanced && !isCharging
                ? "shadow-lg shadow-success/30 hover:shadow-success/50 hover:scale-[1.02] active:scale-[0.98]"
                : "opacity-40 cursor-not-allowed",
            )}
          >
            {isCharging
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : isBalanced && <CheckCircle2 className="h-4 w-4" />
            }
            {isCharging ? "Processing…" : "Charge"}
          </Button>
        </div>

        {/* Customer pill — quick access from the actions row */}
        <div className="flex items-center ml-4 self-center">
          <button
            onClick={onCustomerClick}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold border transition-all",
              activeCustomer
                ? "border-primary/30 bg-primary/8 text-primary hover:bg-primary/15"
                : "border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
            title="Change customer"
          >
            <User className="h-3 w-3 shrink-0" />
            {customerName}
            <ChevronDown className="h-2.5 w-2.5 opacity-50" />
          </button>
        </div>

        {/* Summary panel (right) */}
        <div className="ml-auto border-l border-border px-5 py-2.5 w-[310px] shrink-0 flex flex-col justify-center">
          <div className="space-y-0.5 text-[11px]">

            {/* Items qty */}
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground">Items</span>
              <span className="font-semibold tabular-nums text-foreground">
                {cartItems.length}
                <span className="text-muted-foreground font-normal ml-1">
                  ({cartItems.reduce((s, i) => s + i.quantity, 0).toFixed(
                    cartItems.some((i) => i.measurementType !== "quantity") ? 3 : 0
                  )} qty)
                </span>
              </span>
            </div>

            {/* Payment entries */}
            {payments.map((p) => {
              const cfg  = PM_CONFIG[p.type] ?? PM_CONFIG[PAYMENT_METHODS.CASH];
              const Icon = cfg.Icon;
              return (
                <div key={p.id} className={cn(
                  "flex items-center justify-between py-0.5 rounded px-1 -mx-1",
                  p.type === PAYMENT_METHODS.LOYALTY && "bg-amber-500/5",
                )}>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dotCls)} />
                    <Icon className="h-3 w-3" />
                    {cfg.label}
                    {p.type === PAYMENT_METHODS.LOYALTY && p.loyaltyPoints && (
                      <span className="text-[9px] text-amber-400/70">({p.loyaltyPoints} pts)</span>
                    )}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold tabular-nums font-mono text-foreground">
                      {formatCurrency(p.amount)}
                    </span>
                    <button
                      onClick={() => onRemovePayment(p.id)}
                      className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground/25 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="!my-1 border-t border-border/40" />

            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground">{discountAmt > 0 ? "Gross" : "Subtotal"}</span>
              <span className="font-semibold tabular-nums font-mono text-foreground">
                {formatCurrency(grossSubtotal)}
              </span>
            </div>

            {discountAmt > 0 && (
              <div className="flex items-center justify-between py-0.5">
                <span className="text-success font-medium">Discount</span>
                <span className="font-bold tabular-nums font-mono text-success">−{formatCurrency(discountAmt)}</span>
              </div>
            )}

            {tax > 0.001 && (
              <div className="flex items-center justify-between py-0.5">
                <span className="text-muted-foreground/60 text-[10px] italic">
                  {taxInclusive ? "Incl. VAT" : "+ VAT"}
                </span>
                <span className="tabular-nums font-mono text-muted-foreground/60 text-[10px] italic">{formatCurrency(tax)}</span>
              </div>
            )}

            <div className="flex items-center justify-between py-1 border-t border-border/40 mt-0.5">
              <span className="text-[13px] font-bold text-foreground">Total</span>
              <span className={cn(
                "text-[15px] font-bold tabular-nums font-mono",
                isBalanced ? "text-success" : "text-foreground",
              )}>
                {formatCurrency(total)}
              </span>
            </div>

            {amountDue > 0.01 && (
              <div className="flex items-center justify-between py-1 px-2 -mx-2 rounded-lg bg-destructive/8 border border-destructive/20">
                <span className="font-bold text-destructive text-[12px]">Still Owed</span>
                <span className="font-bold tabular-nums font-mono text-destructive text-[12px]">
                  {formatCurrency(amountDue)}
                </span>
              </div>
            )}

            {change > 0.01 && (
              <div className="flex items-center justify-between py-1 px-2 -mx-2 rounded-lg bg-success/8 border border-success/20">
                <span className="font-bold text-success text-[12px]">Change</span>
                <span className="font-bold tabular-nums font-mono text-success text-[12px]">
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
