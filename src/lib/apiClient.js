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

// ── Error interceptor ─────────────────────────────────────────────────────────
// Normalize HTTP error responses so callers always get a plain string message.
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg =
      err.response?.data?.error   // our { error: "..." } shape
      ?? err.response?.data       // plain string body
      ?? err.message              // network / timeout
      ?? "Request failed";
    return Promise.reject(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
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
