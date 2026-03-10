// ============================================================================
// components/shared/ConfirmDialog.jsx
// ============================================================================
// Reusable destructive-action confirmation modal.
// Forces a conscious decision before irreversible operations (void, delete, etc.)
//
// Props:
//   open          boolean
//   onOpenChange  (open: boolean) => void
//   title         string             — "Void Transaction?"
//   description   string             — Explains consequences
//   confirmLabel  string             — default: "Confirm"
//   cancelLabel   string             — default: "Cancel"
//   variant       "destructive"|"warning"  — default: "destructive"
//   onConfirm     () => void | Promise<void>
//   isLoading     boolean            — shows spinner on confirm button
//
// Design: heavy red/amber visual weight, icon, tightly focused layout.
// The confirm button is always on the right and visually dominant.
// ============================================================================

import { useState }  from "react";
import { AlertTriangle, Trash2, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn }     from "@/lib/utils";

const VARIANT_CONFIG = {
  destructive: {
    icon:      Trash2,
    iconBg:    "bg-destructive/10 border-destructive/20",
    iconColor: "text-destructive",
    btnVariant: "destructive",
    stripColor: "bg-destructive",
  },
  warning: {
    icon:      AlertTriangle,
    iconBg:    "bg-warning/10 border-warning/20",
    iconColor: "text-warning",
    btnVariant: "default",
    stripColor: "bg-warning",
  },
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel  = "Cancel",
  variant      = "destructive",
  onConfirm,
  isLoading    = false,
}) {
  const [internalLoading, setInternalLoading] = useState(false);
  const config  = VARIANT_CONFIG[variant] ?? VARIANT_CONFIG.destructive;
  const Icon    = config.icon;
  const loading = isLoading || internalLoading;

  async function handleConfirm() {
    if (!onConfirm) return;
    setInternalLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Error handling is the caller's responsibility
    } finally {
      setInternalLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-sm border-border bg-card p-0 overflow-hidden",
          "shadow-2xl shadow-black/60"
        )}
      >
        {/* Accent strip */}
        <div className={cn("h-1 w-full", config.stripColor, "opacity-80")} />

        <div className="px-6 pb-6 pt-5">
          <DialogHeader>
            <div className="flex items-start gap-4 mb-1">
              {/* Icon */}
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border mt-0.5",
                  config.iconBg
                )}
              >
                <Icon className={cn("h-5 w-5", config.iconColor)} />
              </div>

              <div className="flex-1 min-w-0">
                <DialogTitle className="text-[15px] font-bold text-foreground leading-snug">
                  {title}
                </DialogTitle>
                {description && (
                  <DialogDescription className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                    {description}
                  </DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>

          <DialogFooter className="mt-5 flex gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="flex-1"
            >
              {cancelLabel}
            </Button>
            <Button
              variant={config.btnVariant}
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working…
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
