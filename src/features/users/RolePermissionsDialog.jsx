// features/users/RolePermissionsDialog.jsx
// Dialog to view and edit the permissions assigned to a role.
// super_admin (is_global) is read-only — its permissions are locked.
import { useState, useEffect, useMemo } from "react";
import { ShieldCheck, Loader2, Lock, Info } from "lucide-react";
import { Button }  from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { usePermissions, useRolePermissions, useSetRolePermissions } from "./useUsers";
import { getRoleConfig } from "./roleConfig";

// Human-readable category labels
const CATEGORY_LABELS = {
  users:       "Users",
  stores:      "Stores",
  departments: "Departments",
  categories:  "Categories",
  items:       "Items",
  inventory:   "Inventory",
  pos:         "Point of Sale",
  customers:   "Customers",
  suppliers:   "Suppliers",
  purchasing:  "Purchase Orders",
  payments:    "Payments",
  shifts:      "Shifts",
  credit:      "Credit Sales",
  expenses:    "Expenses",
  audit:       "Audit Log",
  analytics:   "Analytics",
};

export function RolePermissionsDialog({ open, onOpenChange, role }) {
  const rc       = role ? getRoleConfig(role.role_slug) : null;
  const isLocked = role?.is_global ?? false;

  const { data: allPerms = [], isLoading: loadingPerms } = usePermissions();
  const { data: grantedIds = [], isLoading: loadingGranted } = useRolePermissions(role?.id);
  const setPerms = useSetRolePermissions();

  // Local checked state — initialised from server data when dialog opens
  const [checked, setChecked] = useState(new Set());
  const isLoading = loadingPerms || loadingGranted;

  useEffect(() => {
    if (open && !isLoading) {
      setChecked(new Set(grantedIds));
    }
  }, [open, isLoading, grantedIds]);

  // Group permissions by category
  const grouped = useMemo(() => {
    const map = {};
    allPerms.forEach((p) => {
      const cat = p.category ?? "other";
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    });
    return Object.entries(map).sort(([a], [b]) => {
      const order = Object.keys(CATEGORY_LABELS);
      return (order.indexOf(a) ?? 99) - (order.indexOf(b) ?? 99);
    });
  }, [allPerms]);

  const toggle = (id) => {
    if (isLocked) return;
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleCategory = (perms) => {
    if (isLocked) return;
    const ids = perms.map((p) => p.id);
    const allOn = ids.every((id) => checked.has(id));
    setChecked((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => allOn ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const handleSave = async () => {
    if (!role || isLocked) return;
    await setPerms.mutateAsync({ roleId: role.id, permissionIds: [...checked] });
    onOpenChange(false);
  };

  const isDirty = useMemo(() => {
    if (isLoading) return false;
    if (checked.size !== grantedIds.length) return true;
    return grantedIds.some((id) => !checked.has(id));
  }, [checked, grantedIds, isLoading]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-border/80 shadow-2xl shadow-black/60 p-0 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Top stripe — role colour */}
        <div className={cn("h-1 w-full shrink-0", rc?.dot.replace("bg-", "bg-") ?? "bg-primary")} />

        {/* Header */}
        <div className="px-6 pt-5 pb-4 shrink-0 border-b border-border/50">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl border text-lg font-bold",
                rc?.avatar ?? "bg-muted text-muted-foreground",
                "border-white/10",
              )}>
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold text-foreground">
                  {role?.role_name} — Permissions
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  {isLocked
                    ? "Super Admin has all permissions and cannot be edited."
                    : `${checked.size} of ${allPerms.length} permissions granted`}
                </DialogDescription>
              </div>
              {isLocked && (
                <span className="ml-auto flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[10px] font-semibold text-warning">
                  <Lock className="h-3 w-3" /> Read-only
                </span>
              )}
            </div>
          </DialogHeader>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading permissions…
            </div>
          ) : (
            grouped.map(([cat, perms]) => {
              const label    = CATEGORY_LABELS[cat] ?? cat;
              const ids      = perms.map((p) => p.id);
              const onCount  = ids.filter((id) => checked.has(id)).length;
              const allOn    = onCount === ids.length;
              const someOn   = onCount > 0 && !allOn;

              return (
                <div key={cat} className="rounded-xl border border-border/50 overflow-hidden">
                  {/* Category header */}
                  <button
                    onClick={() => toggleCategory(perms)}
                    disabled={isLocked}
                    className={cn(
                      "flex w-full items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border/40 transition-colors",
                      !isLocked && "hover:bg-muted/40 cursor-pointer",
                      isLocked && "cursor-default",
                    )}
                  >
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {label}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[10px] font-semibold tabular-nums rounded-full px-2 py-0.5",
                        allOn
                          ? "bg-success/15 text-success"
                          : someOn
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {onCount}/{ids.length}
                      </span>
                      {!isLocked && (
                        <span className={cn(
                          "text-[10px] font-medium",
                          allOn ? "text-destructive/60" : "text-primary/70",
                        )}>
                          {allOn ? "Remove all" : "Grant all"}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Permission rows */}
                  <div className="divide-y divide-border/20">
                    {perms.map((perm) => {
                      const on = checked.has(perm.id);
                      return (
                        <button
                          key={perm.id}
                          onClick={() => toggle(perm.id)}
                          disabled={isLocked}
                          className={cn(
                            "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                            !isLocked && "hover:bg-muted/20 cursor-pointer",
                            isLocked && "cursor-default",
                            on && "bg-success/[0.04]",
                          )}
                        >
                          {/* Toggle pill */}
                          <div className={cn(
                            "relative flex h-5 w-9 shrink-0 items-center rounded-full border transition-all duration-200",
                            on
                              ? "bg-success border-success/60"
                              : "bg-muted border-border",
                            isLocked && "opacity-60",
                          )}>
                            <span className={cn(
                              "absolute h-3.5 w-3.5 rounded-full bg-white shadow transition-all duration-200",
                              on ? "left-[18px]" : "left-[2px]",
                            )} />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className={cn(
                              "text-[12px] font-medium leading-tight",
                              on ? "text-foreground" : "text-muted-foreground",
                            )}>
                              {perm.permission_name}
                            </p>
                            <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                              {perm.permission_slug}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-border/50 bg-card/50">
          {isLocked ? (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              Super Admin bypasses all permission checks.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Changes apply to all users with the <span className="font-semibold text-foreground">{role?.role_name}</span> role.
            </p>
          )}
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline" size="sm"
              onClick={() => onOpenChange(false)}
              disabled={setPerms.isPending}
            >
              {isLocked ? "Close" : "Cancel"}
            </Button>
            {!isLocked && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!isDirty || setPerms.isPending || isLoading}
                className="gap-1.5 min-w-[100px]"
              >
                {setPerms.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save Permissions
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
