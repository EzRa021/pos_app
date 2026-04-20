import { useState, useRef, useEffect } from "react";
import { Outlet, useLocation, NavLink } from "react-router-dom";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator }        from "@/components/ui/separator";
import { AppSidebar }       from "@/components/layout/AppSidebar";
import { NotificationBell }  from "@/features/notifications/NotificationBell";
import { SyncStatusBadge }  from "@/components/shared/SyncStatusBadge";
import { CommandPalette }   from "@/features/command-palette/CommandPalette";
import { KeyboardHelp }    from "@/features/keyboard-help/KeyboardHelp";
import { useUiStore }       from "@/stores/ui.store";
import { useBranchStore }  from "@/stores/branch.store";
import { useCurrencySetup } from "@/hooks/useCurrencySetup";
import { ErrorBoundary }    from "@/components/shared/ErrorBoundary";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Route metadata ────────────────────────────────────────────────────────────
const ROUTE_META = {
  "/pos":                     { label: "Point of Sale",    group: "Operations" },
  "/transactions":            { label: "Transactions",     group: "Operations" },
  "/transactions/:id":        { label: "Transaction",      group: "Operations", parentPath: "/transactions" },
  "/returns":                 { label: "Returns",          group: "Operations" },
  "/returns/:id":             { label: "Return",           group: "Operations", parentPath: "/returns" },
  "/shifts":                  { label: "Shifts",           group: "Operations" },
  "/shifts/:id":              { label: "Shift Detail",     group: "Operations", parentPath: "/shifts" },
  "/eod":                     { label: "EOD Reports",      group: "Operations" },
  "/notifications":           { label: "Notifications",    group: "Operations" },
  "/products":                { label: "Products",          group: "Catalog" },
  "/products/:id":            { label: "Product Detail",    group: "Catalog",   parentPath: "/products" },
  "/departments":             { label: "Departments",       group: "Catalog" },
  "/categories":              { label: "Categories",        group: "Catalog" },
  "/inventory":               { label: "Inventory",         group: "Catalog" },
  "/inventory/:itemId":       { label: "Item Inventory",    group: "Catalog",   parentPath: "/inventory" },
  "/stock-counts":            { label: "Stock Counts",      group: "Catalog" },
  "/stock-counts/:id":        { label: "Count Session",     group: "Catalog",   parentPath: "/stock-counts" },
  "/stock-counts/:id/report": { label: "Variance Report",   group: "Catalog",   parentPath: "/stock-counts" },
  "/stock-transfers":         { label: "Stock Transfers",   group: "Catalog" },
  "/stock-transfers/:id":     { label: "Transfer Detail",   group: "Catalog",   parentPath: "/stock-transfers" },
  "/suppliers":               { label: "Suppliers",         group: "Catalog" },
  "/suppliers/:id":           { label: "Supplier Detail",   group: "Catalog",   parentPath: "/suppliers" },
  "/supplier-payments":       { label: "Supplier Payments", group: "Catalog" },
  "/purchase-orders":         { label: "Purchase Orders",   group: "Catalog" },
  "/purchase-orders/new":     { label: "New PO",            group: "Catalog",   parentPath: "/purchase-orders" },
  "/purchase-orders/:id":     { label: "PO Detail",         group: "Catalog",   parentPath: "/purchase-orders" },
  "/customers":               { label: "Customers",         group: "Customers" },
  "/customers/:id":           { label: "Customer Detail",   group: "Customers", parentPath: "/customers" },
  "/credit-sales":            { label: "Credit Sales",      group: "Customers" },
  "/wallet":                  { label: "Wallets",           group: "Customers" },
  "/expenses":                { label: "Expenses",          group: "Finance" },
  "/analytics":               { label: "Analytics",         group: "Finance" },
  "/price-management":        { label: "Price Management",  group: "Finance" },
  "/users":                   { label: "Users",             group: "Admin" },
  "/stores":                  { label: "Stores",            group: "Admin" },
  "/stores/:id":              { label: "Store",             group: "Admin",  parentPath: "/stores" },
  "/settings":                { label: "Settings",          group: "Admin" },
  "/audit":                   { label: "Audit Log",         group: "Admin" },
};

function matchRoute(pathname) {
  if (ROUTE_META[pathname]) return ROUTE_META[pathname];

  const esc = (s) => s.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
  const patterns = Object.keys(ROUTE_META)
    .filter((k) => k.includes(":"))
    .sort((a, b) => b.length - a.length);

  for (const pattern of patterns) {
    const regexStr = esc(pattern).replace(/:[^/]+/g, "[^/]+");
    if (new RegExp("^" + regexStr + "$").test(pathname)) {
      return ROUTE_META[pattern];
    }
  }
  return null;
}

function getDetailContext(pathname, meta) {
  if (!meta?.parentPath) return "";
  const segments    = pathname.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment || lastSegment === "new" || lastSegment === "report") return "";
  if (/^\d+$/.test(lastSegment))          return ` #${lastSegment}`;
  if (/^[0-9a-f]{8}-/i.test(lastSegment)) return ` #${lastSegment.slice(0, 8)}\u2026`;
  if (lastSegment.length <= 12)           return ` \u00b7 ${lastSegment}`;
  return "";
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function Breadcrumb() {
  const { pathname } = useLocation();
  const meta    = matchRoute(pathname);
  const context = getDetailContext(pathname, meta);

  return (
    <nav className="flex items-center gap-1 min-w-0" aria-label="Breadcrumb">
      <NavLink
        to="/dashboard"
        className="flex items-center shrink-0 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
      </NavLink>

      {meta && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-border shrink-0" />
          <span className="text-muted-foreground text-xs shrink-0">{meta.group}</span>

          {meta.parentPath && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-border shrink-0" />
              <NavLink
                to={meta.parentPath}
                className="text-muted-foreground text-xs hover:text-foreground transition-colors shrink-0"
              >
                {ROUTE_META[meta.parentPath]?.label ?? meta.parentPath}
              </NavLink>
            </>
          )}

          <ChevronRight className="h-3.5 w-3.5 text-border shrink-0" />
          <span className="text-foreground text-xs font-medium truncate">
            {meta.label}
            {context && (
              <span className="text-muted-foreground font-normal">{context}</span>
            )}
          </span>
        </>
      )}
    </nav>
  );
}

// ── AppShell ──────────────────────────────────────────────────────────────────
// Sidebar open state is controlled here so we can collapse it on analytics
// routes without fighting the shadcn internal cookie/state loop.
//
// Why not a child component with useSidebar()?
// shadcn's setOpen has `open` in its useCallback deps — calling it updates
// `open`, which recreates `setOpen`, which re-triggers the useEffect →
// infinite loop / flickering. Controlling `open` from outside (via
// SidebarProvider's `open` + `onOpenChange` props) sidesteps this entirely.
export function AppShell() {
  const { pathname }           = useLocation();
  const setCommandPaletteOpen  = useUiStore((s) => s.setCommandPaletteOpen);
  const validateActiveStore    = useBranchStore((s) => s.validateActiveStore);

  useCurrencySetup();

  // ── Sidebar auto-collapse ─────────────────────────────────────────────────
  // Start collapsed when already on an analytics route (e.g. hard refresh).
  const isAnalytics          = pathname.startsWith("/analytics") || pathname === "/pos";
  const [sidebarOpen, setSidebarOpen] = useState(!isAnalytics);
  const prevIsAnalyticsRef   = useRef(isAnalytics);

  useEffect(() => {
    const prev = prevIsAnalyticsRef.current;
    if (prev !== isAnalytics) {
      // Only fire when crossing the analytics boundary, not on every render.
      setSidebarOpen(!isAnalytics);
      prevIsAnalyticsRef.current = isAnalytics;
    }
  }, [isAnalytics]);

  // ── Store re-validation on focus ──────────────────────────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") validateActiveStore();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [validateActiveStore]);

  // ── Global Cmd+K / Ctrl+K ────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMac  = navigator.platform.toUpperCase().includes("MAC");
      const hotkey = isMac ? e.metaKey : e.ctrlKey;
      if (hotkey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setCommandPaletteOpen]);

  return (
    <>
      <CommandPalette />
      <KeyboardHelp />

      {/*
       * Controlled open/onOpenChange so:
       *   - We collapse on analytics automatically (above useEffect).
       *   - SidebarTrigger still toggles normally because it calls
       *     toggleSidebar() → setOpen() → our onOpenChange=setSidebarOpen.
       */}
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <AppSidebar />

        <SidebarInset>
          <header className="flex h-12 w-full shrink-0 items-center gap-2 border-b border-border bg-card/80 backdrop-blur-sm px-3 z-20">
            <SidebarTrigger className={cn(
              "h-7 w-7 shrink-0 rounded-md",
              "text-muted-foreground hover:text-foreground hover:bg-muted",
              "inline-flex items-center justify-center transition-colors",
            )} />
            <Separator orientation="vertical" className="h-4 bg-border mx-0.5 shrink-0" />
            <Breadcrumb />
            <div className="ml-auto flex items-center gap-2">
              <SyncStatusBadge />
              <NotificationBell />
            </div>
          </header>

          <div className="flex flex-1 flex-col min-h-0 overflow-hidden bg-background">
            <ErrorBoundary pageLevel>
              <Outlet />
            </ErrorBoundary>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}
