// ============================================================================
// AUTH STORE — Zustand
// ============================================================================
// Storage strategy (desktop POS):
//   • access_token  → in-memory only (Zustand state). Never written to disk.
//   • refresh_token → localStorage. Survives app restarts for auto-login.
//   • user data     → localStorage. Used for optimistic display on next startup
//                     before the refresh token exchange completes.
//
// Orchestration:
//   After a successful login or session restore, this store kicks off
//   branch initialization directly via useBranchStore.getState().
//   This keeps the cascade OUT of React effects — no useEffect in App.jsx
//   needs to call initForUser, which eliminates the forceStoreRerender loop.
//
// On logout: clears auth state, delegates branch + shift + cart resets here.
// ============================================================================

import { create } from "zustand";
import { rpc, setAuthToken } from "@/lib/apiClient";
import { useBranchStore } from "@/stores/branch.store";

const REFRESH_KEY = "qpos_refresh";
const USER_KEY    = "qpos_user";

let _refreshTimer = null;

function scheduleRefresh(expiresIn, restoreSessionFn) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  // Refresh 5 minutes before expiry
  const msUntilRefresh = Math.max(0, (expiresIn - 300) * 1000);
  _refreshTimer = setTimeout(restoreSessionFn, msUntilRefresh);
}

function saveToStorage(refreshToken, user) {
  try {
    localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* storage quota — ignore */ }
}

function clearStorage() {
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

function getSavedUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export const useAuthStore = create((set, get) => ({
  user:          null,
  token:         null,
  expiresAt:     null,
  isLoading:     false,
  error:         null,
  isInitialized: false,

  // ── Login ─────────────────────────────────────────────────────────────────
  async login(username, password) {
    set({ isLoading: true, error: null });
    try {
      const result = await rpc("login", { username, password });

      const expiresAt = new Date(Date.now() + result.expires_in * 1000);
      saveToStorage(result.refresh_token, result.user);
      setAuthToken(result.access_token);

      set({
        user:          result.user,
        token:         result.access_token,
        expiresAt,
        isLoading:     false,
        error:         null,
        isInitialized: true,
      });

      scheduleRefresh(result.expires_in, get().restoreSession);

      // Kick off branch + shift initialization directly — NOT from a React
      // useEffect. Calling this here (in an async action, outside React's
      // commit phase) avoids the forceStoreRerender / infinite loop issue.
      useBranchStore.getState().initForUser(result.user);

      return result;
    } catch (err) {
      const msg = typeof err === "string" ? err : "Login failed";
      set({ isLoading: false, error: msg, isInitialized: true });
      throw msg;
    }
  },

  // ── Logout ────────────────────────────────────────────────────────────────
  async logout() {
    if (_refreshTimer) clearTimeout(_refreshTimer);

    // Best-effort server-side logout
    try { await rpc("logout"); } catch { /* ignore */ }

    setAuthToken(null);
    clearStorage();

    // Reset all dependent stores from here — no useEffect needed in App.jsx
    useBranchStore.getState().resetForLogout();

    set({ user: null, token: null, expiresAt: null, error: null });
  },

  // ── Restore session (called once from App.jsx after API base URL is set) ──
  async restoreSession() {
    const savedRefresh = localStorage.getItem(REFRESH_KEY);
    if (!savedRefresh) {
      set({ isInitialized: true });
      return false;
    }

    // Optimistic: show cached user immediately so the UI isn't blank while we
    // wait for the network. We do NOT trigger branch init here — only after
    // the server confirms the token is valid.
    const cachedUser = getSavedUser();
    if (cachedUser) set({ user: cachedUser, isLoading: true });
    else             set({ isLoading: true });

    try {
      const result = await rpc("refresh_token", { refresh_token: savedRefresh });

      const expiresAt = new Date(Date.now() + result.expires_in * 1000);
      saveToStorage(result.refresh_token, result.user);
      setAuthToken(result.access_token);

      set({
        user:          result.user,
        token:         result.access_token,
        expiresAt,
        isLoading:     false,
        isInitialized: true,
      });

      scheduleRefresh(result.expires_in, get().restoreSession);

      // Same as login — kick off branch + shift init outside React's commit
      // phase so we never hit forceStoreRerender inside a useEffect.
      useBranchStore.getState().initForUser(result.user);

      return true;
    } catch {
      setAuthToken(null);
      clearStorage();
      set({ user: null, token: null, expiresAt: null, isLoading: false, isInitialized: true });
      return false;
    }
  },

  // ── Change password ───────────────────────────────────────────────────────
  async changePassword(currentPassword, newPassword) {
    if (!get().token) throw "Not authenticated";
    await rpc("change_password", {
      current_password: currentPassword,
      new_password:     newPassword,
    });
  },

  clearError()    { set({ error: null }); },
  isGlobalUser()  { return get().user?.is_global === true; },
}));
