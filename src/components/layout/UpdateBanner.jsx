// ============================================================================
// UpdateBanner — small, non-blocking toast that appears bottom-right once a
// new version has been silently downloaded and verified. Never appears
// mid-check/mid-download — only when it's ready to install, so it never
// nags the cashier about progress they don't care about.
// ============================================================================

import { Download, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { useAppUpdater } from '@/hooks/useAppUpdater';
import { Button } from '@/components/ui/button';

export function UpdateBanner() {
  const { status, updateInfo, installNow } = useAppUpdater();
  const [dismissed, setDismissed] = useState(false);

  if (status !== 'ready' || dismissed || !updateInfo) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-[320px] rounded-xl border border-border bg-card shadow-2xl shadow-black/40 p-4 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 border border-primary/20">
          <Download className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Update ready — v{updateInfo.version}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Installs on restart. Won't interrupt an open shift.
          </p>
          <div className="flex gap-2 mt-3">
            <Button size="sm" className="h-8 text-xs" onClick={installNow}>
              <RefreshCw className="h-3 w-3" />
              Restart & Update
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setDismissed(true)}
            >
              Later
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
