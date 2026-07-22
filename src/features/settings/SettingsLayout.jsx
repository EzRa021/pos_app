// ============================================================================
// features/settings/SettingsLayout.jsx
// ============================================================================
// Shared layout for all /settings/* routes.
//
// Mirrors AnalyticsLayout: collapses the app sidebar on mount (and restores it
// on unmount) so Settings gets a single navigation rail instead of two
// competing ones. With the app sidebar in icon mode the chrome cost drops from
// ~552px to ~304px, which matters on the 1366x768 panels these terminals use.
//
// Sized for touch as well as mouse: nav rows and the search field are >=44px,
// per Apple HIG / Material minimum target size.
// ============================================================================
import { useState, useEffect, useRef, useMemo } from "react";
import { Outlet, NavLink, useParams, useNavigate } from "react-router-dom";
import { Search, X, Settings as SettingsIcon, ChevronRight } from "lucide-react";

import { useSidebar }      from "@/components/ui/sidebar";
import { Input }           from "@/components/ui/input";
import { Button }          from "@/components/ui/button";
import { useAuthStore }    from "@/stores/auth.store";
import { useBranchStore }  from "@/stores/branch.store";
import { cn }              from "@/lib/utils";
import {
  filterSettingsGroups,
  getSettingsItem,
} from "@/features/settings/settingsNav";

export default function SettingsLayout() {
  const { section }  = useParams();
  const navigate     = useNavigate();
  const roleSlug     = useAuthStore((s) => s.user?.role_slug);
  const activeStore  = useBranchStore((s) => s.activeStore);
  const [query, setQuery] = useState("");
  const searchRef    = useRef(null);

  // Collapse the app sidebar for the lifetime of Settings, then put it back
  // exactly as the user had it. Same contract as AnalyticsLayout.
  const { setOpen, open } = useSidebar();
  useEffect(() => {
    const prev = open;
    setOpen(false);
    return () => setOpen(prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "/" focuses search — standard on keyboard-driven admin UIs, and harmless
  // on touch. Ignored while the user is already typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo(
    () => filterSettingsGroups(query, roleSlug),
    [query, roleSlug],
  );

  const active     = getSettingsItem(section);
  const ActiveIcon = active?.icon;
  const hasResults = groups.length > 0;

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ── Settings nav rail ─────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-[11px] font-bold text-foreground tracking-tight">
              Settings
            </span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground truncate">
            {activeStore?.store_name ?? "Your store"}
          </p>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-border bg-muted/20">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings…"
              aria-label="Search settings"
              className="h-11 pl-9 pr-9 text-[12px]"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); searchRef.current?.focus(); }}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Grouped nav */}
        <nav className="flex-1 overflow-y-auto p-2">
          {hasResults ? (
            groups.map((group) => (
              <div key={group.id} className="mb-1">
                <p className="sticky top-0 z-10 bg-card px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.id}
                        to={`/settings/${item.id}`}
                        title={item.description}
                        className={({ isActive }) => cn(
                          "group flex min-h-[44px] w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                          isActive
                            ? "border-primary/20 bg-primary/10 text-foreground"
                            : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                        )}
                      >
                        {({ isActive }) => (
                          <>
                            <Icon className={cn(
                              "h-4 w-4 shrink-0 transition-colors",
                              isActive
                                ? "text-primary"
                                : "text-muted-foreground group-hover:text-foreground",
                            )} />
                            <span className={cn(
                              "flex-1 text-[12px] font-semibold leading-tight",
                              isActive && "text-foreground",
                            )}>
                              {item.label}
                            </span>
                            {isActive && (
                              <ChevronRight className="h-3 w-3 shrink-0 text-primary" />
                            )}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="px-3 py-8 text-center">
              <p className="text-[12px] font-semibold text-foreground">
                No settings match “{query}”
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                Try a broader term like “tax”, “printer” or “backup”.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-9 text-[11px]"
                onClick={() => { setQuery(""); searchRef.current?.focus(); }}
              >
                Clear search
              </Button>
            </div>
          )}
        </nav>

        {/* Escape hatch — the app sidebar is collapsed while in here */}
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-full justify-start gap-1.5 px-2 text-[11px] text-muted-foreground"
            onClick={() => navigate("/dashboard")}
          >
            ← Dashboard
          </Button>
        </div>
      </aside>

      {/* ── Section content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="w-full p-3">
          {active && (
            <div className="mb-3 flex items-center gap-2.5">
              {ActiveIcon && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30">
                  <ActiveIcon className="h-4 w-4 text-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-[15px] font-bold text-foreground">
                  {active.label}
                </h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {active.description}
                </p>
              </div>
            </div>
          )}
          <Outlet />
        </div>
      </div>

    </div>
  );
}
