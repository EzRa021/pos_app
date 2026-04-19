// ============================================================================
// features/auth/StorePicker.jsx
// ============================================================================
// Shown after login when the user is a global (admin / super_admin) role and
// no active store has been selected.
//
// Design: two-column, matches LoginPage exactly.
//   Left  — brand panel with user greeting + accent decorations
//   Right — search bar + store card grid
// ============================================================================

import { useState, useMemo, useEffect } from "react";
import { useBranchStore } from "@/stores/branch.store";
import { useAuthStore }   from "@/stores/auth.store";
import {
  Store, MapPin, Phone, Mail, Search,
  LogOut, Building2, ChevronRight, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";

// ─── Store card ───────────────────────────────────────────────────────────────
function StoreCard({ store, onSelect }) {
  const name     = store.store_name ?? "Store";
  const initials = name.replace(/[^a-zA-Z\s]/g, "").trim().split(/\s+/)
    .map((w) => w[0]).slice(0, 2).join("").toUpperCase() || name.slice(0, 2).toUpperCase();
  const location = [store.city, store.state].filter(Boolean).join(", ");

  return (
    <button
      onClick={() => onSelect(store)}
      className={cn(
        "group w-full text-left rounded-xl border border-border bg-card",
        "p-4 flex flex-col gap-3",
        "transition-all duration-150",
        "hover:border-primary/40 hover:bg-primary/[0.03] hover:shadow-sm",
        "active:scale-[0.985]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
    >
      {/* Top row: initials + arrow */}
      <div className="flex items-start justify-between gap-2">
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-[12px] font-bold",
          "border-primary/25 bg-primary/[0.08] text-primary",
          "group-hover:border-primary/40 group-hover:bg-primary/[0.12] transition-colors",
        )}>
          {initials}
        </div>
        <ChevronRight className={cn(
          "h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/30 transition-all duration-150",
          "group-hover:text-primary/60 group-hover:translate-x-0.5",
        )} />
      </div>

      {/* Store name */}
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-foreground leading-snug truncate">
          {name}
        </p>

        {/* Location */}
        {location ? (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1 truncate">
            <MapPin className="h-2.5 w-2.5 shrink-0 opacity-60" />
            {location}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground/40 mt-1 italic">No location</p>
        )}
      </div>

      {/* Contact row */}
      {(store.phone || store.email) && (
        <div className="flex flex-col gap-0.5 border-t border-border/60 pt-2.5">
          {store.phone && (
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground truncate">
              <Phone className="h-2.5 w-2.5 shrink-0 opacity-50" />
              {store.phone}
            </p>
          )}
          {store.email && (
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground truncate">
              <Mail className="h-2.5 w-2.5 shrink-0 opacity-50" />
              {store.email}
            </p>
          )}
        </div>
      )}
    </button>
  );
}

// ─── User avatar (left panel) ─────────────────────────────────────────────────
function UserAvatar({ user }) {
  const initials = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    || (user?.username ?? "?")[0].toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-[13px] font-bold text-foreground">
        {initials}
      </div>
      <div>
        <p className="text-[13px] font-bold text-foreground leading-none">
          {[user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username}
        </p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
          {user?.role_name ?? user?.role_slug ?? "User"}
        </p>
      </div>
    </div>
  );
}

// ─── Main StorePicker ─────────────────────────────────────────────────────────
export default function StorePicker() {
  const stores         = useBranchStore((s) => s.stores);
  const setActiveStore = useBranchStore((s) => s.setActiveStore);
  const isLoading      = useBranchStore((s) => s.isLoading);

  const user   = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [search, setSearch] = useState("");

  // The StorePicker shows before any store is selected, so the branch store
  // hasn't applied a store's theme yet. If the last-used store had theme='light',
  // index.html's inline script will have removed the 'dark' class — making all
  // design tokens resolve to light-mode values. Force dark while this screen is
  // visible; branch.store will re-apply the correct theme after selection.
  useEffect(() => {
    const html = document.documentElement;
    const wasDark = html.classList.contains("dark");
    html.classList.add("dark");
    html.style.background = "#09090b";
    return () => {
      if (!wasDark) html.classList.remove("dark");
    };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return stores;
    const q = search.toLowerCase();
    return stores.filter((s) =>
      s.store_name?.toLowerCase().includes(q) ||
      s.city?.toLowerCase().includes(q)       ||
      s.state?.toLowerCase().includes(q)
    );
  }, [stores, search]);

  return (
    <div className="h-full w-full bg-background flex overflow-hidden">

      {/* ── LEFT — Brand panel ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex w-[380px] shrink-0 flex-col justify-between
                      border-r border-border bg-card/40 px-9 py-9
                      relative overflow-hidden">

        {/* Subtle background grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* Radial glow */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/[0.06] blur-3xl" />

        {/* Logo + wordmark */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl
                          border border-primary/30 bg-primary/[0.08] shadow-sm">
            <span className="text-[18px] font-black text-primary leading-none">Q</span>
          </div>
          <div>
            <p className="text-[15px] font-black text-foreground tracking-tight leading-none">
              Quantum POS
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
              Management System
            </p>
          </div>
        </div>

        {/* Middle: welcome copy */}
        <div className="relative space-y-5">
          {/* Accent dots */}
          <div className="flex items-center gap-1.5">
            <span className="h-[3px] w-6 rounded-full bg-primary" />
            <span className="h-[3px] w-2.5 rounded-full bg-primary/30" />
            <span className="h-[3px] w-1 rounded-full bg-primary/15" />
          </div>

          <div>
            <h2 className="text-[24px] font-black text-foreground leading-[1.2] tracking-tight">
              Welcome back.<br />
              <span className="text-primary">Choose your workspace.</span>
            </h2>
            <p className="text-[12px] text-muted-foreground mt-3 leading-relaxed max-w-[260px]">
              Select the store you want to operate. You can switch between
              stores at any time from the sidebar.
            </p>
          </div>

          {/* Store count pill */}
          {!isLoading && stores.length > 0 && (
            <div className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-2.5">
              <Store className="h-4 w-4 text-primary" />
              <div>
                <p className="text-[13px] font-bold text-primary tabular-nums leading-none">
                  {stores.length} {stores.length === 1 ? "store" : "stores"} available
                </p>
                <p className="text-[10px] text-primary/60 mt-0.5">
                  All active locations
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer: user info + sign out */}
        <div className="relative space-y-4">
          <div className="h-px bg-border/60" />
          <UserAvatar user={user} />
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="w-full justify-start gap-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/[0.06] h-8 px-2"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/30">
            © {new Date().getFullYear()} Quantum POS
          </p>
        </div>
      </div>

      {/* ── RIGHT — Store picker ────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Right header */}
        <div className="shrink-0 px-8 pt-8 pb-5 border-b border-border/60 bg-card/20">

          {/* Mobile logo (hidden on lg) */}
          <div className="flex items-center justify-between mb-5 lg:hidden">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.08]">
                <span className="text-[14px] font-black text-primary">Q</span>
              </div>
              <p className="text-[13px] font-black text-foreground">Quantum POS</p>
            </div>
            <Button
              variant="ghost" size="sm"
              onClick={logout}
              className="gap-1.5 text-[11px] text-muted-foreground hover:text-destructive h-8"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[18px] font-black text-foreground tracking-tight leading-none">
                Select a store
              </h1>
              <p className="text-[12px] text-muted-foreground mt-1.5">
                {isLoading
                  ? "Loading your stores…"
                  : stores.length === 0
                  ? "No stores are available on your account."
                  : `${stores.length} active ${stores.length === 1 ? "location" : "locations"} · choose one to continue`}
              </p>
            </div>

            {/* Mobile user avatar */}
            <div className="shrink-0 lg:hidden">
              <UserAvatar user={user} />
            </div>
          </div>

          {/* Search — only show when there are multiple stores */}
          {!isLoading && stores.length > 3 && (
            <div className="relative mt-4 max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search stores…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-[12px] bg-background"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Store grid */}
        <div className="flex-1 overflow-auto">
          <div className="px-8 py-6">

            {/* Loading */}
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                <Loader2 className="h-7 w-7 animate-spin" />
                <p className="text-[12px]">Loading stores…</p>
              </div>
            )}

            {/* Empty */}
            {!isLoading && stores.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted/30">
                  <Building2 className="h-7 w-7 text-muted-foreground/30" />
                </div>
                <div>
                  <p className="text-[14px] font-bold text-foreground">No stores available</p>
                  <p className="text-[12px] text-muted-foreground mt-1.5 max-w-xs">
                    Your account has no active stores assigned. Contact your administrator.
                  </p>
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={logout}
                  className="gap-1.5 text-[12px] mt-1"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </Button>
              </div>
            )}

            {/* No search results */}
            {!isLoading && stores.length > 0 && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <Search className="h-8 w-8 text-muted-foreground/25" />
                <div>
                  <p className="text-[13px] font-semibold text-muted-foreground">No stores match</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">
                    Try a different search term
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSearch("")} className="text-[11px]">
                  Clear search
                </Button>
              </div>
            )}

            {/* Grid */}
            {!isLoading && filtered.length > 0 && (
              <div className={cn(
                "grid gap-3",
                filtered.length === 1
                  ? "max-w-xs"
                  : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
              )}>
                {filtered.map((store) => (
                  <StoreCard
                    key={store.id}
                    store={store}
                    onSelect={setActiveStore}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right footer */}
        <div className="shrink-0 px-8 py-3 border-t border-border/40 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/30">
            © {new Date().getFullYear()} Quantum POS
          </p>
          {/* Mobile sign-out already in header; show only on lg+ */}
          <p className="hidden lg:block text-[10px] text-muted-foreground/30">
            Your session is active
          </p>
        </div>
      </div>
    </div>
  );
}
