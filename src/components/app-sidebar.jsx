// ============================================================================
// APP-SIDEBAR — Quantum POS navigation sidebar
// ============================================================================
//
// Sections:
//   Header  → Brand mark (Q logo) + Store Switcher
//   Content → Five nav groups, filtered by the user's role_slug
//   Footer  → Shift status banner + Logged-in user menu
//
// Role-based visibility:
//   Each nav item has an optional `roles` array. If absent, all roles see it.
//   Groups whose every item is filtered out are hidden entirely.
//   Five built-in roles: super_admin, admin, manager, cashier, stock_keeper.
//
// Shift status banner:
//   Reads from shiftStore. Shows "Shift Open" (green) or "No Active Shift"
//   (amber warning) above the user footer. Cashiers must open a shift before
//   using the POS — this makes the status always visible.
//
// Backend field names (src-tauri/src/models/):
//   AuthUser  → first_name, last_name, username, email,
//               role_name, role_slug, store_id, is_global
//   Store     → id, store_name, address, city, state,
//               phone, email, currency, timezone, is_active
//   Shift     → id, store_id, cashier_id, status, opened_at, closed_at,
//               opening_float, closing_float
//
// Collapse: collapsible="icon" shrinks sidebar to a 3rem icon-only strip.
// ============================================================================

import { useLocation, NavLink } from "react-router-dom";

import {
  ShoppingCart, Receipt, RotateCcw, Clock,
  Package, Boxes, Truck, ClipboardList,
  Users, CreditCard, Wallet, BarChart3,
  Tag, UserCog, Settings,
  Store, ChevronsUpDown, Check,
  LogOut, KeyRound, ChevronRight,
  MapPin, Timer, AlertTriangle,
  Bell, FileText, ArrowLeftRight, ShieldCheck,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuthStore }   from "@/stores/auth.store";
import { useBranchStore } from "@/stores/branch.store";
import { useShiftStore }  from "@/stores/shift.store";
import { isActiveShiftStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

// ─── Role-based access helper ─────────────────────────────────────────────────
// Returns true if the user's roleSlug is in the item's `roles` array.
// If `roles` is undefined, the item is visible to every authenticated user.
function canSee(roleSlug, allowedRoles) {
  if (!allowedRoles) return true;
  return allowedRoles.includes(roleSlug ?? "");
}

// ─── Navigation definition ────────────────────────────────────────────────────
// `roles`: which role_slugs can see this item. Omit = visible to all roles.
// `exact`: only mark active on exact path match (prevents /pos activating for /products).

const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      {
        title: "Point of Sale",
        path: "/pos",
        icon: ShoppingCart,
        exact: true,
        roles: ["super_admin", "admin", "manager", "cashier"],
      },
      {
        title: "Transactions",
        path: "/transactions",
        icon: Receipt,
        roles: ["super_admin", "admin", "manager", "cashier"],
      },
      {
        title: "Returns",
        path: "/returns",
        icon: RotateCcw,
        roles: ["super_admin", "admin", "manager", "cashier"],
      },
      {
        title: "Shifts",
        path: "/shifts",
        icon: Clock,
        roles: ["super_admin", "admin", "manager", "cashier"],
      },
      {
        title: "EOD Reports",
        path: "/eod",
        icon: FileText,
        roles: ["super_admin", "admin", "manager"],
      },
      {
        title: "Notifications",
        path: "/notifications",
        icon: Bell,
      },
    ],
  },
  {
    label: "Catalog",
    items: [
      {
        title: "Products",
        path: "/products",
        icon: Package,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Categories",
        path: "/categories",
        icon: Tag,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Departments",
        path: "/departments",
        icon: Tag,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Inventory",
        path: "/inventory",
        icon: Boxes,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Suppliers",
        path: "/suppliers",
        icon: Truck,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Purchase Orders",
        path: "/purchase-orders",
        icon: ClipboardList,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Stock Transfers",
        path: "/stock-transfers",
        icon: ArrowLeftRight,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
    ],
  },
  {
    label: "Customers",
    items: [
      {
        title: "Customers",
        path: "/customers",
        icon: Users,
      },
      {
        title: "Credit Sales",
        path: "/credit-sales",
        icon: CreditCard,
        roles: ["super_admin", "admin", "manager", "cashier"],
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        title: "Expenses",
        path: "/expenses",
        icon: Wallet,
        roles: ["super_admin", "admin", "manager"],
      },
      {
        title: "Analytics",
        path: "/analytics",
        icon: BarChart3,
        roles: ["super_admin", "admin", "manager"],
      },
      {
        title: "Price Management",
        path: "/price-management",
        icon: Tag,
        roles: ["super_admin", "admin", "manager"],
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        title: "Users",
        path: "/users",
        icon: UserCog,
        roles: ["super_admin", "admin"],
      },
      {
        title: "Audit Log",
        path: "/audit",
        icon: ShieldCheck,
        roles: ["super_admin", "admin"],
      },
      {
        title: "Settings",
        path: "/settings",
        icon: Settings,
        roles: ["super_admin", "admin", "manager"],
      },
    ],
  },
];

// ─── NavItem ──────────────────────────────────────────────────────────────────
function NavItem({ title, path, icon: Icon, exact }) {
  const { pathname } = useLocation();

  const isActive = exact
    ? pathname === path
    : pathname === path || pathname.startsWith(path + "/");

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={title}
        className={cn(
          "transition-colors duration-150",
          "data-[active=true]:bg-primary/15",
          "data-[active=true]:text-primary",
          "data-[active=true]:font-semibold",
          "data-[active=true]:hover:bg-primary/20",
          "data-[active=true]:hover:text-primary",
        )}
      >
        <NavLink to={path} end={exact}>
          <Icon
            className={cn(
              "h-4 w-4 shrink-0 transition-colors duration-150",
              isActive
                ? "text-primary"
                : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80",
            )}
          />
          <span className="flex-1 truncate">{title}</span>
          {isActive && (
            <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-primary/50" />
          )}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ─── NavGroup ─────────────────────────────────────────────────────────────────
// Filters items by role before rendering. Hides the entire group if no items pass.
function NavGroup({ label, items, roleSlug }) {
  const visibleItems = items.filter((item) => canSee(roleSlug, item.roles));
  if (visibleItems.length === 0) return null;

  return (
    <SidebarGroup className="px-2 py-0">
      <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/35">
        {label}
      </SidebarGroupLabel>
      <SidebarMenu className="gap-px">
        {visibleItems.map((item) => (
          <NavItem key={item.path} {...item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

// ─── ShiftStatusBanner ────────────────────────────────────────────────────────
// Shows current shift state. Only visible to roles that operate shifts.
// Collapses to a single icon dot in icon-only sidebar mode.
//
// Shift status values (from src-tauri/src/models/shift.rs): "open" | "closed"
function ShiftStatusBanner({ roleSlug }) {
  const activeShift = useShiftStore((s) => s.activeShift);
  const shiftRoles  = ["super_admin", "admin", "manager", "cashier"];
  if (!shiftRoles.includes(roleSlug ?? "")) return null;

  // Covers open, active, AND suspended — all mean shift is still in progress.
  // A shift transitions from "open" → "active" after the first sale, so
  // checking only === "open" wrongly shows "No Active Shift" after refresh.
  const isOpen = isActiveShiftStatus(activeShift?.status);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          tooltip={isOpen ? "Shift is open" : "No active shift — open one to use POS"}
          className="cursor-default hover:bg-transparent active:bg-transparent"
        >
          {/* NavLink to /shifts so clicking navigates there */}
          <NavLink to="/shifts">
            {/* Status dot — always visible in icon mode */}
            <div
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                isOpen
                  ? "border-success/30 bg-success/15"
                  : "border-warning/30 bg-warning/10",
              )}
            >
              {isOpen ? (
                <Timer className="h-3 w-3 text-success" />
              ) : (
                <AlertTriangle className="h-3 w-3 text-warning" />
              )}
            </div>

            {/* Label — hidden in icon-collapsed mode */}
            <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span
                className={cn(
                  "truncate text-[12px] font-semibold",
                  isOpen ? "text-success" : "text-warning",
                )}
              >
                {isOpen ? "Shift Open" : "No Active Shift"}
              </span>
              {isOpen && activeShift?.opened_at && (
                <span className="truncate text-[10px] text-muted-foreground">
                  Since {new Date(activeShift.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              {!isOpen && (
                <span className="truncate text-[10px] text-muted-foreground">
                  Open a shift to use POS
                </span>
              )}
            </div>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ─── StoreSwitcher ────────────────────────────────────────────────────────────
// • Global users (is_global = true)  → dropdown to switch between all stores
// • Store-bound users (is_global = false) → read-only chip showing THEIR store
//
// IMPORTANT: Never show "All Stores" for store-bound users. They can only
// ever operate in their single assigned store.
function StoreSwitcher() {
  const { isMobile } = useSidebar();

  const activeStore    = useBranchStore((s) => s.activeStore);
  const stores         = useBranchStore((s) => s.stores);
  const switchStore    = useBranchStore((s) => s.switchStore);
  const storeIsLoading = useBranchStore((s) => s.isLoading);

  const user     = useAuthStore((s) => s.user);
  // Strict equality — is_global may be null/undefined for legacy tokens
  const isGlobal = user?.is_global === true;

  // ── Resolve the display name ───────────────────────────────────────────────
  //  Global  + no store picked yet  → "Select a store"
  //  Global  + store picked         → store name
  //  Non-global + name available    → store name       ← the happy path
  //  Non-global + still loading     → "Loading…"
  //  Non-global + no store assigned → "No store assigned"  (misconfigured DB)
  const storeName = (() => {
    if (activeStore?.store_name) return activeStore.store_name;
    if (isGlobal) return "Select a store";
    if (storeIsLoading) return "Loading…";
    if (activeStore?.id) return `Store #${activeStore.id}`; // name fetch in-progress
    return "No store assigned";
  })();

  // Two-letter avatar derived from store name (letters only)
  const storeCode = storeName
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 2)
    .toUpperCase() || "ST";

  const storeCount = stores.length;

  // Subtitle line (shown below store name)
  const storeSubtitle = (() => {
    if (!isGlobal) {
      // Show city/state if available, else the store ID
      const loc = [activeStore?.city, activeStore?.state].filter(Boolean).join(", ");
      if (loc) return loc;
      if (activeStore?.id) return `Store ID: ${activeStore.id}`;
      return "Assigned store";
    }
    if (storeCount > 0) return `${storeCount} store${storeCount === 1 ? "" : "s"} available`;
    return "No stores available";
  })();

  // ── Read-only badge for store-bound users ──────────────────────────────────
  // No dropdown — these users cannot switch stores.
  if (!isGlobal) {
    const hasName = !!activeStore?.store_name;
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip={storeName}
            className="cursor-default select-none hover:bg-transparent active:bg-transparent"
          >
            {/* Avatar shows two-letter abbreviation once we have the real name */}
            {hasName ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-[11px] font-bold text-primary leading-none">
                {storeCode}
              </div>
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                <Store className={cn("h-4 w-4 text-primary", storeIsLoading && "animate-pulse")} />
              </div>
            )}

            <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-[13px] font-semibold text-sidebar-foreground">
                {storeName}
              </span>
              <span className="truncate text-[10px] text-sidebar-foreground/40">
                {storeSubtitle}
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // ── Dropdown switcher for global users ────────────────────────────────────
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={storeName}
              className={cn(
                "transition-colors duration-150",
                "data-[state=open]:bg-sidebar-accent",
                "data-[state=open]:text-sidebar-accent-foreground",
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-[11px] font-bold text-primary">
                {storeCode}
              </div>
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-[13px] font-semibold text-sidebar-foreground">
                  {storeName}
                </span>
                <span className="text-[10px] text-sidebar-foreground/40">
                  {storeSubtitle}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-sidebar-foreground/35" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-64 rounded-xl border border-border bg-card p-1.5 shadow-2xl shadow-black/50"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={8}
          >
            <DropdownMenuLabel className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Switch Store
            </DropdownMenuLabel>

            {stores.length === 0 && (
              <div className="px-2 py-4 text-center">
                <Store className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">No stores available</p>
              </div>
            )}

            {stores.map((store) => {
              const name     = store.store_name ?? "Store";
              const code     = name.slice(0, 2).toUpperCase();
              const isActive = activeStore?.id === store.id;
              const location = [store.city, store.state].filter(Boolean).join(", ");

              return (
                <DropdownMenuItem
                  key={store.id}
                  onClick={() => switchStore(store.id)}
                  className={cn(
                    "cursor-pointer gap-3 rounded-lg px-2 py-2.5",
                    isActive && "bg-primary/10",
                  )}
                >
                  <div className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-bold",
                    isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                  )}>
                    {code}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      "truncate text-sm font-medium",
                      isActive ? "text-primary" : "text-foreground",
                    )}>
                      {name}
                    </p>
                    {location && (
                      <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <MapPin className="h-2.5 w-2.5 shrink-0" />
                        {location}
                      </p>
                    )}
                  </div>
                  {isActive && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ─── UserFooter ───────────────────────────────────────────────────────────────
function UserFooter() {
  const user   = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { isMobile } = useSidebar();

  if (!user) return null;

  const first       = (user.first_name ?? "").trim();
  const last        = (user.last_name  ?? "").trim();
  const displayName = [first, last].filter(Boolean).join(" ") || user.username || "User";
  const initials    = displayName.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const roleName    = (user.role_name ?? user.role_slug ?? "Staff").replace(/_/g, " ");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={displayName}
              className={cn(
                "transition-colors duration-150",
                "data-[state=open]:bg-sidebar-accent",
                "data-[state=open]:text-sidebar-accent-foreground",
              )}
            >
              <Avatar className="h-8 w-8 shrink-0 rounded-lg">
                <AvatarFallback className="rounded-lg border border-primary/25 bg-primary/10 text-[11px] font-semibold text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-[13px] font-semibold text-sidebar-foreground">
                  {displayName}
                </span>
                <span className="truncate text-[10px] capitalize text-sidebar-foreground/40">
                  {roleName}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-sidebar-foreground/35" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-64 rounded-xl border border-border bg-card p-1.5 shadow-2xl shadow-black/50"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={8}
          >
            {/* Identity card */}
            <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-3 mb-1">
              <Avatar className="h-10 w-10 shrink-0 rounded-xl">
                <AvatarFallback className="rounded-xl border border-primary/25 bg-primary/10 text-sm font-semibold text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                <p className="truncate text-[11px] capitalize text-muted-foreground">{roleName}</p>
                {user.email && (
                  <p className="truncate text-[10px] text-muted-foreground/60">{user.email}</p>
                )}
              </div>
            </div>

            <DropdownMenuItem className="cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground">
              <KeyRound className="h-4 w-4 shrink-0" />
              <span className="text-sm">Change Password</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="my-1 bg-border" />

            <DropdownMenuItem
              onClick={logout}
              className="cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-destructive hover:bg-destructive/10 focus:bg-destructive/10 focus:text-destructive"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="text-sm">Sign Out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ─── AppSidebar (root export) ─────────────────────────────────────────────────
export function AppSidebar({ ...props }) {
  const roleSlug = useAuthStore((s) => s.user?.role_slug ?? null);

  return (
    <Sidebar collapsible="icon" {...props}>

      {/* ═══ HEADER ══════════════════════════════════════════════════════════ */}
      <SidebarHeader className="gap-0 p-0">
        {/* Brand row */}
        <div className="flex items-center gap-2.5 px-3 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
            <span className="select-none text-sm font-black leading-none text-white">Q</span>
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="text-[13px] font-bold leading-none tracking-tight text-sidebar-foreground">
              Quantum POS
            </p>
            <p className="mt-0.5 text-[10px] leading-none text-sidebar-foreground/40">
              Point of Sale System
            </p>
          </div>
        </div>

        <SidebarSeparator className="mx-3 bg-sidebar-border/60" />

        <div className="px-2 py-1.5">
          <StoreSwitcher />
        </div>

        <SidebarSeparator className="mx-3 bg-sidebar-border/60" />
      </SidebarHeader>

      {/* ═══ CONTENT ═════════════════════════════════════════════════════════ */}
      <SidebarContent className="gap-0 py-1.5">
        {NAV_GROUPS.map((group) => (
          <NavGroup
            key={group.label}
            label={group.label}
            items={group.items}
            roleSlug={roleSlug}
          />
        ))}
      </SidebarContent>

      {/* ═══ FOOTER ══════════════════════════════════════════════════════════ */}
      <SidebarFooter className="p-0">
        <SidebarSeparator className="mx-3 bg-sidebar-border/60" />

        {/* Shift status — above user menu */}
        <div className="px-2 pt-1.5 pb-0.5">
          <ShiftStatusBanner roleSlug={roleSlug} />
        </div>

        <SidebarSeparator className="mx-3 bg-sidebar-border/60" />

        <div className="px-2 py-1.5">
          <UserFooter />
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
