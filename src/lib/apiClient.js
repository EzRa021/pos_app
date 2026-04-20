// ============================================================================
// API CLIENT — Axios
// ============================================================================
// Single Axios instance used by all stores and React Query hooks.
//
// Base URL is set dynamically at startup (from App.jsx):
//   Server mode: http://localhost:<api_port>
//   Client mode: http://<server_ip>:<api_port>
//
// Auth token is set/cleared by the auth store on login/logout:
//   apiClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
//   delete apiClient.defaults.headers.common["Authorization"];
//
// All POS screens call rpc(method, params) — never invoke() directly.
// ============================================================================

import axios from "axios";

export const apiClient = axios.create({
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

// ── 401 / silent token-refresh machinery ──────────────────────────────────────
// When any authenticated request gets a 401 (expired access token) we:
//   1. Pause all in-flight requests in a queue.
//   2. Fire one refresh call using fetch (bypasses this interceptor).
//   3. Retry every queued request with the new token.
//   4. If refresh itself fails → force-logout so the user hits the login screen.
//
// Callbacks are registered by auth.store.js at module load time so the
// interceptor can update Zustand state without a circular import.

const STORED_REFRESH_KEY = "qpos_refresh";

let _isRefreshing  = false;
let _pendingQueue  = []; // Array<{ resolve, reject }>
let _onRefreshed   = null; // (tokenPairData) => void
let _onForceLogout = null; // ()             => void

function drainQueue(error, token = null) {
  _pendingQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  _pendingQueue = [];
}

/**
 * Called once by auth.store.js right after the store is created.
 * onRefreshed  — receives the full token-pair response; store must update
 *                Zustand state, localStorage, and reschedule the refresh timer.
 * onForceLogout — called when refresh fails; store must clear all auth state.
 */
export function registerAuthCallbacks({ onRefreshed, onForceLogout }) {
  _onRefreshed   = onRefreshed;
  _onForceLogout = onForceLogout;
}

// ── Response interceptor ──────────────────────────────────────────────────────
apiClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const status   = err.response?.status;

    // Only intercept 401s from authenticated requests (login / public endpoints
    // don't carry an Authorization header and should never trigger a refresh).
    const hasAuthHeader = !!original?.headers?.["Authorization"];

    if (status === 401 && !original._retry && hasAuthHeader) {
      original._retry = true;

      const savedRefresh = localStorage.getItem(STORED_REFRESH_KEY);
      if (!savedRefresh) {
        // No refresh token stored — nothing to try, force logout immediately.
        _onForceLogout?.();
        return Promise.reject("Session expired. Please log in again.");
      }

      // If another refresh is already in flight, queue this request and wait.
      if (_isRefreshing) {
        return new Promise((resolve, reject) =>
          _pendingQueue.push({ resolve, reject }),
        ).then((newToken) => {
          original.headers["Authorization"] = `Bearer ${newToken}`;
          return apiClient(original);
        });
      }

      _isRefreshing = true;

      try {
        // Use raw fetch so this call is never caught by the Axios interceptor,
        // preventing an infinite 401 → refresh → 401 loop.
        const baseUrl  = apiClient.defaults.baseURL ?? "";
        const response = await fetch(`${baseUrl}/api/rpc`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            method: "refresh_token",
            params: { refresh_token: savedRefresh },
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) throw new Error(`Refresh HTTP ${response.status}`);
        const data     = await response.json();
        const newToken = data.access_token;

        // Update the Axios default header and persist the new refresh token.
        setAuthToken(newToken);
        localStorage.setItem(STORED_REFRESH_KEY, data.refresh_token);

        // Let the auth store update Zustand state + reschedule the timer.
        _onRefreshed?.(data);

        drainQueue(null, newToken);

        // Retry the original failed request with the fresh token.
        original.headers["Authorization"] = `Bearer ${newToken}`;
        return apiClient(original);
      } catch {
        drainQueue(new Error("Session expired"), null);
        _onForceLogout?.();
        return Promise.reject("Session expired. Please log in again.");
      } finally {
        _isRefreshing = false;
      }
    }

    // ── Normalize all other errors to a plain string ──────────────────────────
    const msg =
      err.response?.data?.error
      ?? err.response?.data
      ?? err.message
      ?? "Request failed";
    return Promise.reject(typeof msg === "string" ? msg : JSON.stringify(msg));
  },
);

// ── RPC helper ────────────────────────────────────────────────────────────────
// Wraps the /api/rpc endpoint. The token (if any) is automatically included via
// the Authorization header set in apiClient.defaults.
export async function rpc(method, params = {}) {
  const { data } = await apiClient.post("/api/rpc", { method, params });
  return data;
}

// ── Base URL helpers (called from App.jsx) ────────────────────────────────────
export function setApiBaseUrl(url) {
  apiClient.defaults.baseURL = url;
}

/**
 * Returns true once setApiBaseUrl() has been called (i.e. the DB is connected
 * and the HTTP server is listening). Used as the `enabled` flag in queries
 * that must not fire during the splash / setup / login screens.
 */
export function isApiReady() {
  return !!apiClient.defaults.baseURL;
}

export function setAuthToken(token) {
  if (token) {
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete apiClient.defaults.headers.common["Authorization"];
  }
}
