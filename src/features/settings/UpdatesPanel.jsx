// ============================================================================
// features/settings/UpdatesPanel.jsx
// ============================================================================
// Manual "Check for updates" — surfaces real errors (unlike the silent
// startup check in useAppUpdater), since a user here explicitly asked.
// ============================================================================

import { RefreshCw, Loader2, CheckCircle2, AlertCircle, Download, Rocket } from "lucide-react";
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { Button } from "@/components/ui/button";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

export function UpdatesPanel() {
  const { status, updateInfo, progress, error, checkForUpdates, installNow } = useAppUpdater();
  const [currentVersion, setCurrentVersion] = useState(null);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border bg-muted/20">
          <Rocket className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            App Updates
          </h3>
        </div>

        <div className="p-4 space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Current version</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Zera {currentVersion ? `v${currentVersion}` : "…"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={status === "checking" || status === "downloading"}
              onClick={() => checkForUpdates(false)}
            >
              {status === "checking" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Check for updates
                </>
              )}
            </Button>
          </div>

          {status === "downloading" && (
            <div className="rounded-lg border border-primary/25 bg-primary/8 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-primary">
                <Download className="h-3.5 w-3.5" />
                Downloading update… {progress}%
              </div>
              <div className="h-1.5 w-full rounded-full bg-primary/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {status === "ready" && updateInfo && (
            <div className="rounded-lg border border-primary/25 bg-primary/8 px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-primary">
                  Update ready — v{updateInfo.version}
                </p>
                <p className="text-[11px] text-primary/70 mt-0.5">
                  Restart to install. Won't interrupt an open shift.
                </p>
              </div>
              <Button size="sm" className="h-8 text-xs shrink-0" onClick={installNow}>
                Restart now
              </Button>
            </div>
          )}

          {status === "up-to-date" && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              You're on the latest version.
            </div>
          )}

          {status === "error" && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Couldn't check for updates{error ? `: ${error}` : "."} Try again, or check your connection.</span>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Zera checks for updates automatically shortly after launch and downloads
            them quietly in the background. You'll only see a prompt once an update is fully
            downloaded and ready — installing never interrupts a sale in progress.
          </p>
        </div>
      </div>
    </div>
  );
}
