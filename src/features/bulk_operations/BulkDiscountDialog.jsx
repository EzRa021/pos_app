// ============================================================================
// features/bulk_operations/BulkDiscountDialog.jsx
// ============================================================================
// Apply a % discount to all items in a category or department.
// percent = 0 → clears existing discounts.
// Backend: bulk_apply_discount({ store_id, category_id|department_id, percent })
// ============================================================================
import { useState } from "react";
import { Loader2, Percent, AlertTriangle, X } from "lucide-react";
import { toast }    from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { cn }       from "@/lib/utils";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useBulkOperations } from "./useBulkOperations";
import { getCategories }     from "@/commands/categories";
import { getDepartments }    from "@/commands/departments";
import { useBranchStore }    from "@/stores/branch.store";

const SCOPE_OPTS = [
  { value: "category",   label: "Category"   },
  { value: "department", label: "Department" },
];

export function BulkDiscountDialog({ open, onOpenChange }) {
  const storeId          = useBranchStore((s) => s.activeStore?.id);
  const { applyDiscount } = useBulkOperations();

  const [scope,        setScope]        = useState("category");
  const [categoryId,   setCategoryId]   = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [percent,      setPercent]      = useState("");
  const [clearMode,    setClearMode]    = useState(false);  // clear existing discounts

  const { data: categories = [] } = useQuery({
    queryKey: ["categories", storeId],
    queryFn:  () => getCategories(storeId),
    enabled:  !!storeId,
    staleTime: 5 * 60_000,
    select: (d) => Array.isArray(d) ? d : (d?.data ?? []),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments", storeId],
    queryFn:  () => getDepartments(storeId),
    enabled:  !!storeId,
    staleTime: 5 * 60_000,
    select: (d) => Array.isArray(d) ? d : (d?.data ?? []),
  });

  const scopeSelected = scope === "category" ? !!categoryId : !!departmentId;
  const pct           = clearMode ? 0 : parseFloat(percent);
  const canSubmit     = scopeSelected && (clearMode || (!isNaN(pct) && pct > 0 && pct <= 100));

  const scopeLabel = scope === "category"
    ? (categories.find((c) => String(c.id) === categoryId)?.category_name ?? "")
    : (departments.find((d) => String(d.id) === departmentId)?.department_name ?? "");

  const reset = () => {
    setScope("category"); setCategoryId(""); setDepartmentId("");
    setPercent(""); setClearMode(false);
  };

  const handleOpenChange = (val) => { if (!val) reset(); onOpenChange(val); };

  const handleSave = async () => {
    if (!canSubmit) return;
    try {
      const payload = {
        percent:       pct,
        category_id:   scope === "category"   && categoryId   ? parseInt(categoryId, 10)   : undefined,
        department_id: scope === "department" && departmentId ? parseInt(departmentId, 10) : undefined,
      };
      const result = await applyDiscount.mutateAsync(payload);
      toast.success(result?.message ?? `Discount applied to ${result?.affected ?? 0} item(s).`);
      handleOpenChange(false);
    } catch (e) {
      toast.error(typeof e === "string" ? e : e?.message ?? "Failed to apply discount.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-success" />
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-success/25 bg-success/10">
              <Percent className="h-5 w-5 text-success" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Apply Bulk Discount</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Set a discount % across a category or department
              </DialogDescription>
            </div>
          </div>

          {/* Clear mode toggle */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
            <input type="checkbox" id="clear-mode" checked={clearMode} onChange={(e) => setClearMode(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary" />
            <label htmlFor="clear-mode" className="text-xs text-foreground cursor-pointer select-none">
              Clear existing discounts instead (set percent to 0)
            </label>
          </div>

          {/* Discount % */}
          {!clearMode && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Discount % <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Input
                  type="number" min="0.1" max="100" step="0.5" value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder="e.g. 15" className="h-8 text-sm pr-8" autoFocus
                />
                <Percent className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
              {percent && !isNaN(pct) && (
                <p className="text-[11px] text-muted-foreground">
                  A ₦1,000 item becomes <strong>₦{(1000 * (1 - pct / 100)).toFixed(2)}</strong>
                </p>
              )}
            </div>
          )}

          {/* Scope */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Scope <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2">
              {SCOPE_OPTS.map((s) => (
                <button key={s.value} onClick={() => setScope(s.value)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                    scope === s.value
                      ? "border-success/40 bg-success/[0.08] text-success"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}>
                  {s.label}
                </button>
              ))}
            </div>
            {scope === "category" ? (
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="">— Select a category —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.category_name}</option>)}
              </select>
            ) : (
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="">— Select a department —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.department_name}</option>)}
              </select>
            )}
          </div>

          {/* Warning */}
          {scopeSelected && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.08] px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
              <p className="text-[11px] text-warning leading-relaxed">
                {clearMode
                  ? <>All discount prices in <strong>{scopeLabel}</strong> will be cleared.</>
                  : <><strong>{pct || "?"}%</strong> discount will be applied to all items in <strong>{scopeLabel}</strong>.</>}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button
            size="sm" onClick={handleSave}
            disabled={applyDiscount.isPending || !canSubmit}
            className={cn("gap-1.5", clearMode ? "" : "bg-success hover:bg-success/90 text-white")}
          >
            {applyDiscount.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Applying…</>
              : clearMode ? "Clear Discounts" : "Apply Discount"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
