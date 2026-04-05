// ============================================================================
// AUTH STORE — Zustand
// ============================================================================
// Storage strategy (desktop POS):
//   • access_token  → in-memory only (Zustand state). Never written to disk.
//   • refresh_token → sessionStorage. Cleared when the WebView (app) closes.
//                     Stays alive across hot-reloads and navigation within the
//                     same session. Avoids leaving a credential on disk.
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
    sessionStorage.setItem(REFRESH_KEY, refreshToken);  // clears on app/tab close
    localStorage.setItem(USER_KEY, JSON.stringify(user)); // kept for optimistic display
  } catch { /* storage quota — ignore */ }
}

function clearStorage() {
  sessionStorage.removeItem(REFRESH_KEY);
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

  // ── Restore session ────────────────────────────────────────────────────────
  // Called once from App.jsx after the API base URL is set.
  //
  // Guards against two failure modes:
  //   1. React Strict Mode fires useEffect twice in dev — two concurrent
  //      restoreSession calls would race; the loser sets user:null last.
  //      Fix: deduplicate via _restoreInFlight promise.
  //   2. Transient errors (DB not yet ready, brief network blip) caused
  //      user:null even for a perfectly valid refresh token.
  //      Fix: retry up to MAX_RETRY times with exponential back-off before
  //      giving up. isInitialized stays false during retries so the app
  //      shows the splash instead of flashing to login.
  _restoreInFlight: null,

  async restoreSession() {
    // If a restore is already in flight (Strict Mode double-invoke), wait for
    // the same promise instead of starting a second concurrent attempt.
    const existing = get()._restoreInFlight;
    if (existing) return existing;

    const promise = get()._doRestoreSession(0);
    set({ _restoreInFlight: promise });
    try {
      return await promise;
    } finally {
      set({ _restoreInFlight: null });
    }
  },

  async _doRestoreSession(attempt) {
    const MAX_RETRY  = 3;   // 300 ms → 600 ms → 1.2 s  (max ~2 s total)
    const RETRY_BASE = 300;

    const savedRefresh = sessionStorage.getItem(REFRESH_KEY);
    if (!savedRefresh) {
      set({ isInitialized: true });
      return false;
    }

    // Optimistic: paint cached user immediately so the splash fades out faster.
    // We only do this on the first attempt to avoid flickering on retries.
    if (attempt === 0) {
      const cachedUser = getSavedUser();
      if (cachedUser) set({ user: cachedUser, isLoading: true });
      else             set({ isLoading: true });
    }

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

      scheduleRefresh(result.expires_in, () => get().restoreSession());

      useBranchStore.getState().initForUser(result.user);

      return true;
    } catch (err) {
      const errMsg = (typeof err === "string" ? err : (err?.message ?? "")).toLowerCase();

      // Permanent rejection: the token is genuinely invalid/expired or the
      // account was deleted. Clear stored credentials so the user can log in
      // with fresh ones.
      const isTokenRejected =
        errMsg.includes("invalid") ||
        errMsg.includes("expired") ||
        errMsg.includes("unauthorized") ||
        errMsg.includes("not found or inactive") ||
        errMsg.includes("signature");

      if (isTokenRejected) {
        setAuthToken(null);
        clearStorage();
        set({ user: null, token: null, expiresAt: null, isLoading: false, isInitialized: true });
        return false;
      }

      // Transient error (DB not connected yet, network blip, server starting
      // up). Do NOT clear the tokens and do NOT set user:null — retry first.
      if (attempt < MAX_RETRY) {
        const delay = RETRY_BASE * Math.pow(2, attempt); // 1s 2s 4s 8s
        console.warn(`[auth] restoreSession attempt ${attempt + 1} failed ("${errMsg}") — retrying in ${delay} ms`);
        await new Promise(r => setTimeout(r, delay));
        return get()._doRestoreSession(attempt + 1);
      }

      // All retries exhausted — something is genuinely wrong. Keep tokens in
      // storage so the next cold launch can try again, but send the user to
      // the login screen for now.
      console.error(`[auth] restoreSession failed after ${MAX_RETRY + 1} attempts:`, err);
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

  // ── POS PIN lock ──────────────────────────────────────────────────────────
  isPosLocked: false,
  lockPos()   { set({ isPosLocked: true }); },
  unlockPos() { set({ isPosLocked: false }); },
}));
