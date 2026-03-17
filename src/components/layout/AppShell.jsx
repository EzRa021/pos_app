import { Outlet, useLocation, NavLink } from "react-router-dom";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

const ROUTE_META = {
  "/pos":              { label: "Point of Sale",    group: "Operations" },
  "/transactions":     { label: "Transactions",     group: "Operations" },
  "/returns":          { label: "Returns",          group: "Operations" },
  "/shifts":           { label: "Shifts",           group: "Operations" },
  "/products":         { label: "Products",         group: "Catalog"    },
  "/inventory":        { label: "Inventory",        group: "Catalog"    },
  "/suppliers":        { label: "Suppliers",        group: "Catalog"    },
  "/purchase-orders":  { label: "Purchase Orders",  group: "Catalog"    },
  "/customers":        { label: "Customers",        group: "Customers"  },
  "/credit-sales":     { label: "Credit Sales",     group: "Customers"  },
  "/expenses":         { label: "Expenses",         group: "Finance"    },
  "/analytics":        { label: "Analytics",        group: "Finance"    },
  "/price-management": { label: "Price Management", group: "Finance"    },
  "/users":            { label: "Users",            group: "Admin"      },
  "/settings":         { label: "Settings",         group: "Admin"      },
  "/eod":              { label: "EOD Reports",       group: "Operations" },
  "/notifications":    { label: "Notifications",    group: "Operations" },
  "/stock-transfers":  { label: "Stock Transfers",  group: "Catalog"    },
  "/audit":            { label: "Audit Log",         group: "Admin"      },
};

function Breadcrumb() {
  const { pathname } = useLocation();
  const meta = ROUTE_META[pathname];
  return (
    <nav className="flex items-center gap-1 min-w-0" aria-label="Breadcrumb">
      <NavLink to="/pos" className="flex items-center shrink-0 text-muted-foreground hover:text-foreground transition-colors">
        <Home className="h-3.5 w-3.5" />
      </NavLink>
      {meta && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-border shrink-0" />
          <span className="text-muted-foreground text-xs shrink-0">{meta.group}</span>
          <ChevronRight className="h-3.5 w-3.5 text-border shrink-0" />
          <span className="text-foreground text-xs font-medium truncate">{meta.label}</span>
        </>
      )}
    </nav>
  );
}

export function AppShell() {
  return (
    // h-full fills the flex-1 container below the TitleBar (not h-screen —
    // the title bar already consumed 36px of the viewport height).
    <SidebarProvider style={{ height: "100%" }}>
      <AppSidebar />

      {/* SidebarInset is now flex-1 + overflow-hidden + h-screen (fixed in sidebar.jsx) */}
      <SidebarInset>
        {/* Header — shrink-0 flex child, can never scroll away */}
        <header className="flex h-12 w-full shrink-0 items-center gap-2 border-b border-border bg-card/80 backdrop-blur-sm px-3 z-20">
          <SidebarTrigger className={cn(
            "h-7 w-7 shrink-0 rounded-md",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            "inline-flex items-center justify-center transition-colors"
          )} />
          <Separator orientation="vertical" className="h-4 bg-border mx-0.5 shrink-0" />
          <Breadcrumb />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>

        {/* Content — flex-1 + overflow-hidden; each page controls its own scroll */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden bg-background">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
