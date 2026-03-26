// ============================================================================
// features/command-palette/CommandPalette.jsx
// ============================================================================
// Global Ctrl+K / Cmd+K search palette for Quantum POS.
//
// Built with React's createPortal — no Radix Dialog, no ScrollArea dependency.
// This keeps the palette isolated from any stacking-context issues and avoids
// indirect peer-dep chains (@radix-ui/react-scroll-area is not in package.json).
//
// Opens via ui.store: commandPaletteOpen / setCommandPaletteOpen.
// Keyboard shortcut (Ctrl+K / Cmd+K) is registered in AppShell.jsx.
// ============================================================================

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ShoppingCart, Receipt, RotateCcw, Clock, Package, Boxes, Truck,
  ClipboardList, Users, CreditCard, Wallet, BarChart3, Tag, UserCog,
  Settings, Bell, FileText, ArrowLeftRight, ShieldCheck, Banknote,
  Search, Loader2, ChevronRight, Store,
} from "lucide-react";

import { useUiStore }     from "@/stores/ui.store";
import { useAuthStore }   from "@/stores/auth.store";
import { useCommandSearch } from "./useCommandSearch";
import { cn }             from "@/lib/utils";

// ── Nav page registry ────────────────────────────────────────────────────────
const NAV_PAGES = [
  { title: "Point of Sale",    path: "/pos",              icon: ShoppingCart,  group: "Operations", roles: ["super_admin","admin","manager","cashier"] },
  { title: "Transactions",     path: "/transactions",     icon: Receipt,       group: "Operations", roles: ["super_admin","admin","manager","cashier"] },
  { title: "Returns",          path: "/returns",          icon: RotateCcw,     group: "Operations", roles: ["super_admin","admin","manager","cashier"] },
  { title: "Shifts",           path: "/shifts",           icon: Clock,         group: "Operations", roles: ["super_admin","admin","manager","cashier"] },
  { title: "EOD Reports",      path: "/eod",              icon: FileText,      group: "Operations", roles: ["super_admin","admin","manager"] },
  { title: "Notifications",    path: "/notifications",    icon: Bell,          group: "Operations" },
  { title: "Products",         path: "/products",         icon: Package,       group: "Catalog",    roles: ["super_admin","admin","manager","stock_keeper"] },
  { title: "Categories",       path: "/categories",       icon: Tag,           group: "Catalog",    roles: ["super_admin","admin","manager","stock_keeper"] },
  { title: "Departments",      path: "/departments",      icon: Tag,           group: "Catalog",    roles: ["super_admin","admin","manager","stock_keeper"] },
  { title: "Inventory",          path: "/inventory",          icon: Boxes,         group: "Catalog",    roles: ["super_admin","admin","manager","stock_keeper"] },
  { title: "Stock Counts",       path: "/stock-counts",       icon: ClipboardList, group: "Catalog",    roles: ["super_admin","admin","manager","stock_keeper"] },
  { title: "Suppliers",          path: "/suppliers",          icon: Truck,         group: "Catalog",    roles: ["super_admin","admin","manager","stock_keeper"] },
  { title: "Purchase Orders",    path: "/purchase-orders",    icon: ClipboardList, group: "Catalog",    roles: ["super_admin","admin","manager","stock_keeper"] },
  { title: "Supplier Payments",  path: "/supplier-payments",  icon: Banknote,      group: "Catalog",    roles: ["super_admin","admin","manager"] },
  { title: "Stock Transfers",    path: "/stock-transfers",    icon: ArrowLeftRight,group: "Catalog",    roles: ["super_admin","admin","manager","stock_keeper"] },
  { title: "Customers",          path: "/customers",          icon: Users,         group: "Customers" },
  { title: "Credit Sales",       path: "/credit-sales",       icon: CreditCard,    group: "Customers",  roles: ["super_admin","admin","manager","cashier"] },
  { title: "Wallets",            path: "/wallet",             icon: Wallet,        group: "Customers",  roles: ["super_admin","admin","manager","cashier"] },
  { title: "Expenses",           path: "/expenses",           icon: Receipt,       group: "Finance",    roles: ["super_admin","admin","manager"] },
  { title: "Analytics",        path: "/analytics",        icon: BarChart3,     group: "Finance",    roles: ["super_admin","admin","manager"] },
  { title: "Price Management", path: "/price-management", icon: Tag,           group: "Finance",    roles: ["super_admin","admin","manager"] },
  { title: "Users",            path: "/users",            icon: UserCog,       group: "Admin",      roles: ["super_admin","admin"] },
  { title: "Audit Log",        path: "/audit",            icon: ShieldCheck,   group: "Admin",      roles: ["super_admin","admin"] },
  { title: "Settings",         path: "/settings",         icon: Settings,      group: "Admin",      roles: ["super_admin","admin","manager"] },
];

function canSee(roleSlug, allowedRoles) {
  if (!allowedRoles) return true;
  return allowedRoles.includes(roleSlug ?? "");
}

// ── Highlight ─────────────────────────────────────────────────────────────────
function Highlight({ text, query }) {
  if (!query) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-primary rounded-sm font-semibold not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </span>
  );
}

// ── ResultRow ─────────────────────────────────────────────────────────────────
function ResultRow({ icon: Icon, label, subtitle, query, isSelected, onClick, onMouseEnter }) {
  const rowRef = useRef(null);

  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [isSelected]);

  return (
    <div
      ref={rowRef}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer select-none",
        "transition-colors duration-75",
        isSelected ? "bg-primary/15 text-foreground" : "text-foreground hover:bg-muted/60",
      )}
    >
      <div className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
        isSelected
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted/40 text-muted-foreground",
      )}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-tight">
          <Highlight text={label} query={query} />
        </p>
        {subtitle && (
          <p className="truncate text-[11px] text-muted-foreground leading-tight mt-0.5">
            {subtitle}
          </p>
        )}
      </div>

      {isSelected && (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary/60" />
      )}
    </div>
  );
}

// ── GroupLabel ────────────────────────────────────────────────────────────────
function GroupLabel({ children }) {
  return (
    <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none">
      {children}
    </p>
  );
}

// ── KbdHint ───────────────────────────────────────────────────────────────────
function KbdHint({ keys, label }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex items-center justify-center rounded border border-border bg-muted px-1 py-px font-mono text-[10px] leading-none"
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}

// ── PalettePanel ──────────────────────────────────────────────────────────────
// The actual search UI. Only mounts while the palette is open so state resets
// cleanly on every open.
function PalettePanel({ onClose }) {
  const navigate = useNavigate();
  const roleSlug = useAuthStore((s) => s.user?.role_slug ?? null);

  const [query,         setQuery]         = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef   = useRef(null);
  const panelRef   = useRef(null);

  const { items, customers, suppliers, transactions, purchaseOrders, returns, transfers, isLoading } = useCommandSearch(query);

  // Auto-focus input on mount.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Reset selection index when results change.
  useEffect(() => { setSelectedIndex(0); }, [query, items, customers, suppliers, transactions]);

  // ── Build flat rows ───────────────────────────────────────────────────────
  const allRows = useMemo(() => {
    const rows = [];
    const q    = query.trim().toLowerCase();

    // Nav pages
    NAV_PAGES
      .filter(p => canSee(roleSlug, p.roles) && (!q || p.title.toLowerCase().includes(q) || p.group.toLowerCase().includes(q)))
      .forEach(p => rows.push({
        key:      `page-${p.path}`,
        group:    "Go to",
        icon:     p.icon,
        label:    p.title,
        subtitle: p.group,
        action:   () => navigate(p.path),
      }));

    // Products
    items.forEach(it => rows.push({
      key:      `item-${it.id}`,
      group:    "Products",
      icon:     Package,
      label:    it.label,
      subtitle: it.subtitle,
      action:   () => navigate(`/products/${it.id}`),
    }));

    // Customers
    customers.forEach(c => rows.push({
      key:      `cust-${c.id}`,
      group:    "Customers",
      icon:     Users,
      label:    c.label,
      subtitle: c.subtitle,
      action:   () => navigate(`/customers/${c.id}`),
    }));

    // Suppliers
    suppliers.forEach(s => rows.push({
      key:      `supp-${s.id}`,
      group:    "Suppliers",
      icon:     Truck,
      label:    s.label,
      subtitle: s.subtitle,
      action:   () => navigate(`/suppliers/${s.id}`),
    }));

    // Transactions
    transactions.forEach(t => rows.push({
      key:      `tx-${t.id}`,
      group:    "Transactions",
      icon:     Receipt,
      label:    t.label,
      subtitle: t.subtitle,
      action:   () => navigate(`/transactions/${t.id}`),
    }));

    // Purchase Orders
    purchaseOrders.forEach(po => rows.push({
      key:      `po-${po.id}`,
      group:    "Purchase Orders",
      icon:     ClipboardList,
      label:    po.label,
      subtitle: po.subtitle,
      action:   () => navigate(`/purchase-orders/${po.id}`),
    }));

    // Returns
    returns.forEach(r => rows.push({
      key:      `ret-${r.id}`,
      group:    "Returns",
      icon:     RotateCcw,
      label:    r.label,
      subtitle: r.subtitle,
      action:   () => navigate(`/returns/${r.id}`),
    }));

    // Stock Transfers
    transfers.forEach(t => rows.push({
      key:      `trf-${t.id}`,
      group:    "Transfers",
      icon:     ArrowLeftRight,
      label:    t.label,
      subtitle: t.subtitle,
      action:   () => navigate(`/stock-transfers/${t.id}`),
    }));

    return rows;
  }, [query, roleSlug, items, customers, suppliers, transactions, purchaseOrders, returns, transfers, navigate]);

  // ── Activate ──────────────────────────────────────────────────────────────
  const activate = useCallback((index) => {
    const row = allRows[index];
    if (!row) return;
    row.action();
    onClose();
  }, [allRows, onClose]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, allRows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(selectedIndex);
    }
  }

  // ── Group rows for rendering ──────────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map();
    allRows.forEach(row => {
      if (!map.has(row.group)) map.set(row.group, []);
      map.get(row.group).push(row);
    });
    return map;
  }, [allRows]);

  const isEmpty = allRows.length === 0;
  let globalIdx = 0;

  return (
    /*
     * Panel container — white-labelled card floating near the top of the screen.
     * We stop propagation on the panel itself so clicks inside don't bubble to
     * the backdrop and accidentally close the palette.
     */
    <div
      ref={panelRef}
      onClick={e => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex flex-col",
        "w-full max-w-[600px]",
        "rounded-xl border border-border bg-card",
        "shadow-2xl shadow-black/70",
        "overflow-hidden",
      )}
      style={{ maxHeight: "min(600px, 80vh)" }}
    >
      {/* Search bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
        {isLoading
          ? <Loader2 className="h-4 w-4 shrink-0 text-muted-foreground animate-spin" />
          : <Search   className="h-4 w-4 shrink-0 text-muted-foreground" />
        }
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search pages, products, customers, suppliers…"
          className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none caret-primary"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors px-1"
            tabIndex={-1}
          >
            Clear
          </button>
        )}
      </div>

      {/* Results — plain scrollable div, no Radix ScrollArea */}
      <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 p-2">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Store className="h-8 w-8 text-muted-foreground/25" />
            <p className="text-sm text-muted-foreground">
              {query.trim() ? "No results found" : "Start typing to search…"}
            </p>
          </div>
        ) : (
          Array.from(groups.entries()).map(([groupName, groupRows]) => (
            <div key={groupName}>
              <GroupLabel>{groupName}</GroupLabel>
              {groupRows.map(row => {
                const myIdx = globalIdx++;
                return (
                  <ResultRow
                    key={row.key}
                    icon={row.icon}
                    label={row.label}
                    subtitle={row.subtitle}
                    query={query.trim()}
                    isSelected={myIdx === selectedIndex}
                    onClick={() => activate(myIdx)}
                    onMouseEnter={() => setSelectedIndex(myIdx)}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {!isEmpty && (
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 shrink-0 bg-muted/20">
          <KbdHint keys={["↑", "↓"]} label="navigate" />
          <KbdHint keys={["↵"]}      label="open" />
          <KbdHint keys={["Esc"]}    label="close" />
          <span className="ml-auto text-[10px] text-muted-foreground/40">
            {allRows.length} result{allRows.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

// ── CommandPalette ────────────────────────────────────────────────────────────
export function CommandPalette() {
  const open    = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);

  const close = useCallback(() => setOpen(false), [setOpen]);

  if (!open) return null;

  /*
   * Render directly into document.body via a portal.
   * The backdrop div handles click-outside-to-close.
   * The panel itself stops propagation (see PalettePanel).
   */
  return createPortal(
    <div
      // Backdrop
      onClick={close}
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[12vh] px-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
    >
      <PalettePanel onClose={close} />
    </div>,
    document.body,
  );
}
