// ============================================================================
// features/labels/BulkPrintLabelsDialog.jsx
// ============================================================================
// Print labels for ALL items in a category or department.
// Uses `print_price_tags` backend endpoint → scope-resolved item list.
//
// Two modes:
//   category   — print labels for every active item in a category
//   department — print labels for every active item in a department
// ============================================================================

import { useState, useMemo, useEffect } from "react";
import {
  Printer, Layers, CheckCircle2, AlertTriangle,
  Loader2, Plus, Minus, Tag, Info,
} from "lucide-react";
import { toast }    from "sonner";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLabelTemplate, usePrintLabels, DEFAULT_TEMPLATE } from "./useLabelPrinting";
import { getCategories }  from "@/commands/categories";
import { getDepartments } from "@/commands/departments";
import { useBranchStore } from "@/stores/branch.store";

// ── Reused sub-components ─────────────────────────────────────────────────────

const FORMATS = [
  { value: "58mm", label: "58 mm", desc: "Narrow thermal"  },
  { value: "80mm", label: "80 mm", desc: "Standard POS"    },
  { value: "a4",   label: "A4",    desc: "Desktop printer" },
];

function FormatPicker({ value, onChange }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {FORMATS.map((f) => (
        <button key={f.value} type="button" onClick={() => onChange(f.value)}
          className={cn(
            "rounded-lg border px-3 py-2.5 text-center transition-colors",
            value === f.value
              ? "border-primary/50 bg-primary/[0.08] text-primary"
              : "border-border bg-muted/20 hover:bg-muted/40 text-foreground",
          )}>
          <p className="text-xs font-bold">{f.label}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{f.desc}</p>
        </button>
      ))}
    </div>
  );
}

function CopiesStepper({ value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 hover:bg-muted/60 transition-colors">
        <Minus className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <span className="w-8 text-center text-sm font-bold tabular-nums text-foreground">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(20, value + 1))}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 hover:bg-muted/60 transition-colors">
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <span className="text-xs text-muted-foreground">
        {value === 1 ? "copy per item" : "copies per item"}
      </span>
    </div>
  );
}

const SCOPE_OPTS = [
  { value: "category",   label: "Category"   },
  { value: "department", label: "Department" },
];

// ── BulkPrintLabelsDialog ─────────────────────────────────────────────────────
export function BulkPrintLabelsDialog({ open, onOpenChange }) {
  const storeId              = useBranchStore((s) => s.activeStore?.id);
  const { template, isLoading: loadingTemplate } = useLabelTemplate();
  const { printBulk, isPrinting }                = usePrintLabels();

  const [scope,        setScope]        = useState("category");
  const [categoryId,   setCategoryId]   = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [copies,       setCopies]       = useState(1);
  const [format,       setFormat]       = useState(null);

  // Seed format from saved template once loaded
  useEffect(() => {
    if (format === null) {
      setFormat(template?.format ?? "80mm");
    }
  }, [template, format]);

  const reset = () => {
    setScope("category"); setCategoryId(""); setDepartmentId("");
    setCopies(1); setFormat(null);
  };

  const handleOpenChange = (val) => { if (!val) reset(); onOpenChange(val); };

  // Category + department lists
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", storeId],
    queryFn:  () => getCategories(storeId),
    enabled:  !!storeId && open,
    staleTime: 5 * 60_000,
    select: (d) => Array.isArray(d) ? d : (d?.data ?? []),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments", storeId],
    queryFn:  () => getDepartments(storeId),
    enabled:  !!storeId && open,
    staleTime: 5 * 60_000,
    select: (d) => Array.isArray(d) ? d : (d?.data ?? []),
  });

  const scopeSelected = scope === "category" ? !!categoryId : !!departmentId;

  const scopeLabel = scope === "category"
    ? (categories.find((c) => String(c.id) === categoryId)?.category_name ?? "")
    : (departments.find((d) => String(d.id) === departmentId)?.department_name ?? "");

  const effectiveTemplate = useMemo(() => ({
    ...(template ?? DEFAULT_TEMPLATE),
    format: format || template?.format || "80mm",
  }), [template, format]);

  const handlePrint = async () => {
    if (!scopeSelected) return;
    try {
      await printBulk({
        categoryId:   scope === "category"   ? parseInt(categoryId, 10)   : undefined,
        departmentId: scope === "department" ? parseInt(departmentId, 10) : undefined,
        copies,
        template: effectiveTemplate,
      });
      toast.success(`Labels for all items in "${scopeLabel}" sent to printer.`);
      handleOpenChange(false);
    } catch (e) {
      toast.error(typeof e === "string" ? e : (e?.message ?? "Print failed."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Layers className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Print Labels by Scope</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Print labels for every active item in a category or department
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-5 max-h-[65vh] overflow-y-auto">

          {/* Scope type toggle */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Scope <span className="text-destructive">*</span>
            </p>
            <div className="flex gap-2">
              {SCOPE_OPTS.map((s) => (
                <button key={s.value} type="button" onClick={() => setScope(s.value)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
                    scope === s.value
                      ? "border-primary/40 bg-primary/[0.08] text-primary"
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

          {/* Scope info */}
          {scopeSelected && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <Tag className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Labels will be printed for every <strong className="text-foreground">active</strong> item
                in <strong className="text-foreground">{scopeLabel}</strong>.
                Items without a barcode will use their SKU as a fallback.
              </p>
            </div>
          )}

          {/* Copies */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Copies per Item
            </p>
            <CopiesStepper value={copies} onChange={setCopies} />
          </div>

          {/* Format */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Paper Format
              </p>
              {loadingTemplate && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />Loading template…
                </span>
              )}
              {template && !loadingTemplate && (
                <span className="text-[10px] text-success flex items-center gap-1">
                  <CheckCircle2 className="h-2.5 w-2.5" />Using saved template
                </span>
              )}
            </div>
            <FormatPicker value={format || "80mm"} onChange={setFormat} />
            {!template && !loadingTemplate && (
              <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                <Info className="h-3 w-3 shrink-0" />
                Save a label template in Settings → Labels to persist this choice.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={isPrinting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handlePrint}
            disabled={isPrinting || !scopeSelected}
            className="gap-1.5">
            {isPrinting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Printing…</>
              : <><Printer className="h-3.5 w-3.5" />Print Labels</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
