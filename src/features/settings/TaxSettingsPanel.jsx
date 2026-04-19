// ============================================================================
// features/settings/TaxSettingsPanel.jsx
// Full CRUD for tax categories + store-default assignment
// ============================================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Loader2, Tag, CheckCircle2,
  AlertCircle, X, Check, ToggleLeft, ToggleRight,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { cn }       from "@/lib/utils";
import { toastSuccess, onMutationError } from "@/lib/toast";
import {
  getTaxCategories,
  createTaxCategory,
  updateTaxCategory,
  deleteTaxCategory,
} from "@/commands/tax";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtRate = (r) => {
  const n = typeof r === "string" ? parseFloat(r) : r;
  return `${(n * 100).toFixed(4).replace(/\.?0+$/, "")}%`;
};

// ── TaxFormModal ─────────────────────────────────────────────────────────────

const EMPTY = { name: "", code: "", rate: "", is_inclusive: true, description: "" };

function TaxFormModal({ open, onClose, existing }) {
  const qc  = useQueryClient();
  const [form, setForm] = useState(existing
    ? {
        name:         existing.name,
        code:         existing.code,
        rate:         (parseFloat(existing.rate) * 100).toFixed(4).replace(/\.?0+$/, ""),
        is_inclusive: existing.is_inclusive,
        description:  existing.description ?? "",
      }
    : { ...EMPTY });

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const rateDecimal = parseFloat(form.rate) / 100;
      if (isNaN(rateDecimal) || rateDecimal < 0 || rateDecimal > 1)
        throw new Error("Rate must be between 0 and 100");
      const payload = {
        name:         form.name.trim(),
        code:         form.code.trim().toUpperCase(),
        rate:         rateDecimal,
        is_inclusive: form.is_inclusive,
        description:  form.description.trim() || null,
      };
      return existing
        ? updateTaxCategory(existing.id, payload)
        : createTaxCategory(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax-categories"] });
      toastSuccess(
        existing ? "Tax Category Updated" : "Tax Category Created",
        `"${form.name}" is now active.`,
      );
      onClose();
    },
    onError: (e) => onMutationError("Save Failed", e),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Tax Category" : "New Tax Category"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Name *
            </label>
            <Input
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="e.g. Standard VAT"
              className="h-9"
            />
          </div>

          {/* Code */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Code *
            </label>
            <Input
              value={form.code}
              onChange={(e) => set("code")(e.target.value.toUpperCase())}
              placeholder="e.g. VAT"
              maxLength={20}
              className="h-9 font-mono"
            />
            <p className="text-[11px] text-muted-foreground">Short unique identifier used in reports.</p>
          </div>

          {/* Rate */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Rate (%) *
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={form.rate}
                onChange={(e) => set("rate")(e.target.value)}
                placeholder="e.g. 7.5"
                min="0"
                max="100"
                step="0.01"
                className="h-9"
              />
              <span className="text-sm text-muted-foreground shrink-0">%</span>
            </div>
          </div>

          {/* Inclusive toggle */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Tax-Inclusive</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Tax is already included in the item price. Disable if tax is added on top.
              </p>
            </div>
            <button
              type="button"
              onClick={() => set("is_inclusive")(!form.is_inclusive)}
              className={cn(
                "flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors",
                form.is_inclusive ? "border-primary bg-primary" : "border-border bg-muted",
              )}
            >
              <span className={cn(
                "block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                form.is_inclusive ? "translate-x-3.5" : "translate-x-0.5",
              )} />
            </button>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="Optional note…"
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.name.trim() || !form.code.trim() || form.rate === ""}
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

// ── DeleteConfirm ─────────────────────────────────────────────────────────────

function DeleteConfirm({ cat, onClose }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteTaxCategory(cat.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax-categories"] });
      toastSuccess("Tax Category Deactivated", `"${cat.name}" has been disabled.`);
      onClose();
    },
    onError: (e) => onMutationError("Delete Failed", e),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Deactivate "{cat.name}"?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          This tax category will be disabled. Existing items using this category will retain it
          but it won't appear in new item forms.
        </p>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => del.mutate()}
            disabled={del.isPending}
            className="gap-1.5"
          >
            {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── ToggleActiveRow ───────────────────────────────────────────────────────────

function useToggleActive(cat) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => updateTaxCategory(cat.id, { is_active: !cat.is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax-categories"] });
      toastSuccess(
        cat.is_active ? "Category Disabled" : "Category Enabled",
        `"${cat.name}" is now ${cat.is_active ? "inactive" : "active"}.`,
      );
    },
    onError: (e) => onMutationError("Toggle Failed", e),
  });
}

// ── TaxRow ────────────────────────────────────────────────────────────────────

function TaxRow({ cat, onEdit, onDelete }) {
  const toggle = useToggleActive(cat);

  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
      cat.is_active
        ? "border-border bg-card hover:bg-muted/20"
        : "border-border/40 bg-muted/5 opacity-60",
    )}>
      {/* Icon */}
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
        cat.is_active ? "border-primary/20 bg-primary/10" : "border-border bg-muted/20",
      )}>
        <Tag className={cn("h-3.5 w-3.5", cat.is_active ? "text-primary" : "text-muted-foreground")} />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-foreground">{cat.name}</span>
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-bold font-mono text-muted-foreground">
            {cat.code}
          </span>
          {!cat.is_active && (
            <span className="rounded-full border border-border/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-[11px] text-muted-foreground">
            {fmtRate(cat.rate)} · {cat.is_inclusive ? "Inclusive" : "Exclusive"}
          </span>
          {cat.description && (
            <span className="text-[11px] text-muted-foreground truncate">— {cat.description}</span>
          )}
        </div>
      </div>

      {/* Actions */}
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
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(cat)}
          disabled={!cat.is_active}
          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          title="Deactivate"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── TaxSettingsPanel ──────────────────────────────────────────────────────────

export function TaxSettingsPanel() {
  const [modal, setModal]   = useState(null); // null | "create" | TaxCategory (edit)
  const [delCat, setDelCat] = useState(null);

  const { data: cats = [], isLoading, error } = useQuery({
    queryKey: ["tax-categories"],
    queryFn:  getTaxCategories,
  });

  const active   = cats.filter((c) => c.is_active);
  const inactive = cats.filter((c) => !c.is_active);

  if (isLoading) return (
    <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading tax categories…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 py-12 justify-center text-destructive text-sm">
      <AlertCircle className="h-4 w-4" /> {String(error)}
    </div>
  );

  return (
    <div className="space-y-5">

      {/* Header card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Tax Categories
            </h3>
          </div>
          <Button size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setModal("create")}>
            <Plus className="h-3.5 w-3.5" /> Add Category
          </Button>
        </div>

        <div className="p-5 space-y-2">
          {cats.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted/30">
                <Tag className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">No tax categories yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create categories like "Standard VAT 7.5%" or "Tax Exempt".
                </p>
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => setModal("create")}>
                <Plus className="h-3.5 w-3.5" /> Create First Category
              </Button>
            </div>
          ) : (
            <>
              {active.length > 0 && (
                <div className="space-y-2">
                  {active.map((c) => (
                    <TaxRow key={c.id} cat={c} onEdit={setModal} onDelete={setDelCat} />
                  ))}
                </div>
              )}

              {inactive.length > 0 && (
                <div className="space-y-2 mt-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-1">
                    Inactive
                  </p>
                  {inactive.map((c) => (
                    <TaxRow key={c.id} cat={c} onEdit={setModal} onDelete={setDelCat} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Info callout */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <div className="flex gap-3">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-foreground">How tax categories work</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Assign a tax category to each item in your catalog. At checkout the POS applies
              the category's rate — either extracting it from the price (inclusive) or adding
              it on top (exclusive). The <strong>Business Rules</strong> tab controls whether
              your store operates in tax-inclusive mode globally.
            </p>
          </div>
        </div>
      </div>

      {/* Create / Edit modal */}
      {(modal === "create" || (modal && modal !== "create")) && (
        <TaxFormModal
          open
          existing={modal !== "create" ? modal : null}
          onClose={() => setModal(null)}
        />
      )}

      {/* Delete confirm */}
      {delCat && <DeleteConfirm cat={delCat} onClose={() => setDelCat(null)} />}
    </div>
  );
}
