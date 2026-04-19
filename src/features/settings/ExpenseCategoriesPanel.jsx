// ============================================================================
// features/settings/ExpenseCategoriesPanel.jsx
// CRUD for expense categories — global + per-store
// ============================================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Loader2, Layers,
  AlertCircle, Check, ToggleLeft, ToggleRight, Globe,
} from "lucide-react";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { cn }      from "@/lib/utils";
import { toastSuccess, onMutationError } from "@/lib/toast";
import {
  getExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
} from "@/commands/expense_categories";
import { useBranchStore } from "@/stores/branch.store";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

// ── CategoryFormModal ─────────────────────────────────────────────────────────

function CategoryFormModal({ open, onClose, existing, storeId }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name:        existing?.name        ?? "",
    description: existing?.description ?? "",
    is_global:   existing ? existing.store_id === null : false,
  });

  const save = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const payload = {
        name:        form.name.trim(),
        description: form.description.trim() || null,
        store_id:    form.is_global ? null : storeId,
      };
      return existing
        ? updateExpenseCategory(existing.id, { name: payload.name, description: payload.description })
        : createExpenseCategory(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      toastSuccess(
        existing ? "Category Updated" : "Category Created",
        `"${form.name.trim()}" saved.`,
      );
      onClose();
    },
    onError: (e) => onMutationError("Save Failed", e),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Category" : "New Expense Category"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Name *
            </label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Utilities, Marketing…"
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional note about this category…"
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {!existing && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3">
              <div>
                <p className="text-xs font-semibold text-foreground">Global Category</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Available across all stores. Disable to make it specific to this store only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, is_global: !f.is_global }))}
                className={cn(
                  "flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors",
                  form.is_global ? "border-primary bg-primary" : "border-border bg-muted",
                )}
              >
                <span className={cn(
                  "block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                  form.is_global ? "translate-x-3.5" : "translate-x-0.5",
                )} />
              </button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.name.trim()}
            className="gap-1.5"
          >
            {save.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
              : <><Check className="h-3.5 w-3.5" /> {existing ? "Save Changes" : "Create"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CategoryRow ───────────────────────────────────────────────────────────────

function CategoryRow({ cat, storeId, onEdit, onDelete }) {
  const qc     = useQueryClient();
  const isGlobal = cat.store_id === null;

  const toggle = useMutation({
    mutationFn: () => updateExpenseCategory(cat.id, { is_active: !cat.is_active }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["expense-categories"] }),
    onError:    (e) => onMutationError("Toggle Failed", e),
  });

  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
      cat.is_active
        ? "border-border bg-card hover:bg-muted/20"
        : "border-border/40 bg-muted/5 opacity-55",
    )}>
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
        cat.is_active ? "border-primary/20 bg-primary/10" : "border-border bg-muted/20",
      )}>
        {isGlobal
          ? <Globe className={cn("h-3.5 w-3.5", cat.is_active ? "text-primary" : "text-muted-foreground")} />
          : <Layers className={cn("h-3.5 w-3.5", cat.is_active ? "text-primary" : "text-muted-foreground")} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-foreground">{cat.name}</span>
          {isGlobal && (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Global
            </span>
          )}
          {!cat.is_active && (
            <span className="rounded-full border border-border/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Inactive
            </span>
          )}
        </div>
        {cat.description && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{cat.description}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => toggle.mutate()}
          disabled={toggle.isPending}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title={cat.is_active ? "Disable" : "Enable"}
        >
          {toggle.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : cat.is_active
            ? <ToggleRight className="h-4 w-4 text-primary" />
            : <ToggleLeft className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => onEdit(cat)}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(cat)}
          disabled={!cat.is_active || isGlobal}
          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          title={isGlobal ? "Global categories can't be deleted" : "Deactivate"}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── ExpenseCategoriesPanel ────────────────────────────────────────────────────

export function ExpenseCategoriesPanel() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();
  const [modal,  setModal]  = useState(null);
  const [delCat, setDelCat] = useState(null);

  const { data: cats = [], isLoading, error } = useQuery({
    queryKey: ["expense-categories", storeId],
    queryFn:  () => getExpenseCategories(storeId),
    enabled:  !!storeId,
  });

  const confirmDelete = useMutation({
    mutationFn: () => deleteExpenseCategory(delCat.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      toastSuccess("Category Deactivated", `"${delCat.name}" disabled.`);
      setDelCat(null);
    },
    onError: (e) => onMutationError("Delete Failed", e),
  });

  const active   = cats.filter((c) => c.is_active);
  const inactive = cats.filter((c) => !c.is_active);

  if (isLoading) return (
    <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-2 py-12 justify-center text-destructive text-sm">
      <AlertCircle className="h-4 w-4" /> {String(error)}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Expense Categories
            </h3>
          </div>
          <Button size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setModal("create")}>
            <Plus className="h-3.5 w-3.5" /> Add Category
          </Button>
        </div>

        <div className="p-5 space-y-2">
          {active.map((c) => (
            <CategoryRow key={c.id} cat={c} storeId={storeId} onEdit={setModal} onDelete={setDelCat} />
          ))}
          {inactive.length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-1">
                Inactive
              </p>
              {inactive.map((c) => (
                <CategoryRow key={c.id} cat={c} storeId={storeId} onEdit={setModal} onDelete={setDelCat} />
              ))}
            </div>
          )}
          {cats.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No categories yet.</p>
          )}
        </div>
      </div>

      {/* Create / Edit modal */}
      {(modal === "create" || (modal && modal !== "create")) && (
        <CategoryFormModal
          open
          existing={modal !== "create" ? modal : null}
          storeId={storeId}
          onClose={() => setModal(null)}
        />
      )}

      {/* Delete confirm */}
      {delCat && (
        <Dialog open onOpenChange={(o) => !o && setDelCat(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Deactivate "{delCat.name}"?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              This category will be disabled and won't appear in new expense forms.
              Existing expenses keep their category text.
            </p>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setDelCat(null)} disabled={confirmDelete.isPending}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={() => confirmDelete.mutate()} disabled={confirmDelete.isPending} className="gap-1.5">
                {confirmDelete.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Deactivate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
