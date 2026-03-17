// features/users/UserDetailPanel.jsx
// Slide-in drawer showing full user profile + password reset + toggle status
import { useState } from "react";
import {
  Mail, Phone, Shield, Store, Calendar, Clock,
  KeyRound, Power, PowerOff, Pencil, Eye, EyeOff, Loader2,
  CheckCircle2, XCircle, LogIn, Hash,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { cn }       from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { getRoleConfig, getInitials } from "./roleConfig";

export function UserDetailPanel({ open, onOpenChange, user, onEdit, onActivate, onDeactivate, onResetPassword, currentUserId, canUpdate }) {
  const [showResetForm, setShowResetForm]       = useState(false);
  const [newPass, setNewPass]                   = useState("");
  const [confirmPass, setConfirmPass]           = useState("");
  const [showPass, setShowPass]                 = useState(false);
  const [passError, setPassError]               = useState("");
  const [isResetting, setIsResetting]           = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  const rc       = user ? getRoleConfig(user.role_slug) : null;
  const initials = user ? getInitials(user)             : "";
  const fullName = user
    ? ([user.first_name, user.last_name].filter(Boolean).join(" ") || user.username)
    : "";
  const isSelf   = user?.id === currentUserId;
  const isActive = user?.is_active;

  const handleResetSubmit = async () => {
    if (newPass.length < 8) { setPassError("Minimum 8 characters"); return; }
    if (newPass !== confirmPass) { setPassError("Passwords do not match"); return; }
    setPassError("");
    setIsResetting(true);
    try {
      await onResetPassword(user.id, newPass);
      setShowResetForm(false);
      setNewPass("");
      setConfirmPass("");
    } finally {
      setIsResetting(false);
    }
  };

  const handleToggleActive = async () => {
    setIsTogglingActive(true);
    try {
      if (isActive) await onDeactivate(user.id);
      else          await onActivate(user.id);
    } finally {
      setIsTogglingActive(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[400px] sm:w-[420px] p-0 flex flex-col bg-card border-l border-border"
      >
        {/* Visually hidden title for accessibility */}
        <SheetHeader className="sr-only">
          <SheetTitle>User Profile</SheetTitle>
          <SheetDescription>View and manage user account details</SheetDescription>
        </SheetHeader>

        {/* ── Drawer header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card/80 shrink-0">
          <h3 className="text-[13px] font-bold text-foreground">User Profile</h3>
        </div>

        {!user ? null : (
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* ── Avatar + name card ────────────────────────────────── */}
            <div className="px-5 pt-6 pb-4">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className={cn(
                  "relative flex h-20 w-20 items-center justify-center rounded-2xl text-2xl font-bold shadow-lg",
                  rc.avatar,
                )}>
                  {initials}
                  <span className={cn(
                    "absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-card",
                    isActive ? "bg-success" : "bg-muted-foreground/40"
                  )} />
                </div>

                <div>
                  <p className="text-[15px] font-bold text-foreground leading-tight">{fullName}</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">@{user.username}</p>
                </div>

                <span className={cn("rounded-full border px-3 py-1 text-[11px] font-semibold", rc.badge)}>
                  <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1.5 mb-px", rc.dot)} />
                  {user.role_name}
                </span>

                <span className={cn(
                  "flex items-center gap-1.5 text-[11px] font-medium rounded-full px-3 py-1",
                  isActive
                    ? "bg-success/10 text-success border border-success/20"
                    : "bg-destructive/10 text-destructive border border-destructive/20"
                )}>
                  {isActive
                    ? <><CheckCircle2 className="h-3 w-3" /> Active</>
                    : <><XCircle     className="h-3 w-3" /> Inactive</>
                  }
                </span>
              </div>
            </div>

            {/* ── Details ───────────────────────────────────────────── */}
            <div className="px-5 space-y-1 pb-4">
              <DetailRow icon={Hash}     label="User ID">{user.id}</DetailRow>
              <DetailRow icon={Mail}     label="Email">{user.email}</DetailRow>
              <DetailRow icon={Phone}    label="Phone">{user.phone ?? "—"}</DetailRow>
              <DetailRow icon={Shield}   label="Role">{user.role_name}</DetailRow>
              <DetailRow icon={Store}    label="Store">{user.store_name ?? "All Stores"}</DetailRow>
              <DetailRow icon={Calendar} label="Joined">{user.created_at ? formatDateTime(user.created_at) : "—"}</DetailRow>
              <DetailRow icon={LogIn}    label="Last Login">{user.last_login ? formatDateTime(user.last_login) : "Never"}</DetailRow>
              <DetailRow icon={Clock}    label="Updated">{user.updated_at ? formatDateTime(user.updated_at) : "—"}</DetailRow>
            </div>

            <div className="mx-5 border-t border-border/50" />

            {/* ── Password reset section ────────────────────────────── */}
            {canUpdate && (
              <div className="px-5 pt-4 pb-4">
                <button
                  onClick={() => setShowResetForm((p) => !p)}
                  className="flex items-center justify-between w-full group"
                >
                  <span className="flex items-center gap-2 text-[12px] font-semibold text-foreground/80 group-hover:text-foreground transition-colors">
                    <KeyRound className="h-3.5 w-3.5 text-primary" />
                    Reset Password
                  </span>
                  <span className={cn(
                    "text-[10px] font-medium rounded-full px-2 py-0.5 transition-colors",
                    showResetForm
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                  )}>
                    {showResetForm ? "Cancel" : "Set new"}
                  </span>
                </button>

                {showResetForm && (
                  <div className="mt-3 space-y-2.5">
                    <div className="relative">
                      <Input
                        type={showPass ? "text" : "password"}
                        placeholder="New password (min 8 chars)"
                        value={newPass}
                        onChange={(e) => { setNewPass(e.target.value); setPassError(""); }}
                        className="h-9 text-[12px] pr-8 bg-background/50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((p) => !p)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <Input
                      type={showPass ? "text" : "password"}
                      placeholder="Confirm new password"
                      value={confirmPass}
                      onChange={(e) => { setConfirmPass(e.target.value); setPassError(""); }}
                      className="h-9 text-[12px] bg-background/50"
                    />
                    {passError && (
                      <p className="text-[10px] text-destructive">{passError}</p>
                    )}
                    <Button
                      size="sm" className="w-full gap-1.5"
                      onClick={handleResetSubmit}
                      disabled={isResetting || !newPass}
                    >
                      {isResetting && <Loader2 className="h-3 w-3 animate-spin" />}
                      Confirm Reset
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="mx-5 border-t border-border/50" />

            {/* ── Actions ───────────────────────────────────────────── */}
            <div className="px-5 pt-4 pb-6 space-y-2">
              {canUpdate && (
                <Button
                  variant="outline" size="sm"
                  className="w-full gap-2 justify-start text-[12px]"
                  onClick={() => onEdit(user)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Profile
                </Button>
              )}

              {canUpdate && !isSelf && (
                <Button
                  variant="outline" size="sm"
                  className={cn(
                    "w-full gap-2 justify-start text-[12px] transition-colors",
                    isActive
                      ? "border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive"
                      : "border-success/30 text-success hover:bg-success/10 hover:border-success"
                  )}
                  onClick={handleToggleActive}
                  disabled={isTogglingActive}
                >
                  {isTogglingActive
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : isActive
                      ? <PowerOff className="h-3.5 w-3.5" />
                      : <Power    className="h-3.5 w-3.5" />
                  }
                  {isActive ? "Deactivate Account" : "Activate Account"}
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DetailRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/30">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <span className="text-[11px] text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="text-[12px] font-medium text-foreground truncate">{children}</span>
    </div>
  );
}
