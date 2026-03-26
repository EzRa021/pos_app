// ============================================================================
// features/labels/PrintLabelsDialog.jsx
// ============================================================================
// Full print-label workflow dialog.
//
// Flow:
//   1. Receives `items` (one or many) + optional `open` / `onOpenChange`.
//   2. Shows each item with its barcode status.
//   3. If any item has no barcode → "Generate Barcodes" button appears.
//   4. Copies selector (default: 1).
//   5. Format picker (58mm / 80mm / A4) — pre-filled from saved template.
//   6. "Print Labels" → calls generateItemLabels → generates HTML → iframe print.
//
// Used from:
//   • ItemDetailView  (single item)
//   • ItemsTable       (row action — single item)
// ============================================================================

import { useState, useEffect, useMemo } from "react";
import {
  Printer, Barcode, AlertTriangle, CheckCircle2,
  Loader2, RefreshCw, X, Plus, Minus, Tag, Info,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useLabelTemplate, usePrintLabels, DEFAULT_TEMPLATE } from "./useLabelPrinting";

// ── Format picker ─────────────────────────────────────────────────────────────
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

// ── Copies stepper ─────────────────────────────────────────────────────────────
function CopiesStepper({ value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 hover:bg-muted/60 transition-colors">
        <Minus className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <span className="w-8 text-center text-sm font-bold tabular-nums text-foreground">{value}</span>
      <button type="button"
        onClick={() => onChange(Math.min(20, value + 1))}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 hover:bg-muted/60 transition-colors">
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <span className="text-xs text-muted-foreground">
        {value === 1 ? "copy per item" : `copies per item`}
      </span>
    </div>
  );
}

// ── Item row with barcode status ───────────────────────────────────────────────
function ItemRow({ item, onGenerate, isGenerating }) {
  const hasBarcode = !!(item.barcode?.trim());
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
      {/* Status icon */}
      <div className="shrink-0">
        {hasBarcode
          ? <CheckCircle2 className="h-4 w-4 text-success" />
          : <AlertTriangle className="h-4 w-4 text-warning" />}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{item.item_name}</p>
        <p className="text-[10px] text-muted-foreground font-mono">
          {item.sku ?? "—"}
          {hasBarcode
            ? <span className="ml-1.5 text-success/80">· {item.barcode}</span>
            : <span className="ml-1.5 text-warning/80">· no barcode</span>
          }
        </p>
      </div>

      {/* Price */}
      <span className="shrink-0 text-xs font-mono font-bold tabular-nums text-foreground">
        {formatCurrency(parseFloat(item.selling_price ?? 0))}
      </span>

      {/* Generate button (only when missing) */}
      {!hasBarcode && (
        <button type="button" onClick={() => onGenerate(item.id)}
          disabled={isGenerating}
          className="shrink-0 flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] font-semibold text-warning hover:bg-warning/20 transition-colors disabled:opacity-50">
          {isGenerating
            ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
            : <Barcode className="h-2.5 w-2.5" />}
          Generate
        </button>
      )}
    </div>
  );
}

// ── PrintLabelsDialog (main export) ───────────────────────────────────────────
export function PrintLabelsDialog({ open, onOpenChange, items = [] }) {
  const { template, isLoading: loadingTemplate } = useLabelTemplate();
  const { print, generateBarcode, isPrinting, isGenerating } = usePrintLabels();

  // Local state for items (so we can update barcode after generation)
  const [localItems, setLocalItems] = useState(items);
  const [copies,     setCopies]     = useState(1);
  const [format,     setFormat]     = useState(null); // null = use template format

  // Sync when items prop changes or dialog opens
  useEffect(() => {
    if (open) {
      setLocalItems(items);
      setCopies(1);
    }
  }, [open, items]);

  // Once template loads, set default format
  useEffect(() => {
    if (template && format === null) {
      setFormat(template.format || "80mm");
    } else if (!template && format === null) {
      setFormat("80mm");
    }
  }, [template, format]);

  const missingBarcodeItems = useMemo(
    () => localItems.filter((i) => !i.barcode?.trim()),
    [localItems],
  );
  const hasMissingBarcodes = missingBarcodeItems.length > 0;

  // Generate barcode for a single item and update local state
  const handleGenerateOne = async (itemId) => {
    try {
      const barcode = await generateBarcode(itemId);
      setLocalItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, barcode } : i)),
      );
      toast.success("Barcode generated.");
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Failed to generate barcode.");
    }
  };

  // Generate barcodes for ALL items that are missing one
  const handleGenerateAll = async () => {
    for (const item of missingBarcodeItems) {
      try {
        const barcode = await generateBarcode(item.id);
        setLocalItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, barcode } : i)),
        );
      } catch { /* skip, user can retry */ }
    }
    toast.success(`Barcodes generated for ${missingBarcodeItems.length} item(s).`);
  };

  // Build the effective template for printing (merge saved + local format override)
  const effectiveTemplate = useMemo(() => ({
    ...(template ?? DEFAULT_TEMPLATE),
    format: format || template?.format || "80mm",
  }), [template, format]);

  const totalLabels = localItems.length * copies;

  const handlePrint = async () => {
    if (!localItems.length) return;
    try {
      await print({
        itemIds:  localItems.map((i) => i.id),
        copies,
        template: effectiveTemplate,
      });
      toast.success(`${totalLabels} label${totalLabels !== 1 ? "s" : ""} sent to printer.`);
      onOpenChange(false);
    } catch (e) {
      // error already shown by usePrintLabels
      toast.error(typeof e === "string" ? e : "Print failed. Check your printer connection.");
    }
  };

  const handleClose = () => {
    if (!isPrinting) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        {/* Accent bar */}
        <div className="h-[3px] w-full bg-primary" />

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Printer className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Print Labels</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {localItems.length} item{localItems.length !== 1 ? "s" : ""} selected
                {totalLabels !== localItems.length && ` · ${totalLabels} labels total`}
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-5 max-h-[60vh] overflow-y-auto">

          {/* Item list */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Items
            </p>
            <div className="rounded-lg border border-border bg-muted/20 px-3">
              {localItems.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">No items selected.</p>
              ) : (
                localItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onGenerate={handleGenerateOne}
                    isGenerating={isGenerating}
                  />
                ))
              )}
            </div>
          </div>

          {/* Missing barcode warning */}
          {hasMissingBarcodes && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/[0.08] px-3.5 py-3">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-warning">
                  {missingBarcodeItems.length} item{missingBarcodeItems.length !== 1 ? "s" : ""} without a barcode
                </p>
                <p className="text-[11px] text-warning/80 mt-0.5 leading-relaxed">
                  Labels will print without a scannable barcode. Generate barcodes first for best results.
                </p>
              </div>
              <Button size="sm" variant="outline"
                onClick={handleGenerateAll}
                disabled={isGenerating}
                className="shrink-0 h-7 gap-1 text-[11px] border-warning/40 text-warning hover:bg-warning/10">
                {isGenerating
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Barcode className="h-3 w-3" />}
                Generate All
              </Button>
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
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> Loading saved template…
                </span>
              )}
              {template && (
                <span className="text-[10px] text-success flex items-center gap-1">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Using saved template
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

          {/* Summary */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2.5">
            <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <p className="text-[11px] text-muted-foreground">
              <strong className="text-foreground">{totalLabels}</strong> label{totalLabels !== 1 ? "s" : ""} will print
              on <strong className="text-foreground">{format || "80mm"}</strong> paper.
            </p>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={handleClose} disabled={isPrinting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handlePrint}
            disabled={isPrinting || !localItems.length || !format}
            className="gap-1.5"
          >
            {isPrinting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Printing…</>
              : <><Printer className="h-3.5 w-3.5" />Print {totalLabels} Label{totalLabels !== 1 ? "s" : ""}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
