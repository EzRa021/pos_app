// ============================================================================
// features/bulk_operations/BulkPriceUpdateDialog.jsx
// ============================================================================
// Bulk price update scoped to a category or department.
// Backend: bulk_price_update({ store_id, category_id|department_id, method, value, ... })
// ============================================================================
import { useState } from "react";
import { Loader2, Tag, AlertTriangle } from "lucide-react";
import { toast }   from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { cn }      from "@/lib/utils";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useBulkOperations } from "./useBulkOperations";
import { getCategories }     from "@/commands/categories";
import { getDepartments }    from "@/commands/departments";
import { useBranchStore }    from "@/stores/branch.store";

const METHODS = [
  { value: "percentage",     label: "% Increase",  desc: "Increase prices by a percentage"     },
  { value: "fixed_increase", label: "₦ Increase",  desc: "Add a fixed amount to each price"    },
  { value: "fixed_decrease", label: "₦ Decrease",  desc: "Subtract a fixed amount from prices" },
  { value: "set_absolute",   label: "Set Exact",   desc: "Set every price to this exact value"  },
];

const SCOPE_OPTS = [
  { value: "category",   label: "Category"   },
  { value: "department", label: "Department" },
];

export function BulkPriceUpdateDialog({ open, onOpenChange }) {
  const storeId         = useBranchStore((s) => s.activeStore?.id);
  const { priceUpdate } = useBulkOperations();

  const [method,       setMethod]       = useState("percentage");
  const [value,        setValue]        = useState("");
  const [scope,        setScope]        = useState("category");   // "category" | "department"
  const [categoryId,   setCategoryId]   = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [roundTo,      setRoundTo]      = useState("");
  const [updateCost,   setUpdateCost]   = useState(false);
  const [reason,       setReason]       = useState("");

  // getCategories(storeId) — takes storeId directly
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
  const canSubmit     = !!value && !isNaN(parseFloat(value)) && scopeSelected;

  const scopeLabel = scope === "category"
    ? (categories.find((c) => String(c.id) === categoryId)?.category_name ?? "")
    : (departments.find((d) => String(d.id) === departmentId)?.department_name ?? "");

  const reset = () => {
    setValue(""); setReason(""); setRoundTo("");
    setCategoryId(""); setDepartmentId(""); setUpdateCost(false);
  };

  const handleOpenChange = (val) => { if (!val) reset(); onOpenChange(val); };

  const handleSave = async () => {
    if (!canSubmit) return;
    try {
      const payload = {
        method,
        value:         parseFloat(value),
        category_id:   scope === "category"   && categoryId   ? parseInt(categoryId, 10)   : undefined,
        department_id: scope === "department" && departmentId ? parseInt(departmentId, 10) : undefined,
        round_to:      roundTo ? parseFloat(roundTo) : undefined,
        update_cost:   updateCost || undefined,
        reason:        reason.trim() || undefined,
      };
      const result = await priceUpdate.mutateAsync(payload);
      toast.success(result?.message ?? `${result?.affected ?? 0} item(s) updated.`);
      handleOpenChange(false);
    } catch (e) {
      toast.error(typeof e === "string" ? e : e?.message ?? "Bulk price update failed.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Tag className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Bulk Price Update</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Reprice all items in a category or department
              </DialogDescription>
            </div>
          </div>

          {/* Method */}
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button key={m.value} onClick={() => setMethod(m.value)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  method === m.value
                    ? "border-primary/40 bg-primary/[0.08] text-primary"
                    : "border-border bg-muted/20 hover:bg-muted/40",
                )}>
                <p className="text-xs font-semibold">{m.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>

          {/* Value */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {method === "percentage" ? "Percentage (%)" : "Amount (₦)"} <span className="text-destructive">*</span>
            </label>
            <Input
              type="number" min="0" step="0.01" value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={method === "percentage" ? "e.g. 10" : "e.g. 500"}
              className="h-8 text-sm" autoFocus
            />
          </div>

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
                      ? "border-primary/40 bg-primary/[0.08] text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}>
                  {s.label}
                </button>
              ))}
            </div>
            {scope === "category" ? (
              <select
                value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— Select a category —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.category_name}</option>)}
              </select>
            ) : (
              <select
                value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— Select a department —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.department_name}</option>)}
              </select>
            )}
          </div>

          {/* Advanced row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Round To (₦)
              </label>
              <Input
                type="number" min="0" step="50" value={roundTo}
                onChange={(e) => setRoundTo(e.target.value)}
                placeholder="e.g. 50" className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Reason</label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Optional" className="h-8 text-sm" />
            </div>
          </div>

          {/* Update cost toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary" />
            <span className="text-xs text-foreground">Also update cost price using same method</span>
          </label>

          {/* Warning */}
          {scopeSelected && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.08] px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
              <p className="text-[11px] text-warning leading-relaxed">
                All active items in <strong>{scopeLabel}</strong> will be repriced.
                This cannot be undone — consider a backup first.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={priceUpdate.isPending || !canSubmit} className="gap-1.5">
            {priceUpdate.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating…</>
              : "Update Prices"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
