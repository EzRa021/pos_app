// ============================================================================
// features/settings/security-utils.js — shared security helpers
// Extracted from SecuritySettingsPanel so non-component code lives in a
// plain .js file and doesn't break Vite's Fast Refresh on the panel.
// ============================================================================

export const AUTO_LOCK_KEY = "qpos_lock_timeout_min";

/**
 * Get the current auto-lock timeout value, seeding the default if the key
 * doesn't exist yet. Called on PosPage startup AND in SecuritySettingsPanel
 * so they are always in sync from the first launch.
 *
 * Default is "0" (Never) — the safe choice on a fresh terminal where the
 * cashier hasn't set a PIN yet.
 */
export function getAutoLockMinutes() {
  const stored = localStorage.getItem(AUTO_LOCK_KEY);
  if (stored === null) {
    // Seed the default so PosPage and SecuritySettingsPanel always agree
    localStorage.setItem(AUTO_LOCK_KEY, "0");
    return 0;
  }
  return parseInt(stored, 10);
}
