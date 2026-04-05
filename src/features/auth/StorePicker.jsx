// ============================================================================
// components/store-picker.jsx
// ============================================================================
// Shown after login when the user is a global (admin/super_admin) role and
// no active store has been selected (or the previously saved store is gone).
//
// Global users can operate any store — this picker lets them choose one.
// Store-bound users (cashier, manager, etc.) never see this screen; their
// store is fixed on the backend and loaded automatically by branchStore.
//
// Data flow:
//   useBranchStore.stores     — list of all active stores (loaded by initForUser)
//   useBranchStore.setActiveStore(store) — persists choice + dismisses screen
//
// Backend model fields (src-tauri/src/models/store.rs):
//   id, store_name, address, city, state, phone, email,
//   currency, timezone, is_active
// ============================================================================

import { useBranchStore } from "@/stores/branch.store";
import { useAuthStore }   from "@/stores/auth.store";
import { Store, MapPin, ChevronRight, LogOut, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn }     from "@/lib/utils";

export default function StorePicker() {
  const stores        = useBranchStore((s) => s.stores);
  const setActiveStore = useBranchStore((s) => s.setActiveStore);
  const isLoading     = useBranchStore((s) => s.isLoading);

  const user   = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const first      = (user?.first_name ?? "").trim();
  const displayName = first || user?.username || "Admin";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25">
            <span className="text-2xl font-black text-white select-none">Q</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">
              Select a Store
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Welcome back, {displayName}. Which store are you operating today?
            </p>
          </div>
        </div>

        {/* ── Store list ──────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-black/40 overflow-hidden">

          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                <p className="text-xs text-muted-foreground">Loading stores…</p>
              </div>
            </div>
          )}

          {!isLoading && stores.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted">
                <Building2 className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No stores available</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  No active stores found. Contact your administrator.
                </p>
              </div>
            </div>
          )}

          {!isLoading && stores.map((store, idx) => {
            const name     = store.store_name ?? "Store";
            const code     = name.slice(0, 2).toUpperCase();
            const location = [store.city, store.state].filter(Boolean).join(", ");
            const isLast   = idx === stores.length - 1;

            return (
              <button
                key={store.id}
                onClick={() => setActiveStore(store)}
                className={cn(
                  "w-full flex items-center gap-4 px-5 py-4 text-left",
                  "transition-all duration-150",
                  "hover:bg-primary/[0.06] active:bg-primary/[0.10]",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
                  !isLast && "border-b border-border/60",
                )}
              >
                {/* Store initials badge */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-[12px] font-bold text-primary">
                  {code}
                </div>

                {/* Store info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {name}
                  </p>
                  {location ? (
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5 truncate">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      {location}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      No location set
                    </p>
                  )}
                </div>

                {/* Arrow */}
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              </button>
            );
          })}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="flex justify-center mt-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-muted-foreground hover:text-foreground gap-1.5"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-3">
          Quantum POS © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
