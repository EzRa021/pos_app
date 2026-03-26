// ============================================================================
// TitleBar.jsx — Custom Tauri Window Chrome
// ============================================================================
// Replaces OS decorations (decorations: false in tauri.conf.json).
//
// Layout (left → right):
//   [Q logo + App name]   [drag region / clock]   [min · max · close]
//
// Drag: the entire bar is a drag region via data-tauri-drag-region.
//       Buttons are excluded via the global CSS rule in index.css.
//
// Window state: isMaximized is polled on mount and on the window's
//               resize/move events so the restore icon updates correctly.
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import { getCurrentWindow }                 from "@tauri-apps/api/window";
import { Minus, X, Maximize2, Minimize2, Search } from "lucide-react";
import { useUiStore }        from "@/stores/ui.store";
import { cn }                from "@/lib/utils";
import { SyncStatusBadge }  from "@/components/shared/SyncStatusBadge";

// ── Live clock ────────────────────────────────────────────────────────────────
function Clock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hh = time.getHours().toString().padStart(2, "0");
  const mm = time.getMinutes().toString().padStart(2, "0");
  const ss = time.getSeconds().toString().padStart(2, "0");
  const dateStr = time.toLocaleDateString("en-NG", {
    weekday: "short",
    month:   "short",
    day:     "numeric",
  });

  return (
    <div className="flex items-center gap-2 select-none">
      <span className="text-[11px] text-muted-foreground/60 font-normal tracking-wide">
        {dateStr}
      </span>
      <div className="h-3 w-px bg-border/60" />
      <span className="font-mono text-[13px] font-semibold text-foreground/80 tabular-nums tracking-widest">
        {hh}<span className="opacity-50 animate-pulse">:</span>{mm}
        <span className="text-[11px] text-muted-foreground font-normal ml-0.5">{ss}</span>
      </span>
    </div>
  );
}

// ── Window control button ─────────────────────────────────────────────────────
function WinBtn({ onClick, label, className, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "group flex h-full w-10 items-center justify-center",
        "text-muted-foreground/70 transition-all duration-100",
        "hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── SearchTrigger ────────────────────────────────────────────────────────────
// Clickable badge in the title bar that opens the command palette.
// Hidden in icon-only / narrow layouts via `hidden sm:flex`.
function SearchTrigger() {
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const isMac   = typeof navigator !== "undefined"
    && navigator.platform.toUpperCase().includes("MAC");

  return (
    <button
      onClick={() => setOpen(true)}
      className={cn(
        "hidden sm:flex items-center gap-1.5 shrink-0",
        "rounded-md border border-border/50 bg-muted/30 px-2 py-1",
        "text-[11px] text-muted-foreground/60 hover:text-muted-foreground",
        "hover:bg-muted/60 hover:border-border/80 transition-colors duration-100",
      )}
      tabIndex={-1}
    >
      <Search className="h-3 w-3" />
      <span>Search</span>
      <kbd className="ml-1 rounded border border-border/50 bg-muted px-1 py-px font-mono text-[9px] leading-none">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}

// ── TitleBar ──────────────────────────────────────────────────────────────────
export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  // Sync maximized state on mount and whenever the window is resized
  const syncMaximized = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      setIsMaximized(await win.isMaximized());
    } catch { /* ignore — window not ready yet */ }
  }, []);

  useEffect(() => {
    syncMaximized();
    // Re-check maximized state on every browser resize event.
    // This covers both maximize and restore without needing Tauri’s onResized
    // permission (which doesn’t exist in this version).
    window.addEventListener("resize", syncMaximized);
    return () => window.removeEventListener("resize", syncMaximized);
  }, [syncMaximized]);

  async function minimize() {
    await getCurrentWindow().minimize();
  }
  async function toggleMaximize() {
    await getCurrentWindow().toggleMaximize();
    syncMaximized();
  }
  async function close() {
    await getCurrentWindow().close();
  }

  return (
    <div
      className={cn(
        // Base: exactly 36px tall, full width, sits on top of everything
        "flex h-9 w-full shrink-0 items-center",
        // Surface: card bg + very subtle bottom border
        "bg-card border-b border-border/60",
        // Entire bar is a drag region (buttons opt out via CSS)
        "select-none",
      )}
      data-tauri-drag-region
    >

      {/* ── LEFT: Brand ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-3 min-w-0 flex-1"
        data-tauri-drag-region
      >
        {/* Q logo chip */}
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary shadow-sm shadow-primary/20">
          <span className="text-[10px] font-black leading-none text-white select-none">Q</span>
        </div>

        {/* App name */}
        <span className="text-[12px] font-semibold text-foreground/90 leading-none tracking-tight truncate">
          Quantum POS
        </span>

        {/* Search trigger badge */}
        <SearchTrigger />
      </div>

      {/* ── CENTRE: Sync badge + Clock (drag region) ─────────────────────── */}
      <div
        className="flex items-center justify-center gap-3 flex-shrink-0"
        data-tauri-drag-region
      >
        <SyncStatusBadge />
        <Clock />
      </div>

      {/* ── RIGHT: spacer + Window controls ─────────────────────────────── */}
      <div className="flex items-center flex-1 justify-end">
        {/* Decorative dot row — subtle, professional accent */}
        <div className="hidden md:flex items-center gap-1.5 mr-3" data-tauri-drag-region>
          <div className="h-1.5 w-1.5 rounded-full bg-border/80" />
          <div className="h-1.5 w-1.5 rounded-full bg-border/50" />
          <div className="h-1.5 w-1.5 rounded-full bg-border/30" />
        </div>

        {/* Divider before buttons */}
        <div className="h-4 w-px bg-border/40 mr-0.5" data-tauri-drag-region />

        {/* Minimize */}
        <WinBtn
          onClick={minimize}
          label="Minimize"
          className="hover:bg-muted/80"
        >
          <Minus className="h-3.5 w-3.5" />
        </WinBtn>

        {/* Maximize / Restore */}
        <WinBtn
          onClick={toggleMaximize}
          label={isMaximized ? "Restore" : "Maximize"}
          className="hover:bg-muted/80"
        >
          {isMaximized
            ? <Minimize2 className="h-3 w-3" />
            : <Maximize2 className="h-3 w-3" />
          }
        </WinBtn>

        {/* Close — red on hover */}
        <WinBtn
          onClick={close}
          label="Close"
          className="hover:bg-destructive hover:text-white rounded-none"
        >
          <X className="h-3.5 w-3.5" />
        </WinBtn>
      </div>
    </div>
  );
}
