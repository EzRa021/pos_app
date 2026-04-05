// ============================================================================
// lib/theme.js — Apply per-branch theme + accent colour to <html>
// ============================================================================
// Called by branch.store.js whenever the active store changes, and by
// AppearancePanel after the user saves new preferences.
//
// Strategy:
//   • "dark"  → <html class="dark">   — dark CSS token set
//   • "light" → <html class="">       — light CSS token set (default :root)
//   • accent  → inline CSS vars on <html> override --primary / --ring /
//               --sidebar-primary / --sidebar-ring for the chosen colour.
// ============================================================================

/**
 * All supported accent colour keys with:
 *   label        — display name
 *   hex          — swatch hex (for preview UI only)
 *   primary      — oklch value injected into --primary / --ring / --sidebar-*
 *   foreground   — oklch value for --primary-foreground (always white here)
 */
export const ACCENT_COLORS = {
  blue: {
    label:      "Blue",
    hex:        "#3b82f6",
    primary:    "oklch(0.623 0.214 259.8)",
    foreground: "oklch(0.985 0.000 0)",
  },
  indigo: {
    label:      "Indigo",
    hex:        "#6366f1",
    primary:    "oklch(0.585 0.215 277.1)",
    foreground: "oklch(0.985 0.000 0)",
  },
  violet: {
    label:      "Violet",
    hex:        "#8b5cf6",
    primary:    "oklch(0.592 0.220 295.5)",
    foreground: "oklch(0.985 0.000 0)",
  },
  rose: {
    label:      "Rose",
    hex:        "#f43f5e",
    primary:    "oklch(0.644 0.246 16.4)",
    foreground: "oklch(0.985 0.000 0)",
  },
  pink: {
    label:      "Pink",
    hex:        "#ec4899",
    primary:    "oklch(0.656 0.241 350.5)",
    foreground: "oklch(0.985 0.000 0)",
  },
  orange: {
    label:      "Orange",
    hex:        "#f97316",
    primary:    "oklch(0.645 0.213 47.6)",
    foreground: "oklch(0.985 0.000 0)",
  },
  emerald: {
    label:      "Emerald",
    hex:        "#10b981",
    primary:    "oklch(0.696 0.171 162.5)",
    foreground: "oklch(0.985 0.000 0)",
  },
  teal: {
    label:      "Teal",
    hex:        "#14b8a6",
    primary:    "oklch(0.680 0.132 182.5)",
    foreground: "oklch(0.985 0.000 0)",
  },
  cyan: {
    label:      "Cyan",
    hex:        "#06b6d4",
    primary:    "oklch(0.686 0.126 200.0)",
    foreground: "oklch(0.985 0.000 0)",
  },
};

/**
 * Apply the given theme and accent colour to the document root.
 *
 * @param {"dark"|"light"|string} theme
 * @param {string} [accentColor="blue"]  — key from ACCENT_COLORS
 */
export function applyTheme(theme, accentColor = "blue") {
  const root = document.documentElement;

  // ── 1. Dark / light class ─────────────────────────────────────────────────
  if (theme === "light") {
    root.classList.remove("dark");
  } else {
    root.classList.add("dark");
  }
  // Sync native window background to avoid paint flash on startup
  root.style.background = theme === "light" ? "#f8f8fa" : "#09090b";

  // ── 2. Accent colour — override CSS custom properties inline ─────────────
  // Inline styles beat any :root / .dark rule in the cascade, so this
  // works immediately for both themes without duplicating token sets.
  const accent = ACCENT_COLORS[accentColor] ?? ACCENT_COLORS.blue;
  root.style.setProperty("--primary",                    accent.primary);
  root.style.setProperty("--primary-foreground",         accent.foreground);
  root.style.setProperty("--ring",                       accent.primary);
  root.style.setProperty("--sidebar-primary",            accent.primary);
  root.style.setProperty("--sidebar-primary-foreground", accent.foreground);
  root.style.setProperty("--sidebar-ring",               accent.primary);
}
