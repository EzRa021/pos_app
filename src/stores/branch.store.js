// ============================================================================
// BRANCH STORE — Zustand
// ============================================================================
// Manages the currently selected store/branch.
//
// Key design rules:
//   1. initForUser calls set() exactly TWICE per code path (set #1 / set #2).
//   2. initForUser is called from auth.store — NOT from a React useEffect.
//   3. Non-global users are pinned to their assigned store_id. That store_id
//      is resolved to a full Store object via get_store. The store_id is ALSO
//      saved to localStorage so queries always have a storeId, even before
//      the full store object arrives.
//   4. setActiveStore / switchStore also kick off shift init so the active
//      shift always stays in sync.
// ============================================================================

import { create } from "zustand";
import { rpc } from "@/lib/apiClient";
import { useShiftStore } from "@/stores/shift.store";

const ACTIVE_STORE_KEY = "qpos_active_store";

function saveActiveStore(store) {
  try { localStorage.setItem(ACTIVE_STORE_KEY, JSON.stringify(store)); } catch { }
}
function loadSavedStore() {
  try {
    const raw = localStorage.getItem(ACTIVE_STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearSavedStore() {
  localStorage.removeItem(ACTIVE_STORE_KEY);
}

export const useBranchStore = create((set, get) => ({
  activeStore:         null,
  stores:              [],
  isLoading:           false,
  isBranchInitialized: false,
  needsPicker:         false,

  // ── Init for logged-in user ───────────────────────────────────────────────
  // Called by auth.store after login / restoreSession.
  //
  // Two code paths:
  //   • Non-global: user.store_id is their single assigned store.
  //                 We fetch that store by ID and set it as activeStore.
  //                 If the fetch fails we still set activeStore = { id } stub
  //                 so every downstream query has a store_id to filter on,
  //                 then retry in the background to fill in the name.
  //   • Global:     user can pick from any store. Load the full list,
  //                 restore the last-used store from localStorage if valid.
  async initForUser(user) {
    // ── set #1: clear stale state ──────────────────────────────────────────
    set({
      isLoading:           true,
      isBranchInitialized: false,
      activeStore:         null,
      needsPicker:         false,
      stores:              [],
    });

    // ── NON-GLOBAL: cashier / manager / stock_keeper pinned to one store ───
    if (!user.is_global) {
      let activeStore = null;

      if (user.store_id) {
        // Serve the cached store immediately to avoid a loading flash on reload.
        const cached = loadSavedStore();
        if (cached?.id === user.store_id && cached?.store_name) {
          activeStore = cached;
        }

        // Call get_my_store — reads store_id directly from the JWT on the
        // server side, so it works for every role with no extra permission.
        try {
          const fresh = await rpc("get_my_store");
          // get_my_store returns the full Store object or null
          if (fresh && fresh.id) {
            activeStore = fresh;
            saveActiveStore(fresh);
          } else if (!activeStore) {
            // Server returned null (store deleted?) — keep a minimal stub so
            // downstream queries still have a store_id to scope by.
            activeStore = { id: user.store_id, store_name: null };
          }
        } catch {
          // Network error — use cache if available, else minimal stub.
          if (!activeStore) {
            activeStore = { id: user.store_id, store_name: null };
          }
          // Background retry will fill in store_name once the network recovers.
          setTimeout(() => get()._retryStoreName(user.store_id), 3000);
        }

        if (activeStore?.id) saveActiveStore(activeStore);
      }

      // ── set #2: commit final state ────────────────────────────────────────
      set({
        activeStore,
        needsPicker:         false,
        isLoading:           false,
        isBranchInitialized: true,
        stores:              activeStore ? [activeStore] : [],
      });

      if (activeStore?.id) {
        useShiftStore.getState().initForStore(activeStore.id);
      }
      return;
    }

    // ── GLOBAL: super_admin / admin — pick from list ───────────────────────
    const saved = loadSavedStore();
    let stores      = [];
    let activeStore = null;
    let needsPicker = true;

    try {
      const result = await rpc("get_stores", { is_active: true });
      // get_stores may return an array directly or a paged result
      stores = Array.isArray(result) ? result : (result?.data ?? []);

      const savedIsValid = saved != null && stores.some((s) => s.id === saved.id);

      if (savedIsValid) {
        activeStore = stores.find((s) => s.id === saved.id) ?? null;
        needsPicker = false;
      } else {
        if (saved) clearSavedStore();
        activeStore = null;
        needsPicker = stores.length > 1; // Auto-select if only one store
        if (stores.length === 1) {
          activeStore = stores[0];
          saveActiveStore(activeStore);
          needsPicker = false;
        }
      }
    } catch {
      // Offline — use saved store
      activeStore = saved ?? null;
      needsPicker = !saved;
      stores      = activeStore ? [activeStore] : [];
    }

    // ── set #2: commit final state ─────────────────────────────────────────
    set({ stores, activeStore, needsPicker, isLoading: false, isBranchInitialized: true });

    if (activeStore?.id) {
      useShiftStore.getState().initForStore(activeStore.id);
    }
  },

  // ── Background retry for missing store_name ───────────────────────────────
  // Called when the initial get_store fetch failed (network issue at startup).
  // Retries up to 5 times with exponential back-off. Once the name is
  // retrieved it patches activeStore in-place so the sidebar updates live.
  async _retryStoreName(storeId, attempt = 1) {
    if (attempt > 5) return;
    try {
      // Use get_my_store (no permission gate) for the retry too.
      const store = await rpc("get_my_store");
      if (store?.id && store?.store_name) {
        saveActiveStore(store);
        set((state) => ({
          activeStore: state.activeStore?.id === storeId ? store : state.activeStore,
          stores:      state.stores.map((s) => s.id === storeId ? store : s),
        }));
      } else {
        throw new Error("empty");
      }
    } catch {
      const delay = Math.min(30_000, 3_000 * Math.pow(2, attempt - 1));
      setTimeout(() => get()._retryStoreName(storeId, attempt + 1), delay);
    }
  },

  // ── Set active store (StorePicker / admin switch) ─────────────────────────
  setActiveStore(store) {
    saveActiveStore(store);
    set((state) => ({
      activeStore: store,
      needsPicker: false,
      stores: state.stores.some((s) => s.id === store.id)
        ? state.stores
        : [...state.stores, store],
    }));
    useShiftStore.getState().initForStore(store.id);
  },

  // ── Switch store by ID (top-bar picker) ───────────────────────────────────
  async switchStore(storeId) {
    const existing = get().stores.find((s) => s.id === storeId);
    if (existing) { get().setActiveStore(existing); return; }
    try {
      const store = await rpc("get_store", { id: storeId });
      if (store?.id) get().setActiveStore(store);
    } catch { /* UI handles error */ }
  },

  // ── Reload store list ──────────────────────────────────────────────────────
  async reloadStores() {
    try {
      const result = await rpc("get_stores", { is_active: true });
      const stores = Array.isArray(result) ? result : (result?.data ?? []);
      set({ stores });
    } catch { /* ignore */ }
  },

  // ── Reset helpers ──────────────────────────────────────────────────────────
  reset() {
    set({ activeStore: null, stores: [], isLoading: false, isBranchInitialized: false, needsPicker: false });
  },

  resetForLogout() {
    clearSavedStore();
    set({ activeStore: null, stores: [], isLoading: false, isBranchInitialized: false, needsPicker: false });
  },
}));
