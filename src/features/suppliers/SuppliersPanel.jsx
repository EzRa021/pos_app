// ============================================================================
// features/suppliers/SuppliersPanel.jsx
// ============================================================================
import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck, Edit3, Power, PowerOff, Trash2, Plus, Search, X,
  Phone, Mail, Building2, AlertTriangle, DollarSign,
} from "lucide-react";
import { toast } from "sonner";

import { useSuppliers }   from "./useSuppliers";
import { PageHeader }     from "@/components/shared/PageHeader";
import { DataTable }      from "@/components/shared/DataTable";
import { EmptyState }     from "@/components/shared/EmptyState";
import { Button }         from "@/components/ui/button";
import { Input }          from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }             from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { usePermission }       from "@/hooks/usePermission";
import { usePaginationParams } from "@/hooks/usePaginationParams";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "all",      label: "All"      },
  { key: "active",   label: "Active"   },
  { key: "inactive", label: "Inactive" },
];

function Section({ title, action, children, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
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

function StatusTabs({ active, onChange, counts }) {
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
            {counts[tab.key] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Form Dialog (create + edit) ───────────────────────────────────────────────

const PAYMENT_TERMS_OPTIONS = ["Net 7", "Net 15", "Net 30", "Net 60", "Net 90", "Cash on Delivery", "Prepaid"];

const BLANK_FORM = {
  supplier_name: "", contact_name: "", phone: "", email: "",
  address: "", city: "", tax_id: "", payment_terms: "Net 30", credit_limit: "",
};

function SupplierFormDialog({ open, onOpenChange, editing, onCreate, onUpdate }) {
  const [form,   setForm]   = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  const handleOpenChange = useCallback((val) => {
    if (val) {
      setForm(editing ? {
        supplier_name:  editing.supplier_name   ?? "",
        contact_name:   editing.contact_name    ?? "",
        phone:          editing.phone           ?? "",
        email:          editing.email           ?? "",
        address:        editing.address         ?? "",
        city:           editing.city            ?? "",
        tax_id:         editing.tax_id          ?? "",
        payment_terms:  editing.payment_terms   ?? "Net 30",
        credit_limit:   editing.credit_limit != null ? String(parseFloat(editing.credit_limit)) : "",
      } : BLANK_FORM);
    }
    if (!val) setSaving(false);
    onOpenChange(val);
  }, [editing, onOpenChange]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.supplier_name.trim()) { toast.error("Supplier name is required."); return; }
    setSaving(true);
    const payload = {
      supplier_name: form.supplier_name.trim(),
      contact_name:  form.contact_name.trim()  || undefined,
      phone:         form.phone.trim()         || undefined,
      email:         form.email.trim()         || undefined,
      address:       form.address.trim()       || undefined,
      city:          form.city.trim()          || undefined,
      tax_id:        form.tax_id.trim()        || undefined,
      payment_terms: form.payment_terms        || undefined,
      credit_limit:  form.credit_limit ? parseFloat(form.credit_limit) : undefined,
    };
    try {
      if (editing) await onUpdate({ id: editing.id, ...payload });
      else         await onCreate(payload);
      toast.success(editing ? "Supplier updated." : "Supplier created.");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!editing;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              {isEdit ? <Edit3 className="h-5 w-5 text-primary" /> : <Truck className="h-5 w-5 text-primary" />}
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                {isEdit ? "Edit Supplier" : "New Supplier"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {isEdit ? editing.supplier_name : "Add a new supplier to your directory"}
              </DialogDescription>
            </div>
          </div>

          <form id="supplier-form" onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Supplier Name <span className="text-destructive">*</span>
              </label>
              <Input value={form.supplier_name} onChange={set("supplier_name")} className="h-8 text-sm" placeholder="e.g. Acme Supplies Ltd." />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contact Person</label>
                <Input value={form.contact_name} onChange={set("contact_name")} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Phone</label>
                <Input value={form.phone} onChange={set("phone")} className="h-8 text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</label>
                <Input value={form.email} onChange={set("email")} type="email" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">City</label>
                <Input value={form.city} onChange={set("city")} className="h-8 text-sm" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Address</label>
              <Input value={form.address} onChange={set("address")} className="h-8 text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tax ID / RC</label>
                <Input value={form.tax_id} onChange={set("tax_id")} className="h-8 text-sm" placeholder="e.g. RC-123456" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment Terms</label>
                <select value={form.payment_terms} onChange={set("payment_terms")}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                  {PAYMENT_TERMS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Credit Limit (₦)</label>
              <Input value={form.credit_limit} onChange={set("credit_limit")} type="number" min="0" step="1000" className="h-8 text-sm" placeholder="0" />
            </div>
          </form>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="supplier-form" size="sm" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Toggle Status Dialog ──────────────────────────────────────────────────────

function ToggleDialog({ open, onOpenChange, supplier, onConfirm }) {
  const [busy, setBusy] = useState(false);
  if (!supplier) return null;
  const isActivating = !supplier.is_active;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(supplier.id);
      toast.success(isActivating ? "Supplier activated." : "Supplier deactivated.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className={cn("h-[3px] w-full", isActivating ? "bg-success" : "bg-warning")} />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-3">
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
                {isActivating ? "Activate Supplier?" : "Deactivate Supplier?"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {supplier.supplier_name}
              </DialogDescription>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isActivating
              ? "This supplier will be available for purchase orders and searches."
              : "This supplier will be hidden from purchase orders and searches."}
          </p>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Keep</Button>
          <Button size="sm" className={cn(
            "flex-1 text-white",
            isActivating ? "bg-success hover:bg-success/90" : "bg-warning/90 hover:bg-warning",
          )} onClick={handleConfirm} disabled={busy}>
            {isActivating ? "Activate" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Dialog ─────────────────────────────────────────────────────────────

function DeleteDialog({ open, onOpenChange, supplier, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy,        setBusy]        = useState(false);
  if (!supplier) return null;

  const nameMatches = confirmText.trim().toLowerCase() === supplier.supplier_name.toLowerCase();

  const handleConfirm = async () => {
    if (!nameMatches) return;
    setBusy(true);
    try {
      await onConfirm(supplier.id);
      toast.success("Supplier deleted.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message ?? "Delete failed.");
    } finally {
      setBusy(false);
      setConfirmText("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setConfirmText(""); onOpenChange(v); }}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
              <Trash2 className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">Delete Supplier?</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {supplier.supplier_name}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <p className="text-[11px] text-destructive leading-relaxed">
              If this supplier has purchase orders it will be <span className="font-bold">deactivated</span> instead of deleted.
              Otherwise it will be <span className="font-bold">permanently removed</span>.
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-1.5">
              Type <span className="font-mono font-semibold text-foreground">{supplier.supplier_name}</span> to confirm:
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="h-8 text-sm"
              placeholder={supplier.supplier_name}
            />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" disabled={!nameMatches || busy} onClick={handleConfirm}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function SuppliersPanel() {
  const navigate   = useNavigate();
  const canManage  = usePermission("suppliers.create");

  const { page, search, setPage, setSearch } = usePaginationParams({ defaultPageSize: 50 });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusTab,       setStatusTab]       = useState("all");
  const [formOpen,        setFormOpen]        = useState(false);
  const [editing,         setEditing]         = useState(null);
  const [toggleTarget,    setToggleTarget]    = useState(null);
  const [deleteTarget,    setDeleteTarget]    = useState(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const isActive = statusTab === "active" ? true : statusTab === "inactive" ? false : undefined;

  const { items, total, totalPages, isLoading, create, update, activate, deactivate, remove } =
    useSuppliers({ search: debouncedSearch || undefined, isActive, page });

  // Counts for the status tab badges — derived from server totals or current page
  const counts = useMemo(() => ({
    all:      statusTab === "all"      ? total : items.length,
    active:   statusTab === "active"   ? total : items.filter((i) =>  i.is_active).length,
    inactive: statusTab === "inactive" ? total : items.filter((i) => !i.is_active).length,
  }), [items, total, statusTab]);

  // Derived stats
  const totalBalance = useMemo(() =>
    items.reduce((s, i) => s + parseFloat(i.current_balance ?? 0), 0),
  [items]);

  const openCreate = useCallback(() => { setEditing(null); setFormOpen(true); }, []);
  const openEdit   = useCallback((row) => { setEditing(row); setFormOpen(true); }, []);

  const columns = useMemo(() => [
    {
      key:    "supplier_name",
      header: "Supplier",
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold uppercase",
            row.is_active
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-muted/40 bg-muted/30 text-muted-foreground",
          )}>
            {(row.supplier_name ?? "").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className={cn(
              "text-xs font-semibold",
              row.is_active ? "text-foreground" : "text-muted-foreground line-through decoration-muted-foreground/40",
            )}>
              {row.supplier_name}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono">{row.supplier_code}</p>
          </div>
        </div>
      ),
    },
    {
      key:    "contact_name",
      header: "Contact",
      render: (row) => (
        <div className="space-y-0.5">
          {row.contact_name && (
            <p className="text-xs text-foreground">{row.contact_name}</p>
          )}
          {row.phone && (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Phone className="h-2.5 w-2.5" />{row.phone}
            </p>
          )}
        </div>
      ),
    },
    {
      key:    "email",
      header: "Email",
      render: (row) => row.email ? (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Mail className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[160px]">{row.email}</span>
        </p>
      ) : <span className="text-[11px] text-muted-foreground/40">—</span>,
    },
    {
      key:    "city",
      header: "Location",
      render: (row) => row.city ? (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Building2 className="h-3 w-3 shrink-0" />{row.city}
        </p>
      ) : <span className="text-[11px] text-muted-foreground/40">—</span>,
    },
    {
      key:    "payment_terms",
      header: "Terms",
      render: (row) => (
        <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {row.payment_terms ?? "Net 30"}
        </span>
      ),
    },
    {
      key:    "current_balance",
      header: "Balance",
      align:  "right",
      render: (row) => {
        const bal = parseFloat(row.current_balance ?? 0);
        return (
          <span className={cn(
            "text-xs font-mono tabular-nums font-semibold",
            bal > 0 ? "text-warning" : "text-muted-foreground",
          )}>
            {formatCurrency(bal)}
          </span>
        );
      },
    },
    ...(canManage ? [{
      key:    "actions",
      header: "",
      align:  "right",
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

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Manage your supplier directory and track procurement relationships."
        action={canManage && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Supplier
          </Button>
        )}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Suppliers" value={total}            sub="in this store"     accent="primary" />
            <StatCard label="Active"           value={counts.active}   sub="available for POs" accent="success" />
            <StatCard label="Inactive"         value={counts.inactive}
              sub="not available for POs"
              accent={counts.inactive > 0 ? "warning" : "muted"}
            />
            <StatCard
              label="Outstanding Balance"
              value={formatCurrency(totalBalance)}
              sub="total owed to suppliers"
              accent={totalBalance > 0 ? "warning" : "muted"}
            />
          </div>

          {/* Supplier table */}
          <Section
            title="Supplier Directory"
            action={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Search suppliers…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); }}
                    className="pl-8 h-7 w-48 text-[11px]"
                  />
                  {search && (
                    <button onClick={() => setSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <StatusTabs active={statusTab} onChange={(v) => { setStatusTab(v); setPage(1); }} counts={counts} />
              </div>
            }
          >
            <DataTable
              columns={columns}
              data={items}
              isLoading={isLoading}
              onRowClick={(row) => navigate(`/suppliers/${row.id}`)}
              pagination={total > 50 ? { page, pageSize: 50, total, onPageChange: setPage } : undefined}
              emptyState={
                <EmptyState
                  icon={Truck}
                  title="No suppliers found"
                  description={debouncedSearch ? "Try a different search term." : "Add your first supplier to get started."}
                  action={!debouncedSearch && canManage && (
                    <Button size="sm" onClick={openCreate}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      New Supplier
                    </Button>
                  )}
                />
              }
            />
          </Section>

          {/* Legend */}
          {items.length > 0 && canManage && (
            <div className="flex flex-wrap items-center gap-5 px-1 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5"><Edit3   className="h-3 w-3" /><span>Edit</span></div>
              <div className="flex items-center gap-1.5"><Power   className="h-3 w-3 text-success" /><span>Activate</span></div>
              <div className="flex items-center gap-1.5"><PowerOff className="h-3 w-3 text-warning" /><span>Deactivate</span></div>
              <div className="flex items-center gap-1.5"><Trash2  className="h-3 w-3 text-destructive" /><span>Delete</span></div>
            </div>
          )}

        </div>
      </div>

      <SupplierFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onCreate={(p) => create.mutateAsync(p)}
        onUpdate={(p) => update.mutateAsync(p)}
      />

      <ToggleDialog
        open={!!toggleTarget}
        onOpenChange={(v) => !v && setToggleTarget(null)}
        supplier={toggleTarget}
        onConfirm={(id) => toggleTarget?.is_active
          ? deactivate.mutateAsync(id)
          : activate.mutateAsync(id)
        }
      />

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        supplier={deleteTarget}
        onConfirm={(id) => remove.mutateAsync(id)}
      />
    </>
  );
}
