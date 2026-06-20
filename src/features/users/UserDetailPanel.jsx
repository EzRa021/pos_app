// features/users/UserDetailPanel.jsx
// Modern enterprise-style slide-in drawer for viewing & managing a user account.
// Sections: Header (avatar/name/role/status + quick actions) → Activity Overview
// (real stats from get_user_activity) → Personal / Account / Security info cards
// → contextual forms (reset password, POS PIN) → Footer (Edit / Full Profile / Close).
import { useState, useRef, useEffect } from "react";
import {
  Mail, Phone, Shield, Store, Calendar, Clock,
  KeyRound, Power, PowerOff, Pencil, Eye, EyeOff, Loader2,
  CheckCircle2, XCircle, LogIn, Hash, Lock, MapPin, User as UserIcon,
  ShieldCheck, ShieldAlert, ReceiptText, Banknote, PackagePlus,
  Undo2, ExternalLink, AlertTriangle, RefreshCw, ChevronRight,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn }       from "@/lib/utils";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { getRoleConfig } from "./roleConfig";
import { setPosPin }     from "@/commands/security";
import { useUserActivity } from "./useUsers";
import UserAvatar         from "@/components/shared/UserAvatar";
import { AvatarUploader } from "./AvatarUploader";

export function UserDetailPanel({
  open, onOpenChange, user, onEdit, onActivate, onDeactivate,
  onResetPassword, onViewFullProfile, onDelete, currentUserId, canUpdate, canDelete,
}) {
  const [showResetForm, setShowResetForm]       = useState(false);
  const [newPass, setNewPass]                   = useState("");
  const [confirmPass, setConfirmPass]           = useState("");
  const [showPass, setShowPass]                 = useState(false);
  const [passError, setPassError]               = useState("");
  const [isResetting, setIsResetting]           = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  // ── POS PIN state (self only) ────────────────────────────────────────────
  const [showPinForm, setShowPinForm] = useState(false);
  const [newPin,      setNewPin]      = useState("");
  const [pinConfirm,  setPinConfirm]  = useState("");
  const [pinError,    setPinError]    = useState("");
  const [pinDone,     setPinDone]     = useState(false);
  const [isSavingPin, setIsSavingPin] = useState(false);

  const handlePinSave = async () => {
    setPinError("");
    if (!/^\d{4}$/.test(newPin)) { setPinError("PIN must be exactly 4 digits."); return; }
    if (newPin !== pinConfirm)    { setPinError("PINs do not match."); return; }
    setIsSavingPin(true);
    try {
      await setPosPin(newPin);
      setPinDone(true);
      setNewPin(""); setPinConfirm(""); setShowPinForm(false);
      setTimeout(() => setPinDone(false), 3000);
    } catch (e) {
      setPinError(typeof e === "string" ? e : "Failed to set PIN.");
    } finally {
      setIsSavingPin(false);
    }
  };

  const [localUser, setLocalUser] = useState(null); // updated after avatar change
  const effectiveUser = localUser ?? user;

  // Reset local overrides + forms when the panel switches to a different user
  const prevUserIdRef = useRef(user?.id);
  if (user?.id !== prevUserIdRef.current) {
    prevUserIdRef.current = user?.id;
    setLocalUser(null);
  }
  useEffect(() => {
    if (!open) {
      setShowResetForm(false); setNewPass(""); setConfirmPass(""); setPassError("");
      setShowPinForm(false);   setNewPin("");  setPinConfirm("");  setPinError("");
    }
  }, [open]);

  const rc       = effectiveUser ? getRoleConfig(effectiveUser.role_slug) : null;
  const fullName = effectiveUser
    ? ([effectiveUser.first_name, effectiveUser.last_name].filter(Boolean).join(" ") || effectiveUser.username)
    : "";
  const isSelf   = effectiveUser?.id === currentUserId;
  const isActive = user?.is_active;

  // ── Real activity stats (transactions / sales / returns / logins) ─────────
  const {
    data: activity, isLoading: activityLoading, isError: activityError, refetch: refetchActivity,
  } = useUserActivity(user?.id);

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
        className={cn(
          "w-full sm:max-w-[440px] p-0 flex flex-col gap-0",
          "bg-card/95 backdrop-blur-xl border-l border-border",
          "rounded-l-2xl overflow-hidden shadow-2xl",
        )}
      >
        {/* Visually hidden title for accessibility */}
        <SheetHeader className="sr-only">
          <SheetTitle>User Profile</SheetTitle>
          <SheetDescription>View and manage user account details</SheetDescription>
        </SheetHeader>

        {!user ? (
          <DrawerSkeleton />
        ) : (
          <>
            {/* ── Scrollable body ──────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto min-h-0">

              {/* ══ HEADER ════════════════════════════════════════════ */}
              <div className="relative px-6 pt-7 pb-5 bg-gradient-to-b from-primary/[0.07] to-transparent border-b border-border">
                <div className="flex flex-col items-center text-center gap-3">
                  <div className="relative">
                    <div className={cn("rounded-2xl ring-4 ring-offset-2 ring-offset-card", rc.ring)}>
                      <UserAvatar user={effectiveUser} size={88} rounded="xl" />
                    </div>
                    <span
                      className={cn(
                        "absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-[3px] border-card",
                        isActive ? "bg-success" : "bg-muted-foreground/40",
                      )}
                      title={isActive ? "Active" : "Inactive"}
                    />
                  </div>

                  <div>
                    <h2 className="text-[17px] font-bold text-foreground leading-tight flex items-center justify-center gap-1.5">
                      {fullName}
                      {isSelf && (
                        <span className="text-[9px] font-bold text-primary/70 bg-primary/10 rounded-full px-1.5 py-0.5 align-middle">
                          You
                        </span>
                      )}
                    </h2>
                    <p className="text-[12px] text-muted-foreground mt-0.5">@{effectiveUser.username}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold", rc.badge)}>
                      <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1.5", rc.dot)} />
                      {effectiveUser.role_name}
                    </span>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-3 py-1 border",
                      isActive
                        ? "bg-success/10 text-success border-success/20"
                        : "bg-destructive/10 text-destructive border-destructive/20",
                    )}>
                      {isActive
                        ? <><CheckCircle2 className="h-3 w-3" /> Active</>
                        : <><XCircle     className="h-3 w-3" /> Inactive</>
                      }
                    </span>
                  </div>

                  <div className="pt-1">
                    <AvatarUploader
                      user={effectiveUser}
                      onUserChange={(updated) => setLocalUser(updated)}
                      canEdit={canUpdate || isSelf}
                    />
                  </div>
                </div>

                {/* ── Quick actions ───────────────────────────────────── */}
                <div className="flex items-center justify-center gap-1.5 mt-5 flex-wrap">
                  {canUpdate && (
                    <QuickAction icon={Pencil} label="Edit" onClick={() => onEdit(user)} />
                  )}
                  {canUpdate && (
                    <QuickAction
                      icon={KeyRound}
                      label="Reset Password"
                      active={showResetForm}
                      onClick={() => setShowResetForm((p) => !p)}
                    />
                  )}
                  {canUpdate && !isSelf && (
                    <QuickAction
                      icon={isActive ? PowerOff : Power}
                      label={isActive ? "Disable" : "Enable"}
                      tone={isActive ? "destructive" : "success"}
                      loading={isTogglingActive}
                      onClick={handleToggleActive}
                    />
                  )}
                  {canDelete && !isSelf && onDelete && (
                    <QuickAction icon={ShieldAlert} label="Delete" tone="destructive" onClick={() => onDelete(user)} />
                  )}
                </div>
              </div>

              {/* ══ ACTIVITY OVERVIEW ═══════════════════════════════════ */}
              <SectionBlock title="Activity Overview" icon={ReceiptText}>
                {activityLoading ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-[72px] rounded-xl" />
                    ))}
                  </div>
                ) : activityError ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
                    <AlertTriangle className="h-5 w-5 text-destructive/60" />
                    <p className="text-[11px] text-muted-foreground">Couldn't load activity stats</p>
                    <Button variant="outline" size="xs" onClick={() => refetchActivity()} className="gap-1.5 text-[11px]">
                      <RefreshCw className="h-3 w-3" /> Retry
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    <StatCard
                      icon={ReceiptText}
                      label="Transactions"
                      value={(activity?.total_transactions ?? 0).toLocaleString()}
                      accent="primary"
                    />
                    <StatCard
                      icon={Banknote}
                      label="Total Sales"
                      value={formatCurrency(parseFloat(activity?.total_sales_amount ?? 0))}
                      accent="success"
                    />
                    <StatCard
                      icon={PackagePlus}
                      label="Products Added"
                      value={(activity?.products_added ?? 0).toLocaleString()}
                      accent="default"
                    />
                    <StatCard
                      icon={Undo2}
                      label="Returns Processed"
                      value={(activity?.returns_processed ?? 0).toLocaleString()}
                      accent="warning"
                    />
                    <StatCard
                      icon={LogIn}
                      label="Successful Logins"
                      value={(activity?.login_count ?? 0).toLocaleString()}
                      accent="default"
                      className="col-span-2"
                    />
                  </div>
                )}
              </SectionBlock>

              {/* ══ PERSONAL INFORMATION ════════════════════════════════ */}
              <SectionBlock title="Personal Information" icon={UserIcon}>
                <InfoGrid>
                  <InfoRow icon={UserIcon} label="Full Name">{fullName}</InfoRow>
                  <InfoRow icon={Hash}     label="Username">@{effectiveUser.username}</InfoRow>
                  <InfoRow icon={Mail}     label="Email">{effectiveUser.email}</InfoRow>
                  <InfoRow icon={Phone}    label="Phone">{effectiveUser.phone || <Empty />}</InfoRow>
                  <InfoRow icon={UserIcon} label="Gender"><Empty note="Not tracked" /></InfoRow>
                  <InfoRow icon={MapPin}   label="Address"><Empty note="Not tracked" /></InfoRow>
                </InfoGrid>
              </SectionBlock>

              {/* ══ ACCOUNT INFORMATION ═════════════════════════════════ */}
              <SectionBlock title="Account Information" icon={Shield}>
                <InfoGrid>
                  <InfoRow icon={Hash}      label="User ID">#{effectiveUser.id}</InfoRow>
                  <InfoRow icon={Shield}    label="Role">{effectiveUser.role_name}</InfoRow>
                  <InfoRow icon={Store}     label="Store">{effectiveUser.store_name ?? "All Stores"}</InfoRow>
                  <InfoRow icon={Calendar}  label="Date Created">{effectiveUser.created_at ? formatDateTime(effectiveUser.created_at) : "—"}</InfoRow>
                  <InfoRow icon={LogIn}     label="Last Login">{effectiveUser.last_login ? formatDateTime(effectiveUser.last_login) : <Empty note="Never logged in" />}</InfoRow>
                  <InfoRow icon={Clock}     label="Last Activity">{effectiveUser.updated_at ? formatDateTime(effectiveUser.updated_at) : "—"}</InfoRow>
                </InfoGrid>
              </SectionBlock>

              {/* ══ SECURITY INFORMATION ════════════════════════════════ */}
              <SectionBlock title="Security Information" icon={ShieldCheck}>
                <InfoGrid>
                  <InfoRow icon={isActive ? ShieldCheck : ShieldAlert} label="Account Status">
                    <span className={cn("font-semibold", isActive ? "text-success" : "text-destructive")}>
                      {isActive ? "Active" : "Inactive"}
                    </span>
                  </InfoRow>
                  <InfoRow icon={Lock} label="Password Updated"><Empty note="Not tracked" /></InfoRow>
                  <InfoRow icon={ShieldCheck} label="Two-Factor Auth">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2 py-0.5 bg-muted text-muted-foreground border border-border">
                      Not Enabled
                    </span>
                  </InfoRow>
                  <InfoRow icon={AlertTriangle} label="Failed Logins">
                    {activityLoading ? (
                      <Skeleton className="h-3.5 w-8" />
                    ) : (activity?.failed_login_attempts ?? 0) > 0 ? (
                      <span className="font-semibold text-warning">{activity.failed_login_attempts} attempt{activity.failed_login_attempts !== 1 ? "s" : ""}</span>
                    ) : (
                      <span className="text-success font-medium">None</span>
                    )}
                  </InfoRow>
                </InfoGrid>
              </SectionBlock>

              {/* ── Reset password form ─────────────────────────────────── */}
              {canUpdate && showResetForm && (
                <SectionBlock title="Set New Password" icon={KeyRound} collapsible defaultOpen>
                  <div className="space-y-2.5">
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
                    {passError && <p className="text-[10px] text-destructive">{passError}</p>}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm" className="flex-1 gap-1.5"
                        onClick={handleResetSubmit}
                        disabled={isResetting || !newPass}
                      >
                        {isResetting && <Loader2 className="h-3 w-3 animate-spin" />}
                        Confirm Reset
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowResetForm(false)} className="text-[12px]">
                        Cancel
                      </Button>
                    </div>
                  </div>
                </SectionBlock>
              )}

              {/* ── POS PIN section (self only) ─────────────────────────── */}
              {isSelf && (
                <SectionBlock title="POS Quick-Unlock PIN" icon={Lock} collapsible defaultOpen={showPinForm}>
                  <button
                    onClick={() => { setShowPinForm((p) => !p); setPinError(""); }}
                    className="flex items-center justify-between w-full group mb-1"
                  >
                    <span className="text-[11px] text-muted-foreground">
                      4-digit PIN for quick POS screen unlock.
                    </span>
                    <span className={cn(
                      "text-[10px] font-medium rounded-full px-2 py-0.5 transition-colors shrink-0 ml-2",
                      showPinForm
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
                    )}>
                      {showPinForm ? "Cancel" : "Change"}
                    </span>
                  </button>

                  {pinDone && !showPinForm && (
                    <p className="flex items-center gap-1.5 text-[11px] text-success">
                      <CheckCircle2 className="h-3 w-3" /> PIN set successfully.
                    </p>
                  )}

                  {showPinForm && (
                    <div className="mt-2 space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">New PIN</label>
                          <Input
                            type="password"
                            maxLength={4}
                            placeholder="4 digits"
                            value={newPin}
                            onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "")); setPinError(""); }}
                            className="h-9 text-[12px] tracking-widest bg-background/50"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Confirm</label>
                          <Input
                            type="password"
                            maxLength={4}
                            placeholder="4 digits"
                            value={pinConfirm}
                            onChange={(e) => { setPinConfirm(e.target.value.replace(/\D/g, "")); setPinError(""); }}
                            className="h-9 text-[12px] tracking-widest bg-background/50"
                          />
                        </div>
                      </div>
                      {pinError && <p className="text-[10px] text-destructive">{pinError}</p>}
                      <Button
                        size="sm"
                        className="w-full gap-1.5"
                        onClick={handlePinSave}
                        disabled={isSavingPin || newPin.length !== 4 || pinConfirm.length !== 4}
                      >
                        {isSavingPin
                          ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                          : <><Lock    className="h-3 w-3" />Set PIN</>
                        }
                      </Button>
                    </div>
                  )}
                </SectionBlock>
              )}

              <div className="h-2" />
            </div>

            {/* ══ FOOTER ══════════════════════════════════════════════ */}
            <div className="shrink-0 border-t border-border bg-card/90 backdrop-blur-sm px-5 py-3.5 flex items-center gap-2">
              {canUpdate && (
                <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-[12px]" onClick={() => onEdit(user)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit User
                </Button>
              )}
              {onViewFullProfile && (
                <Button
                  variant="ghost" size="sm"
                  className="flex-1 gap-1.5 text-[12px] text-muted-foreground"
                  onClick={() => onViewFullProfile(user)}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Full Profile
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-[12px]" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function QuickAction({ icon: Icon, label, onClick, tone = "default", active = false, loading = false }) {
  const toneCls = {
    default:     "border-border text-foreground hover:bg-muted",
    destructive: "border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive",
    success:     "border-success/30 text-success hover:bg-success/10 hover:border-success",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={label}
      className={cn(
        "flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[11px] font-semibold",
        "transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
        active ? "bg-primary/15 border-primary/30 text-primary" : cn("bg-background/40", toneCls),
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function SectionBlock({ title, icon: Icon, children, collapsible = false, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="px-5 py-4 border-b border-border/50 last:border-0">
      <button
        type="button"
        onClick={() => collapsible && setOpen((p) => !p)}
        className={cn(
          "flex items-center justify-between w-full mb-3",
          collapsible ? "cursor-pointer group" : "cursor-default",
        )}
      >
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary/70" />
          {title}
        </span>
        {collapsible && (
          <ChevronRight className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )} />
        )}
      </button>
      {(!collapsible || open) && children}
    </div>
  );
}

function InfoGrid({ children }) {
  return <div className="space-y-0.5">{children}</div>;
}

function InfoRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/30">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <span className="text-[11px] text-muted-foreground w-[110px] shrink-0">{label}</span>
      <span className="text-[12px] font-medium text-foreground truncate flex-1 text-right">{children}</span>
    </div>
  );
}

function Empty({ note = "—" }) {
  return <span className="text-muted-foreground/50 italic font-normal">{note}</span>;
}

function StatCard({ icon: Icon, label, value, accent = "default", className }) {
  const tone = {
    default: "border-border/60 bg-card text-foreground",
    primary: "border-primary/25 bg-primary/[0.06] text-primary",
    success: "border-success/25 bg-success/[0.06] text-success",
    warning: "border-warning/25 bg-warning/[0.06] text-warning",
  }[accent];
  const iconTone = {
    default: "text-muted-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
  }[accent];

  return (
    <div className={cn("rounded-xl border px-3.5 py-3 transition-colors duration-150", tone, className)}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconTone)} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </span>
      </div>
      <p className="text-[16px] font-bold tabular-nums leading-none">{value}</p>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 pt-7 pb-5 border-b border-border flex flex-col items-center gap-3">
        <Skeleton className="h-[88px] w-[88px] rounded-2xl" />
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-3 w-20 rounded" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
      <div className="px-5 py-4 space-y-2.5">
        <Skeleton className="h-3 w-28 rounded" />
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-xl" />
          ))}
        </div>
      </div>
      <div className="px-5 py-4 space-y-2">
        <Skeleton className="h-3 w-28 rounded" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
