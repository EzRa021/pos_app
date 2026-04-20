// features/analytics/AnalyticsLayout.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Shared layout for all /analytics/* pages.
// Renders a fixed left sidebar for navigation + global date filter in header.
// Date state lives here so it persists when navigating between pages.
// Child pages receive { dateFrom, dateTo, params } via AnalyticsDateContext.
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useState, useEffect } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import {
  BarChart3, TrendingUp, Package, Users, CreditCard,
  DollarSign, Box, Award, Layers, Activity, ChevronRight,
} from "lucide-react";
import { cn }              from "@/lib/utils";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { Button }          from "@/components/ui/button";

// ── Date context — child pages read this ─────────────────────────────────────
export const AnalyticsDateContext = createContext({
  dateFrom: "",
  dateTo:   "",
  params:   {},
});
export const useAnalyticsDate = () => useContext(AnalyticsDateContext);

// ── Sidebar nav items ─────────────────────────────────────────────────────────
const NAV = [
  { to: "/analytics/overview",       label: "Overview",          icon: BarChart3    },
  { to: "/analytics/sales",          label: "Sales Performance", icon: TrendingUp   },
  { to: "/analytics/products",       label: "Products",          icon: Package      },
  { to: "/analytics/payments",       label: "Payments & Cash",   icon: CreditCard   },
  { to: "/analytics/customers",      label: "Customers",         icon: Users        },
  { to: "/analytics/inventory",      label: "Inventory Health",  icon: Box          },
  { to: "/analytics/staff",          label: "Staff & Shifts",    icon: Award        },
  { to: "/analytics/profitability",  label: "Profitability",     icon: DollarSign   },
  { to: "/analytics/tax",            label: "Tax Report",        icon: Layers       },
];

// ── Layout ────────────────────────────────────────────────────────────────────
export default function AnalyticsLayout() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");

  const { setOpen, open } = useSidebar();
  useEffect(() => {
    const prev = open;
    setOpen(false);
    return () => setOpen(prev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const params = {
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  };

  return (
    <AnalyticsDateContext.Provider value={{ dateFrom, dateTo, params }}>
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <aside className="w-[196px] shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-[11px] font-bold text-foreground tracking-tight">Analytics</span>
            </div>
          </div>

          {/* Date filter */}
          <div className="px-3 py-2.5 border-b border-border bg-muted/20">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
              Date Range
            </p>
            <DateRangePicker
              from={dateFrom} to={dateTo}
              onFromChange={setDateFrom} onToChange={setDateTo}
              onClear={() => { setDateFrom(""); setDateTo(""); }}
            />
          </div>

          {/* Nav items */}
          <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all group w-full",
                    isActive
                      ? "bg-primary/10 border border-primary/20 text-foreground"
                      : "hover:bg-muted/40 text-muted-foreground hover:text-foreground border border-transparent",
                  )}
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-colors",
                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                      )} />
                      <span className={cn(
                        "text-[11px] font-semibold leading-tight flex-1",
                        isActive ? "text-foreground" : "",
                      )}>
                        {item.label}
                      </span>
                      {isActive && <ChevronRight className="h-3 w-3 text-primary shrink-0" />}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="px-3 py-2.5 border-t border-border">
            <Button variant="ghost" size="sm" className="w-full h-7 text-[10px] text-muted-foreground justify-start px-2 gap-1.5" asChild>
              <NavLink to="/dashboard">← Dashboard</NavLink>
            </Button>
          </div>
        </aside>

        {/* ── Page content ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-background">
          <Outlet />
        </div>

      </div>
    </AnalyticsDateContext.Provider>
  );
}
