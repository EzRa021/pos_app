// features/bulk_operations/BulkPriceUpdateDialog.jsx
import { useState } from "react";
import { Loader2, DollarSign, Percent } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useBulkOperations } from "./useBulkOperations";
import { useQuery }          from "@tanstack/react-query";
import { getCategories }     from "@/commands/categories";
import { getDepartments }    from "@/commands/departments";
import { useBranchStore }    from "@/stores/branch.store";

const METHODS = [
  { value: "percentage",      label: "% Increase",  desc: "Increase prices by a percentage" },
  { value: "fixed_increase",  label: "₦ Increase",  desc: "Add a fixed amount to prices" },
  { value: "fixed_decrease",  label: "₦ Decrease",  desc: "Subtract a fixed amount from prices" },
  { value: "set_absolute",    label: "Set Price",    desc: "Set all to a fixed absolute price" },
];

export function BulkPriceUpdateDialog({ open, onOpenChange }) {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const { priceUpdate } = useBulkOperations();

  const [method,      setMethod]      = useState("percentage");
  const [value,       setValue]       = useState("");
  const [categoryId,  setCategoryId]  = useState("");
  const [departmentId,setDepartmentId]= useState("");
  const [roundTo,     setRoundTo]     = useState("");
  const [reason,      setReason]      = useState("");

  const { data: categories  = [] } = useQuery({ queryKey: ["categories",  storeId], queryFn: () => getCategories({ store_id: storeId }), enabled: !!storeId, staleTime: 5 * 60_000, select: (d) => d?.data ?? [] });
  const { data: departments = [] } = useQuery({ queryKey: ["departments", storeId], queryFn: () => getDepartments({ store_id: storeId }), enabled: !!storeId, staleTime: 5 * 60_000, select: (d) => d?.data ?? [] });

  const handleSave = async () => {
    if (!value || isNaN(parseFloat(value))) { toast.error("Enter a valid value."); return; }
    try {
      const result = await priceUpdate.mutateAsync({
        method,
        value:         parseFloat(value),
        category_id:   categoryId   || undefined,
        department_id: departmentId || undefined,
        round_to:      roundTo      ? parseFloat(roundTo) : undefined,
        reason:        reason       || undefined,
      });
      toast.success(`${result?.updated_count ?? "Items"} prices updated.`);
      setValue(""); setReason("");
      onOpenChange(false);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const selectedMethod = METHODS.find((m) => m.value === method);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Bulk Price Update</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">Update prices across categories or departments</DialogDescription>
            </div>
          </div>

          {/* Method selector */}
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button key={m.value} onClick={() => setMethod(m.value)}
                className={cn("rounded-lg border px-3 py-2.5 text-left transition-colors",
                  method === m.value ? "border-primary/40 bg-primary/8 text-primary" : "border-border bg-muted/20 hover:bg-muted/40")}>
                <p className="text-xs font-semibold">{m.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>

          {/* Value */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {method === "percentage" ? "Percentage (%)" : "Amount (₦)"}
            </label>
            <Input type="number" min="0" step="0.01" value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={method === "percentage" ? "e.g. 10" : "e.g. 500"}
              className="h-8 text-sm" autoFocus />
          </div>

          {/* Scope */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Category</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.category_name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Department</label>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.department_name}</option>)}
              </select>
            </div>
          </div>

          {/* Round to */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Round To (optional)</label>
            <Input type="number" min="0" step="50" value={roundTo}
              onChange={(e) => setRoundTo(e.target.value)}
              placeholder="e.g. 50 to round to nearest ₦50" className="h-8 text-sm" />
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Reason</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Cost adjustment, seasonal pricing" className="h-8 text-sm" />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/8 px-3 py-2">
            <p className="text-[11px] text-warning">
              This will update prices for <strong>{!categoryId && !departmentId ? "all active items" : "the filtered scope"}</strong>.
              Consider making a backup first.
            </p>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={priceUpdate.isPending} className="gap-1.5">
            {priceUpdate.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating…</> : "Update Prices"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
