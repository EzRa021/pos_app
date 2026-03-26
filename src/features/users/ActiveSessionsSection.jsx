// features/users/ActiveSessionsSection.jsx
// Shows every live session from active_sessions and lets admins force-revoke any of them.
import { useState } from "react";
import {
  Monitor, Wifi, Clock, MapPin, User, LogOut,
  RefreshCw, ShieldAlert, AlertTriangle,
} from "lucide-react";

import { Button }        from "@/components/ui/button";
import { Badge }         from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

import { useAuthStore }         from "@/stores/auth.store";
import { useBranchStore }       from "@/stores/branch.store";
import { usePermission }        from "@/hooks/usePermission";
import { formatDateTime }       from "@/lib/format";
import { cn }                   from "@/lib/utils";

import { useActiveSessions, useRevokeSession } from "./useActiveSessions";

// ─────────────────────────────────────────────────────────────────────────────
export function ActiveSessionsSection() {
  const currentUser = useAuthStore((s) => s.user);
  const storeId     = useBranchStore((s) => s.activeStore?.id);
  const isGlobal    = currentUser?.is_global;
  const canRevoke   = usePermission("users.update");

  // Pass storeId for non-global users so they only see their store's sessions
  const { data: sessions = [], isLoading, isFetching, refetch, isError, error } =
    useActiveSessions(isGlobal ? null : storeId ?? null);

  const revoke = useRevokeSession();

  // Confirm dialog state
  const [confirmSession, setConfirmSession] = useState(null); // session obj | null

  const handleRevoke = async () => {
    if (!confirmSession) return;
    await revoke.mutateAsync(confirmSession.id);
    setConfirmSession(null);
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const now          = new Date();
  const activeSessions = sessions.filter((s) => new Date(s.expires_at) > now);
  const uniqueUsers    = new Set(activeSessions.map((s) => s.user_id)).size;

  // ── Empty / error states ──────────────────────────────────────────────────
  const headerAction = (
    <Button
      variant="ghost" size="sm"
      onClick={() => refetch()}
      disabled={isFetching}
      className="h-7 gap-1.5 text-[11px] text-muted-foreground"
    >
      <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
      Refresh
    </Button>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Section wrapper ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Active Sessions
            </h2>
            {activeSessions.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-success/15 border border-success/25 px-2 py-0.5 text-[10px] font-bold text-success">
                {activeSessions.length} live
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:block">
              {uniqueUsers} unique user{uniqueUsers !== 1 ? "s" : ""}
            </span>
            {headerAction}
          </div>
        </div>

        {/* Body */}
        <div className="p-5">
          {isLoading ? (
            <LoadingRows />
          ) : isError ? (
            <ErrorState message={typeof error === "string" ? error : (error?.message ?? "Unknown error")} onRetry={refetch} />
          ) : activeSessions.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto -mx-5 -mb-5">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/10">
                    <Th className="pl-5 w-[200px]">User</Th>
                    <Th className="w-[130px]">Device / IP</Th>
                    <Th className="w-[155px]">Started</Th>
                    <Th className="w-[155px]">Last Active</Th>
                    <Th className="w-[155px]">Expires</Th>
                    {canRevoke && <Th className="w-[80px] pr-4 text-right">Action</Th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {activeSessions.map((s) => {
                    const isCurrentUser = s.user_id === currentUser?.id;
                    const expiresAt     = new Date(s.expires_at);
                    const soonExpires   = (expiresAt - now) < 15 * 60 * 1000; // <15 min
                    return (
                      <tr
                        key={s.id}
                        className={cn(
                          "group transition-colors duration-100",
                          isCurrentUser ? "bg-primary/[0.03]" : "hover:bg-muted/20",
                        )}
                      >
                        {/* User cell */}
                        <td className="pl-5 pr-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 border border-border/60">
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[12px] font-semibold text-foreground flex items-center gap-1.5 truncate">
                                {s.username ?? `User #${s.user_id}`}
                                {isCurrentUser && (
                                  <span className="text-[9px] font-bold text-primary/70 bg-primary/10 rounded-full px-1.5 py-0.5 shrink-0">
                                    You
                                  </span>
                                )}
                              </p>
                              {s.store_id && (
                                <p className="text-[10px] text-muted-foreground">Store #{s.store_id}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Device / IP */}
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-0.5">
                            {s.device_info ? (
                              <span className="flex items-center gap-1 text-[11px] text-foreground">
                                <Monitor className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span className="truncate max-w-[100px]">{s.device_info}</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground/50 italic">
                                <Monitor className="h-3 w-3 shrink-0" /> Desktop app
                              </span>
                            )}
                            {s.ip_address ? (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Wifi className="h-2.5 w-2.5 shrink-0" />
                                {s.ip_address}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/40 italic">Local</span>
                            )}
                          </div>
                        </td>

                        {/* Started */}
                        <td className="px-3 py-3 text-[11px] text-muted-foreground tabular-nums">
                          {formatDateTime(s.created_at)}
                        </td>

                        {/* Last active */}
                        <td className="px-3 py-3 text-[11px] text-muted-foreground tabular-nums">
                          {formatDateTime(s.last_seen_at)}
                        </td>

                        {/* Expires */}
                        <td className="px-3 py-3">
                          <span className={cn(
                            "flex items-center gap-1 text-[11px] tabular-nums",
                            soonExpires ? "text-warning font-medium" : "text-muted-foreground",
                          )}>
                            {soonExpires && <Clock className="h-3 w-3 shrink-0" />}
                            {formatDateTime(s.expires_at)}
                          </span>
                        </td>

                        {/* Revoke */}
                        {canRevoke && (
                          <td className="px-3 pr-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={revoke.isPending}
                              onClick={() => setConfirmSession(s)}
                              className={cn(
                                "h-7 gap-1 text-[10px] px-2 transition-colors",
                                isCurrentUser
                                  ? "text-muted-foreground/40 cursor-not-allowed"
                                  : "text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100",
                              )}
                              title={isCurrentUser ? "Cannot revoke your own session" : "Force logout this session"}
                            >
                              <LogOut className="h-3 w-3" />
                              Revoke
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Confirm revoke dialog ──────────────────────────────────────────── */}
      <Dialog open={!!confirmSession} onOpenChange={(v) => !v && setConfirmSession(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10">
                <ShieldAlert className="h-4 w-4 text-destructive" />
              </div>
              Revoke Session
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed mt-2">
              This will immediately force{" "}
              <span className="font-semibold text-foreground">
                {confirmSession?.username ?? `User #${confirmSession?.user_id}`}
              </span>{" "}
              to log out. They will need to sign in again to continue.
            </DialogDescription>
          </DialogHeader>

          {confirmSession && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5 text-[11px] text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 shrink-0" />
                Started: {formatDateTime(confirmSession.created_at)}
              </p>
              {confirmSession.ip_address && (
                <p className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 shrink-0" />
                  IP: {confirmSession.ip_address}
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setConfirmSession(null)} className="text-[12px]">
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRevoke}
              disabled={revoke.isPending}
              className="gap-1.5 text-[12px]"
            >
              <LogOut className="h-3.5 w-3.5" />
              {revoke.isPending ? "Revoking…" : "Revoke Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Micro sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Th({ children, className }) {
  return (
    <th className={cn(
      "px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
      className,
    )}>
      {children}
    </th>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2 animate-pulse">
          <div className="h-8 w-8 rounded-lg bg-muted/50" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded bg-muted/50" />
            <div className="h-2.5 w-20 rounded bg-muted/40" />
          </div>
          <div className="h-3 w-24 rounded bg-muted/40" />
          <div className="h-3 w-24 rounded bg-muted/40" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/30">
        <Wifi className="h-5 w-5 text-muted-foreground/30" />
      </div>
      <p className="text-[13px] font-semibold text-muted-foreground">No active sessions</p>
      <p className="text-[11px] text-muted-foreground/60">
        Sessions appear here when users are logged in.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
      <AlertTriangle className="h-6 w-6 text-destructive/60" />
      <p className="text-[13px] font-semibold text-destructive">Failed to load sessions</p>
      <p className="text-[11px] text-muted-foreground max-w-xs">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5 text-[12px]">
        <RefreshCw className="h-3 w-3" /> Retry
      </Button>
    </div>
  );
}
