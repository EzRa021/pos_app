// ============================================================================
// KeyboardHelp — modal listing all keyboard shortcuts
// ============================================================================
// Triggered by pressing ? anywhere in the shell.
// ============================================================================

import { useEffect } from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUiStore } from "@/stores/ui.store";

const isMac = () =>
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().includes("MAC");

const SHORTCUTS = [
  {
    group: "Navigation",
    items: [
      { keys: [isMac() ? "⌘" : "Ctrl", "K"], label: "Command palette" },
      { keys: ["?"],                           label: "Show keyboard shortcuts" },
      { keys: ["Esc"],                         label: "Close dialog / modal" },
    ],
  },
  {
    group: "Point of Sale",
    items: [
      { keys: ["F2"],   label: "Open new sale (POS)" },
      { keys: ["Enter"], label: "Confirm dialog" },
    ],
  },
];

function Key({ children }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded border border-border bg-muted text-[10px] font-mono font-semibold text-foreground">
      {children}
    </kbd>
  );
}

export function KeyboardHelp() {
  const isOpen      = useUiStore((s) => s.activeModal === "keyboard-help");
  const openModal   = useUiStore((s) => s.openModal);
  const closeModal  = useUiStore((s) => s.closeModal);

  // Register ? shortcut globally (only when no input/textarea is focused)
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key !== "?" ) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      openModal("keyboard-help");
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openModal]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
              <Keyboard className="h-3.5 w-3.5 text-primary" />
            </div>
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {SHORTCUTS.map((section) => (
            <div key={section.group}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                {section.group}
              </p>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4">
                    <span className="text-xs text-foreground">{item.label}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k, i) => (
                        <Key key={i}>{k}</Key>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground pt-2 border-t border-border">
          Press <Key>Esc</Key> to close
        </p>
      </DialogContent>
    </Dialog>
  );
}
