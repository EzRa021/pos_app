// ============================================================================
// APP-SIDEBAR — Quantum POS navigation sidebar
// ============================================================================

import { useLocation, NavLink, useNavigate } from "react-router-dom";

import {
  // Operations
  LayoutDashboard,
  ScanLine,
  ArrowRightLeft,
  Undo2,
  CalendarClock,
  FileBarChart2,
  Bell,
  // Catalog
  Package,
  FolderTree,
  Building2,
  Warehouse,
  ClipboardCheck,
  Factory,
  ShoppingBag,
  BadgeDollarSign,
  MoveHorizontal,
  // Customers
  Users,
  HandCoins,
  Wallet,
  // Finance
  TrendingDown,
  LineChart,
  BadgePercent,
  // Admin
  UserCog,
  ScrollText,
  Settings2,
  // Shared / utility
  Store,
  ChevronsUpDown,
  Check,
  LogOut,
  KeyRound,
  ChevronRight,
  Lock,
  MapPin,
  Timer,
  AlertTriangle,
  Plus,
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
import { useAuthStore }           from "@/stores/auth.store";
import { useBranchStore }         from "@/stores/branch.store";
import { useShiftStore }          from "@/stores/shift.store";
import { useBusinessInfo }        from "@/hooks/useBusinessInfo";
import { useUser }                from "@/features/users/useUsers";
import { isActiveShiftStatus }    from "@/lib/constants";
import { cn }                     from "@/lib/utils";
import UserAvatar                 from "@/components/shared/UserAvatar";

const QUANTUM_LOGO = "/quantum-logo.svg";

// ─── Role-based access helper ─────────────────────────────────────────────────
function canSee(roleSlug, allowedRoles) {
  if (!allowedRoles) return true;
  return allowedRoles.includes(roleSlug ?? "");
}

// ─── Navigation definition ────────────────────────────────────────────────────
//
// Icon rationale:
//   ScanLine       — scanning barcodes at checkout = POS
//   ArrowRightLeft — money going in both directions = Transactions
//   Undo2          — undoing a sale = Returns
//   CalendarClock  — time-bounded sessions = Shifts
//   FileBarChart2  — end-of-day summary report = EOD
//   FolderTree     — hierarchical grouping = Categories
//   Building2      — organisational division = Departments
//   Warehouse      — physical stock location = Inventory
//   ClipboardCheck — counting and verifying stock = Stock Counts
//   Factory        — where goods come from = Suppliers
//   ShoppingBag    — ordering from suppliers = Purchase Orders
//   BadgeDollarSign— money owed to supplier = Supplier Payments
//   MoveHorizontal — moving stock laterally = Stock Transfers
//   HandCoins      — handing over credit = Credit Sales
//   TrendingDown   — spending / outflows = Expenses
//   LineChart      — data over time = Analytics
//   BadgePercent   — pricing and margin rules = Price Management
//   ScrollText     — immutable log of events = Audit Log
//   Settings2      — gear with finer detail = Settings
//
const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      { title: "Dashboard",      path: "/dashboard",      icon: LayoutDashboard, exact: true },
      { title: "Point of Sale",  path: "/pos",            icon: ScanLine,        exact: true },
      { title: "Transactions",   path: "/transactions",   icon: ArrowRightLeft },
      { title: "Returns",        path: "/returns",        icon: Undo2 },
      { title: "Shifts",         path: "/shifts",         icon: CalendarClock },
      {
        title: "EOD Reports",
        path:  "/eod",
        icon:  FileBarChart2,
        roles: ["super_admin", "admin", "manager"],
      },
      { title: "Notifications",  path: "/notifications",  icon: Bell },
    ],
  },
  {
    label: "Catalog",
    items: [
      {
        title: "Products",
        path:  "/products",
        icon:  Package,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Categories",
        path:  "/categories",
        icon:  FolderTree,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Departments",
        path:  "/departments",
        icon:  Building2,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Inventory",
        path:  "/inventory",
        icon:  Warehouse,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Stock Counts",
        path:  "/stock-counts",
        icon:  ClipboardCheck,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Suppliers",
        path:  "/suppliers",
        icon:  Factory,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Purchase Orders",
        path:  "/purchase-orders",
        icon:  ShoppingBag,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
      {
        title: "Supplier Payments",
        path:  "/supplier-payments",
        icon:  BadgeDollarSign,
        roles: ["super_admin", "admin", "manager"],
      },
      {
        title: "Stock Transfers",
        path:  "/stock-transfers",
        icon:  MoveHorizontal,
        roles: ["super_admin", "admin", "manager", "stock_keeper"],
      },
    ],
  },
  {
    label: "Customers",
    items: [
      { title: "Customers",    path: "/customers",    icon: Users },
      {
        title: "Credit Sales",
        path:  "/credit-sales",
        icon:  HandCoins,
        roles: ["super_admin", "admin", "manager", "cashier"],
      },
      {
        title: "Wallets",
        path:  "/wallet",
        icon:  Wallet,
        roles: ["super_admin", "admin", "manager", "cashier"],
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        title: "Expenses",
        path:  "/expenses",
        icon:  TrendingDown,
        roles: ["super_admin", "admin", "manager"],
      },
      {
        title:        "Analytics",
        path:         "/analytics/overview",
        icon:         LineChart,
        activePrefix: "/analytics",
        roles:        ["super_admin", "admin", "gm", "manager"],
      },
      {
        title: "Price Management",
        path:  "/price-management",
        icon:  BadgePercent,
        roles: ["super_admin", "admin", "manager"],
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        title: "Users",
        path:  "/users",
        icon:  UserCog,
        roles: ["super_admin", "admin"],
      },
      {
        title: "Audit Log",
        path:  "/audit",
        icon:  ScrollText,
        roles: ["super_admin", "admin"],
      },
      {
        title: "Settings",
        path:  "/settings",
        icon:  Settings2,
        roles: ["super_admin", "admin", "manager"],
      },
    ],
  },
];

// ─── NavItem ──────────────────────────────────────────────────────────────────
function NavItem({ title, path, icon: Icon, exact, activePrefix }) {
  const { pathname } = useLocation();

  const isActive = activePrefix
    ? pathname.startsWith(activePrefix)
    : exact
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
function ShiftStatusBanner({ roleSlug }) {
  const activeShift   = useShiftStore((s) => s.activeShift);
  const isInitialized = useShiftStore((s) => s.isInitialized);
  if (!roleSlug || !isInitialized) return null;

  const isOpen = isActiveShiftStatus(activeShift?.status);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          tooltip={isOpen ? "Shift is open" : "No active shift — open one to use POS"}
          className="cursor-default hover:bg-transparent active:bg-transparent"
        >
          <NavLink to="/shifts">
            <div
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                isOpen
                  ? "border-success/30 bg-success/15"
                  : "border-warning/30 bg-warning/10",
              )}
            >
              {isOpen
                ? <Timer        className="h-3 w-3 text-success" />
                : <AlertTriangle className="h-3 w-3 text-warning" />}
            </div>

            <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className={cn("truncate text-[12px] font-semibold", isOpen ? "text-success" : "text-warning")}>
                {isOpen ? "Shift Open" : "No Active Shift"}
              </span>
              {isOpen && activeShift?.opened_at && (
                <span className="truncate text-[10px] text-muted-foreground">
                  {(() => {
                    const d    = new Date(activeShift.opened_at);
                    const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
                    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    return `Since ${date}, ${time}`;
                  })()}
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
function StoreSwitcher() {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();

  const activeStore    = useBranchStore((s) => s.activeStore);
  const stores         = useBranchStore((s) => s.stores);
  const switchStore    = useBranchStore((s) => s.switchStore);
  const storeIsLoading = useBranchStore((s) => s.isLoading);

  const user        = useAuthStore((s) => s.user);
  const isGlobal    = user?.is_global === true;
  const canAddStore = ["super_admin", "admin", "gm"].includes(user?.role_slug ?? "");

  const storeName = (() => {
    if (activeStore?.store_name) return activeStore.store_name;
    if (isGlobal)                return "Select a store";
    if (storeIsLoading)          return "Loading…";
    if (activeStore?.id)         return `Store #${activeStore.id}`;
    return "No store assigned";
  })();

  const storeCode = storeName
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 2)
    .toUpperCase() || "ST";

  const storeCount    = stores.length;
  const storeSubtitle = (() => {
    if (!isGlobal) {
      const loc = [activeStore?.city, activeStore?.state].filter(Boolean).join(", ");
      if (loc)             return loc;
      if (activeStore?.id) return `Store ID: ${activeStore.id}`;
      return "Assigned store";
    }
    if (storeCount > 0) return `${storeCount} store${storeCount === 1 ? "" : "s"} available`;
    return "No stores available";
  })();

  // ── Read-only badge for store-bound users ──────────────────────────────────
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
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 overflow-hidden">
              {activeStore?.logo_data ? (
                <img src={activeStore.logo_data} alt={storeName} className="h-full w-full object-cover" />
              ) : hasName ? (
                <span className="text-[11px] font-bold text-primary leading-none">{storeCode}</span>
              ) : (
                <Store className={cn("h-4 w-4 text-primary", storeIsLoading && "animate-pulse")} />
              )}
            </div>
            <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-[13px] font-semibold text-sidebar-foreground">{storeName}</span>
              <span className="truncate text-[10px] text-sidebar-foreground/40">{storeSubtitle}</span>
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
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 overflow-hidden">
                {activeStore?.logo_data ? (
                  <img src={activeStore.logo_data} alt={storeName} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[11px] font-bold text-primary">{storeCode}</span>
                )}
              </div>
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-[13px] font-semibold text-sidebar-foreground">{storeName}</span>
                <span className="text-[10px] text-sidebar-foreground/40">{storeSubtitle}</span>
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
                  className={cn("cursor-pointer gap-3 rounded-lg px-2 py-2.5", isActive && "bg-primary/10")}
                >
                  <div className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md overflow-hidden",
                    isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                  )}>
                    {store.logo_data
                      ? <img src={store.logo_data} alt={name} className="h-full w-full object-cover" />
                      : <span className="text-[10px] font-bold">{code}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", isActive ? "text-primary" : "text-foreground")}>
                      {name}
                    </p>
                    {location && (
                      <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <MapPin className="h-2.5 w-2.5 shrink-0" />
                        {location}
                      </p>
                    )}
                  </div>
                  {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </DropdownMenuItem>
              );
            })}

            {canAddStore && (
              <>
                <DropdownMenuSeparator className="my-1.5 bg-border/60" />
                <DropdownMenuItem
                  onClick={() => navigate("/store/new")}
                  className={cn(
                    "group cursor-pointer gap-2.5 rounded-lg px-2 py-2.5",
                    "border border-dashed border-primary/30 bg-primary/[0.04]",
                    "hover:bg-primary/10 hover:border-primary/50 transition-all duration-150",
                  )}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
                    <Plus className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-primary">Add New Store</p>
                    <p className="text-[10px] text-primary/60">Create a new branch location</p>
                  </div>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ─── UserFooter ───────────────────────────────────────────────────────────────
function UserFooter() {
  const authUser = useAuthStore((s) => s.user);
  const logout   = useAuthStore((s) => s.logout);
  const lockPos  = useAuthStore((s) => s.lockPos);
  const { isMobile } = useSidebar();

  // Fetch the full user profile so the avatar is always fresh (AvatarUploader
  // invalidates ["user", id] after every upload/remove — this query re-fetches
  // automatically and merges the latest avatar into the sidebar display).
  const { data: freshUser } = useUser(authUser?.id);

  // Merge: fresh profile wins for the avatar field; fall back to auth store
  // so name / role display works even before the query resolves.
  const user = freshUser ? { ...authUser, avatar: freshUser.avatar ?? authUser?.avatar } : authUser;

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
              {/* Trigger avatar — photo if set, otherwise initials */}
              <UserAvatar user={user} size={32} rounded="xl" className="shrink-0" />
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-[13px] font-semibold text-sidebar-foreground">{displayName}</span>
                <span className="truncate text-[10px] capitalize text-sidebar-foreground/40">{roleName}</span>
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
            {/* Header card with larger avatar */}
            <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-3 mb-1">
              <UserAvatar user={user} size={40} rounded="xl" className="shrink-0" />
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

            <DropdownMenuItem
              onClick={lockPos}
              className="cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground"
            >
              <Lock className="h-4 w-4 shrink-0" />
              <span className="text-sm">Lock Screen</span>
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
  const { name: businessName, businessType, logoData } = useBusinessInfo();

  const typeLabel = businessType
    ? businessType.charAt(0).toUpperCase() + businessType.slice(1)
    : "Point of Sale";

  return (
    <Sidebar collapsible="icon" {...props}>

      {/* ═══ HEADER ══════════════════════════════════════════════════════════ */}
      <SidebarHeader className="gap-0 p-0">
        <div className="flex items-center gap-2.5 px-3 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg overflow-hidden bg-primary shadow-sm">
            {logoData ? (
              <img src={logoData} alt={businessName ?? "Quantum POS"} className="h-full w-full object-cover" />
            ) : (
              <img
                src={QUANTUM_LOGO}
                alt="Quantum POS"
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  e.currentTarget.parentElement.innerHTML =
                    '<span class="select-none text-sm font-black leading-none text-white">Q</span>';
                }}
              />
            )}
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="text-[13px] font-bold leading-none tracking-tight text-sidebar-foreground truncate">
              {businessName ?? "Quantum POS"}
            </p>
            <p className="mt-0.5 text-[10px] leading-none text-sidebar-foreground/40 truncate">
              {businessName ? typeLabel : "Point of Sale System"}
            </p>
          </div>
        </div>

        <SidebarSeparator className="mx-3 bg-sidebar-border/60" />

        <div className="px-2 py-1.5">
          <StoreSwitcher />
        </div>

        <SidebarSeparator className="mx-3 bg-sidebar-border/60" />
      </SidebarHeader>

      {/* ═══ CONTENT — overflow-y-auto so items scroll in both expanded and
           icon-only (collapsed) modes when there are many nav entries ════════ */}
      {/*
       * style overflowY is intentional — shadcn hardcodes
       * group-data-[collapsible=icon]:overflow-hidden inside SidebarContent,
       * and Tailwind className cannot reliably override another Tailwind class.
       * Inline style always wins over class-based styles in CSS.
       */}
      <SidebarContent className="gap-0 py-1.5" style={{ overflowY: "auto" }}>
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
