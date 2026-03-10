// ============================================================================
// features/categories/CategoriesPanel.jsx
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LayoutGrid, Plus, Edit3, Trash2, Power, PowerOff,
  AlertTriangle, ChevronDown, FolderOpen, Tag, Hash, Eye, EyeOff,
} from "lucide-react";

import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Spinner }    from "@/components/shared/Spinner";
import { Button }     from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { useAnyPermission } from "@/hooks/usePermission";
import { useCategories }    from "@/features/categories/useCategories";
import { useDepartments }   from "@/features/departments/useDepartments";
import { formatDate }       from "@/lib/format";
import { cn }               from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Layout primitives
// ─────────────────────────────────────────────────────────────────────────────

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
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "all",      label: "All"      },
  { key: "active",   label: "Active"   },
  { key: "inactive", label: "Inactive" },
];

function StatusTabs({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
      {STATUS_TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
            active === tab.key
              ? "bg-card text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
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

function DeptFilter({ departments, activeDeptId, onChange }) {
  const [open, setOpen] = useState(false);
  const activeDept = departments.find((d) => d.id === activeDeptId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
          activeDeptId
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/60 bg-muted/50 text-muted-foreground hover:text-foreground hover:border-border",
        )}
      >
        <FolderOpen className="h-3 w-3 shrink-0" />
        <span>{activeDept ? activeDept.department_name : "All Departments"}</span>
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform duration-150", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-20 min-w-[180px] rounded-xl border border-border bg-card shadow-2xl shadow-black/40 overflow-hidden">
            <div className="p-1">
              {[{ id: null, department_name: "All Departments", is_active: true }, ...departments].map((d) => (
                <button
                  key={d.id ?? "all"}
                  onClick={() => { onChange(d.id); setOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors",
                    activeDeptId === d.id ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                  )}
                >
                  <span className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    d.id === null ? "bg-muted-foreground/40" : d.is_active ? "bg-success" : "bg-muted-foreground/30",
                  )} />
                  {d.department_name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small toggle switch for boolean fields
// ─────────────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
        checked
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground",
      )}
    >
      <div className={cn(
        "relative h-4 w-7 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}>
        <div className={cn(
          "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )} />
      </div>
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category form dialog
// ─────────────────────────────────────────────────────────────────────────────
function CategoryFormDialog({ open, onOpenChange, mode, initial, mutation, departments }) {
  const [name,             setName]           = useState("");
  const [code,             setCode]           = useState("");
  const [description,      setDescription]    = useState("");
  const [deptId,           setDeptId]         = useState(null);
  const [displayOrder,     setDisplayOrder]   = useState(0);
  const [color,            setColor]          = useState("");
  const [visibleInPos,     setVisibleInPos]   = useState(true);
  const [requiresWeighing, setRequiresWeighing] = useState(false);
  const [taxRate,          setTaxRate]        = useState("");

  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;
    setName(initial?.category_name    ?? "");
    setCode(initial?.category_code    ?? "");
    setDescription(initial?.description ?? "");
    setDeptId(initial?.department_id  ?? null);
    setDisplayOrder(initial?.display_order ?? 0);
    setColor(initial?.color           ?? "");
    setVisibleInPos(initial?.is_visible_in_pos  ?? true);
    setRequiresWeighing(initial?.requires_weighing ?? false);
    setTaxRate(initial?.default_tax_rate != null ? String(initial.default_tax_rate) : "");
  }, [open, initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const payload = {
      category_name:     trimmed,
      category_code:     code.trim()  || null,
      description:       description.trim() || null,
      department_id:     deptId,
      display_order:     Number(displayOrder) || 0,
      color:             color.trim() || null,
      is_visible_in_pos: visibleInPos,
      requires_weighing: requiresWeighing,
      default_tax_rate:  taxRate !== "" ? parseFloat(taxRate) : null,
    };
    const opts = { onSuccess: () => onOpenChange(false) };
    if (isEdit) mutation.mutate({ id: initial.id, ...payload }, opts);
    else        mutation.mutate(payload, opts);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-lg border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-primary" />

        <div className="px-6 pt-5 pb-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader className="mb-5">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                <LayoutGrid className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold text-foreground leading-tight">
                  {isEdit ? "Edit Category" : "New Category"}
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  {isEdit
                    ? "Update this category's details."
                    : "Create a new category to organise your products."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Soft Drinks"
                autoFocus
                required
              />
            </div>

            {/* Code + Display order */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Code <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. SOFT"
                  maxLength={50}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Display Order
                </label>
                <Input
                  type="number"
                  min={0}
                  value={displayOrder}
                  onChange={(e) => setDisplayOrder(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Tax rate + Color */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Default Tax Rate %{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  placeholder="e.g. 7.5"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Color <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="#3b82f6"
                    className="flex-1"
                  />
                  {color && (
                    <div
                      className="h-8 w-8 shrink-0 rounded-md border border-border"
                      style={{ backgroundColor: color }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Toggles row */}
            <div>
              <label className="block text-xs font-semibold text-foreground mb-2">
                Flags
              </label>
              <div className="flex flex-wrap gap-2">
                <Toggle
                  checked={visibleInPos}
                  onChange={setVisibleInPos}
                  label="Visible in POS"
                />
                <Toggle
                  checked={requiresWeighing}
                  onChange={setRequiresWeighing}
                  label="Requires Weighing"
                />
              </div>
            </div>

            {/* Department grid */}
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Department <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto rounded-lg border border-border p-1.5 bg-background/60">
                <button
                  type="button"
                  onClick={() => setDeptId(null)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-2 text-[11px] font-medium text-left transition-all border",
                    deptId === null
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                  None
                </button>
                {departments.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDeptId(d.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-2 text-[11px] font-medium text-left transition-all border",
                      deptId === d.id
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-transparent text-foreground hover:bg-muted",
                    )}
                  >
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      d.is_active ? "bg-success" : "bg-muted-foreground/30",
                    )} />
                    <span className="truncate">{d.department_name}</span>
                  </button>
                ))}
              </div>
              {departments.length === 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  No departments yet — create one on the Departments page first.
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description"
              />
            </div>

            {mutation.error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {String(mutation.error)}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1"
                disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1"
                disabled={mutation.isPending || !name.trim()}>
                {mutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toggle status
// ─────────────────────────────────────────────────────────────────────────────
function ToggleStatusDialog({ open, onOpenChange, category, isActivating, mutation }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className={cn("h-[3px] w-full", isActivating ? "bg-success" : "bg-warning")} />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                isActivating ? "border-success/25 bg-success/10" : "border-warning/25 bg-warning/10",
              )}>
                {isActivating
                  ? <Power    className="h-4 w-4 text-success" />
                  : <PowerOff className="h-4 w-4 text-warning" />}
              </div>
              <DialogTitle className="text-[15px] font-bold text-foreground leading-tight">
                {isActivating ? "Activate category?" : "Deactivate category?"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-[11px] text-muted-foreground leading-relaxed">
              {isActivating ? (
                <>
                  <span className="font-semibold text-foreground">{category?.category_name}</span>
                  {" "}will reappear in product forms and filters.
                </>
              ) : (
                <>
                  <span className="font-semibold text-foreground">{category?.category_name}</span>
                  {" "}will be hidden from product forms and filters. Existing products are not
                  affected. You can reactivate it at any time.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {mutation.error && (
            <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {String(mutation.error)}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1"
              disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className={cn(
                "flex-1 text-white",
                isActivating ? "bg-success hover:bg-success/90" : "bg-warning/90 hover:bg-warning",
              )}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(category.id, { onSuccess: () => onOpenChange(false) })}
            >
              {mutation.isPending
                ? (isActivating ? "Activating…" : "Deactivating…")
                : (isActivating ? "Activate" : "Deactivate")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hard-delete
// ─────────────────────────────────────────────────────────────────────────────
function HardDeleteDialog({ open, onOpenChange, category, mutation }) {
  const [confirmText, setConfirmText] = useState("");
  useEffect(() => { if (!open) setConfirmText(""); }, [open]);
  const nameMatches =
    confirmText.trim().toLowerCase() === category?.category_name?.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-destructive" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
                <Trash2 className="h-4 w-4 text-destructive" />
              </div>
              <DialogTitle className="text-[15px] font-bold text-foreground leading-tight">
                Permanently delete?
              </DialogTitle>
            </div>
            <DialogDescription asChild>
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                  <p className="text-[11px] text-destructive leading-relaxed">
                    This permanently removes{" "}
                    <span className="font-bold">{category?.category_name}</span> from the
                    database. Products linked to it will lose their category reference.
                    This <span className="font-bold">cannot be undone</span>.
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1.5">
                    Type{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {category?.category_name}
                    </span>{" "}
                    to confirm:
                  </p>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={category?.category_name}
                    className="h-8 text-xs"
                    autoFocus
                  />
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>

          {mutation.error && (
            <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {String(mutation.error)}
            </p>
          )}

          <div className="flex gap-2 mt-4">
            <Button type="button" variant="outline" className="flex-1"
              disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" className="flex-1"
              disabled={mutation.isPending || !nameMatches}
              onClick={() => mutation.mutate(category.id, { onSuccess: () => onOpenChange(false) })}>
              {mutation.isPending ? "Deleting…" : "Delete Permanently"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CategoriesPanel — main export
// ─────────────────────────────────────────────────────────────────────────────
export function CategoriesPanel() {
  const canManage = useAnyPermission([
    "categories.create", "categories.update", "categories.delete",
  ]);

  const {
    storeId, categories, isLoading, error,
    create, update, activate, deactivate, hardDelete,
  } = useCategories();

  const { departments } = useDepartments();

  const [statusTab,    setStatusTab]    = useState("all");
  const [activeDeptId, setActiveDeptId] = useState(null);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [editOpen,     setEditOpen]     = useState(false);
  const [toggleOpen,   setToggleOpen]   = useState(false);
  const [hardDelOpen,  setHardDelOpen]  = useState(false);
  const [selected,     setSelected]     = useState(null);

  const openEdit       = useCallback((row) => { setSelected(row); setEditOpen(true);    }, []);
  const openToggle     = useCallback((row) => { setSelected(row); setToggleOpen(true);  }, []);
  const openHardDelete = useCallback((row) => { setSelected(row); setHardDelOpen(true); }, []);

  const { activeList, inactiveList, deptCount, filtered, counts } = useMemo(() => {
    const activeList   = categories.filter((c) =>  c.is_active);
    const inactiveList = categories.filter((c) => !c.is_active);
    const deptCount    = new Set(categories.map((c) => c.department_id).filter(Boolean)).size;

    const byStatus =
      statusTab === "active"   ? activeList
      : statusTab === "inactive" ? inactiveList
      : categories;

    const filtered = activeDeptId
      ? byStatus.filter((c) => c.department_id === activeDeptId)
      : byStatus;

    return {
      activeList, inactiveList, deptCount, filtered,
      counts: {
        all:      (activeDeptId ? categories.filter((c)   => c.department_id === activeDeptId) : categories).length,
        active:   (activeDeptId ? activeList.filter((c)   => c.department_id === activeDeptId) : activeList).length,
        inactive: (activeDeptId ? inactiveList.filter((c) => c.department_id === activeDeptId) : inactiveList).length,
      },
    };
  }, [categories, statusTab, activeDeptId]);

  const deptMap = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d])),
    [departments],
  );

  const columns = useMemo(() => {
    const base = [
      {
        key:      "category_name",
        header:   "Category",
        sortable: true,
        render:   (row) => (
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold uppercase",
                row.is_active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-muted/40 bg-muted/30 text-muted-foreground",
              )}
              style={row.color ? { backgroundColor: row.color + "22", borderColor: row.color + "55", color: row.color } : undefined}
            >
              {row.category_name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={cn(
                  "text-xs font-semibold truncate",
                  row.is_active
                    ? "text-foreground"
                    : "text-muted-foreground line-through decoration-muted-foreground/40",
                )}>
                  {row.category_name}
                </span>
                {/* Code badge */}
                {row.category_code && (
                  <span className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/50 px-1.5 py-px text-[10px] font-mono font-medium text-muted-foreground">
                    <Hash className="h-2.5 w-2.5" />
                    {row.category_code}
                  </span>
                )}
                {/* POS visibility badge */}
                {!row.is_visible_in_pos && (
                  <span className="inline-flex items-center gap-0.5 rounded border border-warning/30 bg-warning/10 px-1.5 py-px text-[10px] font-medium text-warning">
                    <EyeOff className="h-2.5 w-2.5" />
                    Hidden
                  </span>
                )}
                {/* Requires weighing badge */}
                {row.requires_weighing && (
                  <span className="inline-flex items-center rounded border border-border/60 bg-muted/50 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                    ⚖ Weigh
                  </span>
                )}
              </div>
              {row.description && (
                <span className="text-[11px] text-muted-foreground truncate">
                  {row.description}
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        key:    "department_id",
        header: "Department",
        render: (row) => {
          const dept = deptMap[row.department_id];
          if (!dept) return <span className="text-[11px] text-muted-foreground/40">—</span>;
          return (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Tag className="h-2.5 w-2.5 shrink-0" />
              {dept.department_name}
            </span>
          );
        },
      },
      {
        key:    "default_tax_rate",
        header: "Tax %",
        align:  "center",
        render: (row) =>
          row.default_tax_rate != null ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {parseFloat(row.default_tax_rate).toFixed(1)}%
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/40">—</span>
          ),
      },
      {
        key:    "is_active",
        header: "Status",
        align:  "center",
        render: (row) => (
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
            row.is_active
              ? "border-success/25 bg-success/10 text-success"
              : "border-border/60 bg-muted text-muted-foreground",
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              row.is_active ? "bg-success" : "bg-muted-foreground/40",
            )} />
            {row.is_active ? "Active" : "Inactive"}
          </span>
        ),
      },
      {
        key:      "created_at",
        header:   "Created",
        sortable: true,
        render:   (row) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDate(row.created_at)}
          </span>
        ),
      },
    ];

    if (!canManage) return base;

    return [
      ...base,
      {
        key:    "actions",
        header: "",
        align:  "right",
        render: (row) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Edit"
              onClick={(e) => { e.stopPropagation(); openEdit(row); }}>
              <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
              title={row.is_active ? "Deactivate" : "Activate"}
              onClick={(e) => { e.stopPropagation(); openToggle(row); }}>
              {row.is_active
                ? <PowerOff className="h-3.5 w-3.5 text-warning" />
                : <Power    className="h-3.5 w-3.5 text-success" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
              title="Delete permanently"
              onClick={(e) => { e.stopPropagation(); openHardDelete(row); }}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ),
      },
    ];
  }, [canManage, deptMap, openEdit, openToggle, openHardDelete]);

  // ── Guards ──────────────────────────────────────────────────────────────
  if (!storeId) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-center">
        <div className="space-y-2">
          <LayoutGrid className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Select a store to manage its categories.</p>
        </div>
      </div>
    );
  }
  if (isLoading && !categories.length) return <Spinner />;
  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-5">
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
          {typeof error === "string" ? error : "Unable to load categories."}
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title="Categories"
        description="Group products into categories. Each category can optionally belong to a department."
        action={
          canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New Category
            </Button>
          )
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* KPI stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total"       value={categories.length} sub="categories in store" accent="primary" />
            <StatCard label="Active"      value={activeList.length} sub="shown in product forms" accent="success" />
            <StatCard
              label="Inactive"
              value={inactiveList.length}
              sub="hidden from forms"
              accent={inactiveList.length > 0 ? "warning" : "muted"}
            />
            <StatCard
              label="Departments"
              value={deptCount}
              sub={deptCount === 1 ? "department used" : "departments used"}
              accent="default"
            />
          </div>

          {/* Category list */}
          <Section
            title="All Categories"
            action={
              <>
                <StatusTabs active={statusTab} onChange={setStatusTab} counts={counts} />
                {departments.length > 0 && (
                  <DeptFilter
                    departments={departments}
                    activeDeptId={activeDeptId}
                    onChange={setActiveDeptId}
                  />
                )}
              </>
            }
          >
            <DataTable
              columns={columns}
              data={filtered}
              isLoading={isLoading}
              rowKey="id"
              onRowClick={canManage ? openEdit : undefined}
              emptyState={
                <EmptyState
                  icon={LayoutGrid}
                  title={
                    activeDeptId          ? "No categories in this department"
                    : statusTab !== "all" ? `No ${statusTab} categories`
                    : "No categories yet"
                  }
                  description={
                    activeDeptId
                      ? "Clear the department filter or create a new category here."
                      : statusTab !== "all"
                      ? "Switch tabs to see categories in other states."
                      : "Create your first category to start organising products."
                  }
                  action={
                    canManage && !activeDeptId && statusTab === "all" ? (
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        New Category
                      </Button>
                    ) : undefined
                  }
                  compact
                />
              }
            />
          </Section>

          {/* Legend */}
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-5 px-1 text-[11px] text-muted-foreground">
              {canManage && (
                <div className="flex items-center gap-1.5">
                  <Edit3 className="h-3 w-3" /><span>Edit</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Power className="h-3 w-3 text-success" /><span>Activate</span>
              </div>
              <div className="flex items-center gap-1.5">
                <PowerOff className="h-3 w-3 text-warning" /><span>Deactivate</span>
              </div>
              {canManage && (
                <div className="flex items-center gap-1.5">
                  <Trash2 className="h-3 w-3 text-destructive" /><span>Delete permanently</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <EyeOff className="h-3 w-3 text-warning" /><span>Hidden from POS</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <CategoryFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        initial={null}
        mutation={create}
        departments={departments}
      />

      {selected && (
        <CategoryFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          initial={selected}
          mutation={update}
          departments={departments}
        />
      )}

      {selected && (
        <ToggleStatusDialog
          open={toggleOpen}
          onOpenChange={setToggleOpen}
          category={selected}
          isActivating={!selected.is_active}
          mutation={selected.is_active ? deactivate : activate}
        />
      )}

      {selected && (
        <HardDeleteDialog
          open={hardDelOpen}
          onOpenChange={setHardDelOpen}
          category={selected}
          mutation={hardDelete}
        />
      )}
    </>
  );
}
