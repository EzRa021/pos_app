// ============================================================================
// features/customers/CustomersPanel.jsx
// ============================================================================
import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, Search, X, UserPlus, Edit3, Power, PowerOff, Trash2,
  CreditCard, Star, AlertTriangle, Phone, Mail,
} from "lucide-react";

import { useCustomers }   from "./useCustomers";
import { PageHeader }     from "@/components/shared/PageHeader";
import { DataTable }      from "@/components/shared/DataTable";
import { EmptyState }     from "@/components/shared/EmptyState";
import { StatusBadge }    from "@/components/shared/StatusBadge";
import { Button }         from "@/components/ui/button";
import { Input }          from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }             from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { useBranchStore } from "@/stores/branch.store";
import { usePermission }  from "@/hooks/usePermission";
import { toast }          from "sonner";

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_TABS = [
  { key: "",          label: "All Types"  },
  { key: "regular",   label: "Regular"    },
  { key: "vip",       label: "VIP"        },
  { key: "wholesale", label: "Wholesale"  },
];

const STATUS_TABS = [
  { key: "all",      label: "All"      },
  { key: "active",   label: "Active"   },
  { key: "inactive", label: "Inactive" },
];

const CUSTOMER_TYPE_STYLES = {
  vip:       "bg-warning/10 text-warning border border-warning/20",
  wholesale: "bg-primary/10 text-primary border border-primary/20",
  regular:   "bg-muted/50 text-muted-foreground border border-border/60",
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, action, children, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent = "default" }) {
  const ring = {
    default: "border-border/60   bg-card",
    primary: "border-primary/25  bg-primary/[0.06]",
    success: "border-success/25  bg-success/[0.06]",
    warning: "border-warning/25  bg-warning/[0.06]",
    muted:   "border-border/60   bg-muted/30",
  }[accent];
  const val = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    muted:   "text-muted-foreground",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function TypeTabFilter({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
      {TYPE_TABS.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}>
          {tab.label}
          {counts[tab.key] !== undefined && (
            <span className={cn(
              "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
              active === tab.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}>
              {counts[tab.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function StatusTabFilter({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
      {STATUS_TABS.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}>
          {tab.label}
          <span className={cn(
            "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
            active === tab.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}>
            {counts[tab.key]}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Customer Form Dialog ───────────────────────────────────────────────────────

const INITIAL_FORM = {
  first_name: "", last_name: "", email: "", phone: "",
  address: "", city: "", customer_type: "regular",
  credit_limit: "", credit_enabled: false,
};

function CustomerFormDialog({ open, onOpenChange, customer, onCreate, onUpdate, storeId }) {
  const isEdit = !!customer;
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  // Sync form when opening
  useState(() => {
    if (open) {
      if (customer) {
        setForm({
          first_name:     customer.first_name ?? "",
          last_name:      customer.last_name  ?? "",
          email:          customer.email      ?? "",
          phone:          customer.phone      ?? "",
          address:        customer.address    ?? "",
          city:           customer.city       ?? "",
          customer_type:  customer.customer_type ?? "regular",
          credit_limit:   customer.credit_limit != null ? String(parseFloat(customer.credit_limit)) : "",
          credit_enabled: customer.credit_enabled ?? false,
        });
      } else {
        setForm(INITIAL_FORM);
      }
    }
  });

  // Reset form when dialog opens/closes
  const handleOpenChange = useCallback((val) => {
    if (!val) { setForm(INITIAL_FORM); setSaving(false); }
    if (val && customer) {
      setForm({
        first_name:     customer.first_name ?? "",
        last_name:      customer.last_name  ?? "",
        email:          customer.email      ?? "",
        phone:          customer.phone      ?? "",
        address:        customer.address    ?? "",
        city:           customer.city       ?? "",
        customer_type:  customer.customer_type ?? "regular",
        credit_limit:   customer.credit_limit != null ? String(parseFloat(customer.credit_limit)) : "",
        credit_enabled: customer.credit_enabled ?? false,
      });
    }
    onOpenChange(val);
  }, [onOpenChange, customer]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const setCheck = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.checked }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast.error("First name and last name are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        first_name:     form.first_name.trim(),
        last_name:      form.last_name.trim(),
        email:          form.email.trim()   || undefined,
        phone:          form.phone.trim()   || undefined,
        address:        form.address.trim() || undefined,
        city:           form.city.trim()    || undefined,
        customer_type:  form.customer_type  || "regular",
        credit_limit:   form.credit_limit   ? parseFloat(form.credit_limit) : undefined,
        credit_enabled: form.credit_enabled,
      };
      if (isEdit) {
        await onUpdate({ id: customer.id, ...payload });
        toast.success("Customer updated.");
      } else {
        await onCreate({ store_id: storeId, ...payload });
        toast.success("Customer created.");
      }
      handleOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Failed to save customer.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                {isEdit ? "Edit Customer" : "New Customer"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {isEdit ? "Update customer details." : "Add a new customer to the system."}
              </DialogDescription>
            </div>
          </div>
          <form id="customer-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  First Name <span className="text-destructive">*</span>
                </label>
                <Input value={form.first_name} onChange={set("first_name")} placeholder="John" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Last Name <span className="text-destructive">*</span>
                </label>
                <Input value={form.last_name} onChange={set("last_name")} placeholder="Doe" className="h-8 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Phone</label>
                <Input value={form.phone} onChange={set("phone")} placeholder="+234..." className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</label>
                <Input value={form.email} onChange={set("email")} type="email" placeholder="john@example.com" className="h-8 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">City</label>
                <Input value={form.city} onChange={set("city")} placeholder="Lagos" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Customer Type</label>
                <select
                  value={form.customer_type}
                  onChange={set("customer_type")}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="regular">Regular</option>
                  <option value="vip">VIP</option>
                  <option value="wholesale">Wholesale</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Address</label>
              <Input value={form.address} onChange={set("address")} placeholder="Street address" className="h-8 text-sm" />
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Credit Settings</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">Credit Limit (₦)</label>
                  <Input
                    value={form.credit_limit}
                    onChange={set("credit_limit")}
                    type="number" min="0" step="100"
                    placeholder="0.00"
                    className="h-8 text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 mt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.credit_enabled}
                    onChange={setCheck("credit_enabled")}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="text-xs text-foreground">Enable Credit</span>
                </label>
              </div>
            </div>
          </form>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="customer-form" size="sm" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Toggle Status Dialog ───────────────────────────────────────────────────────

function ToggleStatusDialog({ open, onOpenChange, customer, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const isActivating = !customer?.is_active;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(customer.id);
      toast.success(isActivating ? "Customer activated." : "Customer deactivated.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Action failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className={cn("h-[3px] w-full", isActivating ? "bg-success" : "bg-warning")} />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border",
              isActivating ? "border-success/25 bg-success/10" : "border-warning/25 bg-warning/10",
            )}>
              {isActivating
                ? <Power    className="h-4 w-4 text-success" />
                : <PowerOff className="h-4 w-4 text-warning" />}
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">
                {isActivating ? "Activate Customer?" : "Deactivate Customer?"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {customer?.first_name} {customer?.last_name}
              </DialogDescription>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isActivating
              ? "This customer will be visible again in searches and POS lookups."
              : "This customer will be hidden from searches and cannot be added to new sales."}
          </p>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>Keep</Button>
          <Button
            size="sm"
            disabled={loading}
            className={cn("text-white flex-1",
              isActivating ? "bg-success hover:bg-success/90" : "bg-warning/90 hover:bg-warning"
            )}
            onClick={handleConfirm}
          >
            {loading ? "…" : isActivating ? "Activate" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Dialog ──────────────────────────────────────────────────────────────

function DeleteDialog({ open, onOpenChange, customer, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading]         = useState(false);
  const fullName = customer ? `${customer.first_name} ${customer.last_name}` : "";
  const nameMatches = confirmText.trim().toLowerCase() === fullName.toLowerCase();

  const handleConfirm = async () => {
    if (!nameMatches) return;
    setLoading(true);
    try {
      await onConfirm(customer.id);
      toast.success("Customer deleted.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Delete failed.");
    } finally {
      setLoading(false);
      setConfirmText("");
    }
  };

  const handleOpenChange = (val) => {
    if (!val) setConfirmText("");
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
              <Trash2 className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">Delete Customer?</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">{fullName}</DialogDescription>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-[11px] text-destructive leading-relaxed">
              This deactivates <span className="font-bold">{fullName}</span> and removes them from new sales.
              Customers with an outstanding balance <span className="font-bold">cannot be deleted</span>.
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">{fullName}</span> to confirm:
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type full name…"
              className="h-8 text-sm"
            />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button variant="destructive" size="sm" disabled={!nameMatches || loading} onClick={handleConfirm}>
            {loading ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function CustomersPanel() {
  const navigate   = useNavigate();
  const storeId    = useBranchStore((s) => s.activeStore?.id);
  const canManage  = usePermission("customers.create");

  const [search,       setSearch]       = useState("");
  const [statusTab,    setStatusTab]    = useState("all");
  const [typeTab,      setTypeTab]      = useState("");
  const [page,         setPage]         = useState(1);
  const [formOpen,     setFormOpen]     = useState(false);
  const [editTarget,   setEditTarget]   = useState(null);
  const [toggleTarget, setToggleTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const isActive = statusTab === "active" ? true : statusTab === "inactive" ? false : undefined;

  const { items, total, totalPages, isLoading, error, create, update, activate, deactivate, remove } =
    useCustomers({ search: search || undefined, isActive, customerType: typeTab || undefined, page });

  // Derived counts — computed from fetched page (we use total from server, locally compute type counts)
  const { activeCount, inactiveCount, vipCount, wholesaleCount, regularCount } = useMemo(() => {
    // These are page-relative counts; real totals would need separate queries
    const active    = items.filter((i) =>  i.is_active).length;
    const inactive  = items.filter((i) => !i.is_active).length;
    const vip       = items.filter((i) => i.customer_type === "vip").length;
    const wholesale = items.filter((i) => i.customer_type === "wholesale").length;
    const regular   = items.filter((i) => i.customer_type === "regular" || !i.customer_type).length;
    return { activeCount: active, inactiveCount: inactive, vipCount: vip, wholesaleCount: wholesale, regularCount: regular };
  }, [items]);

  const statusCounts = useMemo(() => ({
    all:      total,
    active:   activeCount,
    inactive: inactiveCount,
  }), [total, activeCount, inactiveCount]);

  const typeCounts = useMemo(() => ({
    "":          total,
    regular:     regularCount,
    vip:         vipCount,
    wholesale:   wholesaleCount,
  }), [total, regularCount, vipCount, wholesaleCount]);

  const openCreate = useCallback(() => { setEditTarget(null); setFormOpen(true); }, []);
  const openEdit   = useCallback((c) => { setEditTarget(c);   setFormOpen(true); }, []);

  const handleCreate = useCallback((p) => create.mutateAsync(p),  [create]);
  const handleUpdate = useCallback(({ id, ...p }) => update.mutateAsync({ id, ...p }), [update]);
  const handleToggle = useCallback(async (id) => {
    if (toggleTarget?.is_active) await deactivate.mutateAsync(id);
    else                         await activate.mutateAsync(id);
  }, [toggleTarget, activate, deactivate]);
  const handleDelete = useCallback((id) => remove.mutateAsync(id), [remove]);

  const columns = useMemo(() => [
    {
      key: "name",
      header: "Customer",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold uppercase",
            row.is_active
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-muted/40 bg-muted/30 text-muted-foreground",
          )}>
            {(row.first_name[0] + (row.last_name[0] ?? "")).toUpperCase()}
          </div>
          <div className="min-w-0">
            <span className={cn(
              "block text-xs font-semibold leading-tight",
              row.is_active ? "text-foreground" : "text-muted-foreground line-through decoration-muted-foreground/40",
            )}>
              {row.first_name} {row.last_name}
            </span>
            {row.phone && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                <Phone className="h-2.5 w-2.5" />{row.phone}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (row) => row.email
        ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3 shrink-0" />{row.email}</span>
        : <span className="text-xs text-muted-foreground/50">—</span>,
    },
    {
      key: "customer_type",
      header: "Type",
      render: (row) => {
        const t = row.customer_type ?? "regular";
        return (
          <span className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            CUSTOMER_TYPE_STYLES[t] ?? CUSTOMER_TYPE_STYLES.regular,
          )}>
            {t === "vip" ? "VIP" : t.charAt(0).toUpperCase() + t.slice(1)}
          </span>
        );
      },
    },
    {
      key: "credit",
      header: "Credit",
      align: "right",
      render: (row) => {
        if (!row.credit_enabled) return <span className="text-xs text-muted-foreground/50">Off</span>;
        const balance = parseFloat(row.outstanding_balance ?? 0);
        const limit   = parseFloat(row.credit_limit ?? 0);
        return (
          <div className="text-right">
            <span className={cn("text-xs font-mono tabular-nums font-semibold", balance > 0 ? "text-warning" : "text-muted-foreground")}>
              {formatCurrency(balance)}
            </span>
            <span className="block text-[10px] text-muted-foreground/60">/ {formatCurrency(limit)}</span>
          </div>
        );
      },
    },
    {
      key: "loyalty_points",
      header: "Points",
      align: "right",
      render: (row) => (
        <span className="flex items-center justify-end gap-1 text-xs tabular-nums text-muted-foreground">
          <Star className="h-3 w-3 text-warning/70" />
          {row.loyalty_points ?? 0}
        </span>
      ),
    },
    {
      key: "is_active",
      header: "Status",
      render: (row) => <StatusBadge status={row.is_active ? "active" : "inactive"} />,
    },
    ...(canManage ? [{
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
            onClick={() => openEdit(row)}>
            <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7"
            title={row.is_active ? "Deactivate" : "Activate"}
            onClick={() => setToggleTarget(row)}>
            {row.is_active
              ? <PowerOff className="h-3.5 w-3.5 text-warning" />
              : <Power    className="h-3.5 w-3.5 text-success" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete"
            onClick={() => setDeleteTarget(row)}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ),
    }] : []),
  ], [canManage, openEdit]);

  if (error) return (
    <div className="flex flex-1 items-center justify-center text-destructive text-sm">
      Failed to load customers: {error.message}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="Manage customer profiles, credit limits, and loyalty points."
        action={canManage && (
          <Button size="sm" onClick={openCreate}>
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            New Customer
          </Button>
        )}
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Customers" value={total}         sub="in this store"       accent="primary" />
            <StatCard label="Active"          value={activeCount}   sub="visible in POS"      accent="success" />
            <StatCard label="Inactive"        value={inactiveCount} sub="hidden from POS"     accent={inactiveCount > 0 ? "warning" : "muted"} />
            <StatCard label="VIP / Wholesale" value={vipCount + wholesaleCount} sub="premium customers" accent="default" />
          </div>

          {/* Customer List */}
          <Section
            title="Customer Directory"
            action={
              <div className="flex items-center gap-2">
                <TypeTabFilter   active={typeTab}   onChange={(k) => { setTypeTab(k); setPage(1); }}   counts={typeCounts} />
                <StatusTabFilter active={statusTab} onChange={(k) => { setStatusTab(k); setPage(1); }} counts={statusCounts} />
              </div>
            }
          >
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search by name, phone or email…"
                className="pl-9 pr-9 h-8 text-sm"
              />
              {search && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSearch(""); setPage(1); }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <DataTable
              columns={columns}
              data={items}
              isLoading={isLoading}
              onRowClick={(row) => navigate(`/customers/${row.id}`)}
              pagination={{ page, pageSize: 25, total, onPageChange: setPage }}
              emptyState={
                <EmptyState
                  icon={Users}
                  title="No customers found"
                  description={search ? "Try a different search term." : "Add your first customer to get started."}
                  action={canManage && !search && (
                    <Button size="sm" onClick={openCreate}>
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      New Customer
                    </Button>
                  )}
                />
              }
            />
          </Section>

          {/* Legend */}
          {items.length > 0 && canManage && (
            <div className="flex flex-wrap items-center gap-5 px-1 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5"><Edit3    className="h-3 w-3" /><span>Edit</span></div>
              <div className="flex items-center gap-1.5"><Power    className="h-3 w-3 text-success" /><span>Activate</span></div>
              <div className="flex items-center gap-1.5"><PowerOff className="h-3 w-3 text-warning" /><span>Deactivate</span></div>
              <div className="flex items-center gap-1.5"><Trash2   className="h-3 w-3 text-destructive" /><span>Delete</span></div>
            </div>
          )}

        </div>
      </div>

      {/* Dialogs */}
      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        customer={editTarget}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        storeId={storeId}
      />
      <ToggleStatusDialog
        open={!!toggleTarget}
        onOpenChange={(v) => !v && setToggleTarget(null)}
        customer={toggleTarget}
        onConfirm={handleToggle}
      />
      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        customer={deleteTarget}
        onConfirm={handleDelete}
      />
    </>
  );
}
