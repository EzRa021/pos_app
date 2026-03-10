// ============================================================================
// features/departments/DepartmentsTable.jsx
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Tag, Plus, Edit3, Trash2, PowerOff, Power, AlertTriangle, Hash,
} from "lucide-react";

import { DataTable }  from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Spinner }    from "@/components/shared/Spinner";
import { Button }     from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input }     from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import { useAnyPermission } from "@/hooks/usePermission";
import { useDepartments }   from "@/features/departments/useDepartments";
import { formatDate }       from "@/lib/format";
import { cn }               from "@/lib/utils";

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, action, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Status tabs ───────────────────────────────────────────────────────────────
const TABS = [
  { key: "all",      label: "All"      },
  { key: "active",   label: "Active"   },
  { key: "inactive", label: "Inactive" },
];

function StatusTabs({ active, onChange, counts }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-1 border border-border/60">
      {TABS.map((tab) => (
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

// ── Department form ───────────────────────────────────────────────────────────
function DepartmentFormDialog({ open, onOpenChange, mode, initial, mutation }) {
  const [name,         setName]         = useState("");
  const [code,         setCode]         = useState("");
  const [description,  setDescription]  = useState("");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [color,        setColor]        = useState("");

  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;
    setName(initial?.department_name ?? "");
    setCode(initial?.department_code ?? "");
    setDescription(initial?.description ?? "");
    setDisplayOrder(initial?.display_order ?? 0);
    setColor(initial?.color ?? "");
  }, [open, initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const payload = {
      department_name:  name.trim(),
      department_code:  code.trim()  || null,
      description:      description.trim() || null,
      display_order:    Number(displayOrder) || 0,
      color:            color.trim() || null,
    };
    const opts = { onSuccess: () => onOpenChange(false) };
    if (isEdit) mutation.mutate({ id: initial.id, ...payload }, opts);
    else        mutation.mutate(payload, opts);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-md border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60">
        <div className="h-[3px] w-full bg-primary" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-5">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                <Tag className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold text-foreground leading-tight">
                  {isEdit ? "Edit Department" : "New Department"}
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  {isEdit
                    ? "Update department details."
                    : "Create a new department to organise your products."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Name — required */}
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Beverages"
                autoFocus
                required
              />
            </div>

            {/* Code + Display order on one row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Code{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. BEV"
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

            {/* Color */}
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Color{" "}
                <span className="font-normal text-muted-foreground">(optional — hex or name)</span>
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#3b82f6 or blue"
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

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Description{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
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

// ── Toggle status dialog ──────────────────────────────────────────────────────
function ToggleStatusDialog({ open, onOpenChange, department, isActivating, mutation }) {
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
                {isActivating ? "Activate department?" : "Deactivate department?"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-[11px] text-muted-foreground leading-relaxed">
              {isActivating ? (
                <>
                  <span className="font-semibold text-foreground">{department?.department_name}</span>
                  {" "}will reappear in product forms and filters.
                </>
              ) : (
                <>
                  <span className="font-semibold text-foreground">{department?.department_name}</span>
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
              onClick={() => mutation.mutate(department.id, { onSuccess: () => onOpenChange(false) })}
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

// ── Hard-delete dialog ────────────────────────────────────────────────────────
function HardDeleteDialog({ open, onOpenChange, department, mutation }) {
  const [confirmText, setConfirmText] = useState("");
  useEffect(() => { if (!open) setConfirmText(""); }, [open]);
  const nameMatches =
    confirmText.trim().toLowerCase() === department?.department_name?.toLowerCase();

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
                    <span className="font-bold">{department?.department_name}</span> from the
                    database. Products linked to it will lose their department reference.
                    This <span className="font-bold">cannot be undone</span>.
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1.5">
                    Type{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {department?.department_name}
                    </span>{" "}
                    to confirm:
                  </p>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={department?.department_name}
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
              onClick={() => mutation.mutate(department.id, { onSuccess: () => onOpenChange(false) })}>
              {mutation.isPending ? "Deleting…" : "Delete Permanently"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Table column definitions ──────────────────────────────────────────────────
const BASE_COLUMNS = [
  {
    key:      "department_name",
    header:   "Department",
    sortable: true,
    render:   (row) => (
      <div className="flex items-center gap-2.5">
        {/* Avatar swatch — uses the department color if set */}
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold uppercase",
            row.is_active
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-muted/40 bg-muted/30 text-muted-foreground",
          )}
          style={row.color ? { backgroundColor: row.color + "22", borderColor: row.color + "55", color: row.color } : undefined}
        >
          {row.department_name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "text-xs font-semibold",
              row.is_active
                ? "text-foreground"
                : "text-muted-foreground line-through decoration-muted-foreground/50",
            )}>
              {row.department_name}
            </span>
            {/* Code badge */}
            {row.department_code && (
              <span className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/50 px-1.5 py-px text-[10px] font-mono font-medium text-muted-foreground">
                <Hash className="h-2.5 w-2.5" />
                {row.department_code}
              </span>
            )}
          </div>
          {row.description && (
            <span className="text-[11px] text-muted-foreground line-clamp-1">
              {row.description}
            </span>
          )}
        </div>
      </div>
    ),
  },
  {
    key:    "category_count",
    header: "Categories",
    align:  "center",
    render: (row) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        {row.category_count ?? 0}
      </span>
    ),
  },
  {
    key:    "display_order",
    header: "Order",
    align:  "center",
    render: (row) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        {row.display_order ?? 0}
      </span>
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

// ── DepartmentsTable ──────────────────────────────────────────────────────────
export function DepartmentsTable() {
  const canManage = useAnyPermission([
    "departments.create", "departments.update", "departments.delete",
  ]);

  const {
    storeId, departments, isLoading, error,
    create, update, activate, deactivate, hardDelete,
  } = useDepartments();

  const [tab,         setTab]        = useState("all");
  const [createOpen,  setCreateOpen] = useState(false);
  const [editOpen,    setEditOpen]   = useState(false);
  const [toggleOpen,  setToggleOpen] = useState(false);
  const [hardDelOpen, setHardDelOpen] = useState(false);
  const [selected,    setSelected]   = useState(null);

  const { filtered, counts } = useMemo(() => {
    const activeList   = departments.filter((d) =>  d.is_active);
    const inactiveList = departments.filter((d) => !d.is_active);
    const filtered =
      tab === "active"   ? activeList
      : tab === "inactive" ? inactiveList
      : departments;
    return {
      filtered,
      counts: {
        all:      departments.length,
        active:   activeList.length,
        inactive: inactiveList.length,
      },
    };
  }, [departments, tab]);

  const openEdit       = useCallback((row) => { setSelected(row); setEditOpen(true);    }, []);
  const openToggle     = useCallback((row) => { setSelected(row); setToggleOpen(true);  }, []);
  const openHardDelete = useCallback((row) => { setSelected(row); setHardDelOpen(true); }, []);

  if (!storeId) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        Select a store to manage its departments.
      </div>
    );
  }
  if (isLoading && !departments.length) return <Spinner />;
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {typeof error === "string" ? error : "Unable to load departments."}
      </div>
    );
  }

  const actionColumn = canManage
    ? [{
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
      }]
    : [];

  const columns = [...BASE_COLUMNS, ...actionColumn];

  return (
    <>
      <PageHeader
        title="Departments"
        description="Organise your catalog into logical departments for easier reporting and filtering."
        action={
          canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New Department
            </Button>
          )
        }
      />

      <Separator className="bg-border" />

      <Section
        title="All Departments"
        action={<StatusTabs active={tab} onChange={setTab} counts={counts} />}
      >
        <DataTable
          columns={columns}
          data={filtered}
          isLoading={isLoading}
          rowKey="id"
          onRowClick={canManage ? openEdit : undefined}
          emptyState={
            <EmptyState
              icon={Tag}
              title={
                tab === "inactive" ? "No inactive departments"
                : tab === "active"   ? "No active departments"
                : "No departments yet"
              }
              description={
                tab === "all"
                  ? "Create your first department to start grouping products."
                  : "Try switching tabs to see departments in other states."
              }
              compact
            />
          }
        />
      </Section>

      {departments.length > 0 && (
        <div className="flex items-center gap-4 px-1 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Power className="h-3 w-3 text-success" /><span>Activate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <PowerOff className="h-3 w-3 text-warning" /><span>Deactivate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Trash2 className="h-3 w-3 text-destructive" /><span>Delete permanently</span>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <DepartmentFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        initial={null}
        mutation={create}
      />

      {selected && (
        <DepartmentFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          initial={selected}
          mutation={update}
        />
      )}

      {selected && (
        <ToggleStatusDialog
          open={toggleOpen}
          onOpenChange={setToggleOpen}
          department={selected}
          isActivating={!selected.is_active}
          mutation={selected.is_active ? deactivate : activate}
        />
      )}

      {selected && (
        <HardDeleteDialog
          open={hardDelOpen}
          onOpenChange={setHardDelOpen}
          department={selected}
          mutation={hardDelete}
        />
      )}
    </>
  );
}
