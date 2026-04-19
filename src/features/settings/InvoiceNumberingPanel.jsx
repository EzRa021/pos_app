// ============================================================================
// features/settings/InvoiceNumberingPanel.jsx
// Configure prefix, zero-padding and starting number per document type
// ============================================================================
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Hash, Loader2, AlertCircle, Check, Settings2,
  RefreshCw, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { getNumberSeries, updateNumberSeries } from "@/commands/number_series";
import { useBranchStore } from "@/stores/branch.store";

// ── helpers ───────────────────────────────────────────────────────────────────

const DOC_LABELS = {
  invoice:        { label: "Invoice",        desc: "POS sales transactions" },
  receipt:        { label: "Receipt",        desc: "Customer receipts / printed copy" },
  purchase_order: { label: "Purchase Order", desc: "Supplier purchase orders" },
  return:         { label: "Return",         desc: "Product return / refund documents" },
};

const DOC_ORDER = ["invoice", "receipt", "purchase_order", "return"];

// Suffix is appended with a dash when non-empty (invoice format: TNX-0001-LAG)
const preview = (prefix, suffix, padLength, nextNumber) => {
  const num = parseInt(nextNumber, 10);
  if (isNaN(num) || num < 1) return "—";
  const pad = parseInt(padLength, 10);
  if (isNaN(pad) || pad < 1 || pad > 10) return "—";
  const seq = String(num).padStart(pad, "0");
  return suffix?.trim() ? `${prefix}${seq}-${suffix.toUpperCase()}` : `${prefix}${seq}`;
};

// ── SeriesRow ─────────────────────────────────────────────────────────────────

function SeriesRow({ series, storeId }) {
  const qc  = useQueryClient();
  const [form, setForm]   = useState({
    prefix:      series.prefix,
    suffix:      series.suffix ?? "",        // ← NEW
    pad_length:  String(series.pad_length),
    next_number: String(series.next_number),
  });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = (k) => (val) => {
    setForm((f) => ({ ...f, [k]: val }));
    setDirty(true);
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: () => {
      const pad  = parseInt(form.pad_length, 10);
      const next = parseInt(form.next_number, 10);
      if (isNaN(pad)  || pad  < 1 || pad  > 10) throw new Error("Padding must be 1–10 digits");
      if (isNaN(next) || next < 1)               throw new Error("Starting number must be ≥ 1");
      return updateNumberSeries({
        store_id:    storeId,
        doc_type:    series.doc_type,
        prefix:      form.prefix,
        suffix:      form.suffix,
        pad_length:  pad,
        next_number: next,
      });
    },
    onSuccess: (updated) => {
      qc.setQueryData(["number-series", storeId], (old) =>
        old?.map((s) => s.doc_type === series.doc_type ? updated : s) ?? old
      );
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toastSuccess("Series Saved", `${DOC_LABELS[series.doc_type]?.label} numbering updated.`);
    },
    onError: (e) => onMutationError("Save Failed", e),
  });

  const meta = DOC_LABELS[series.doc_type] ?? { label: series.doc_type, desc: "" };
  const exampleStr = preview(form.prefix, form.suffix, form.pad_length, form.next_number);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
        <Hash className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {meta.label}
          </span>
          <span className="text-[11px] text-muted-foreground ml-2">— {meta.desc}</span>
        </div>
        {saved && (
          <div className="flex items-center gap-1 text-[11px] text-success font-semibold">
            <Check className="h-3 w-3" /> Saved
          </div>
        )}
      </div>

      <div className="p-5">
        <div className="grid grid-cols-4 gap-4">
          {/* Prefix */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Prefix
            </label>
            <Input
              value={form.prefix}
              onChange={(e) => set("prefix")(e.target.value.toUpperCase().replace(/\s/g, ""))}
              placeholder="INV-"
              maxLength={10}
              className="h-8 font-mono text-sm"
            />
          </div>

          {/* Suffix */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Store Suffix
            </label>
            <Input
              value={form.suffix}
              onChange={(e) =>
                set("suffix")(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))
              }
              placeholder="LAG"
              maxLength={8}
              className="h-8 font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground">Auto from store name</p>
          </div>

          {/* Pad length */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Zero-Padding
            </label>
            <Input
              type="number"
              value={form.pad_length}
              onChange={(e) => set("pad_length")(e.target.value)}
              min={1}
              max={10}
              className="h-8 font-mono text-sm"
            />
          </div>

          {/* Starting number */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Next Number
            </label>
            <Input
              type="number"
              value={form.next_number}
              onChange={(e) => set("next_number")(e.target.value)}
              min={1}
              className="h-8 font-mono text-sm"
            />
          </div>
        </div>

        {/* Preview + save row */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/60">
          <div className="flex items-center gap-2">
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Preview:</span>
            <span className={cn(
              "font-mono text-[13px] font-bold tracking-wide",
              exampleStr === "—" ? "text-muted-foreground" : "text-primary",
            )}>
              {exampleStr}
            </span>
          </div>

          <Button
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
          >
            {save.isPending
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
              : <><Settings2 className="h-3 w-3" /> Apply</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── InvoiceNumberingPanel ─────────────────────────────────────────────────────

export function InvoiceNumberingPanel() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const { data: series = [], isLoading, error } = useQuery({
    queryKey: ["number-series", storeId],
    queryFn:  () => getNumberSeries(storeId),
    enabled:  !!storeId,
  });

  const ordered = DOC_ORDER
    .map((dt) => series.find((s) => s.doc_type === dt))
    .filter(Boolean);

  if (!storeId) return (
    <p className="py-8 text-center text-xs text-muted-foreground">No store selected.</p>
  );

  if (isLoading) return (
    <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading series…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 py-12 justify-center text-destructive text-sm">
      <AlertCircle className="h-4 w-4" /> {String(error)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-primary/5 px-5 py-3.5">
        <div className="flex gap-3">
          <RefreshCw className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Set the <strong>Prefix</strong> (e.g. <code className="font-mono text-xs bg-muted px-1 rounded">INV-</code>), how many digits to zero-pad
            (e.g. <code className="font-mono text-xs bg-muted px-1 rounded">5</code> → <code className="font-mono text-xs bg-muted px-1 rounded">00001</code>),
            and the <strong>Next Number</strong> in the sequence. Changes apply to the next document generated.
            Lowering <em>Next Number</em> below the current counter may cause duplicate reference numbers.
          </p>
        </div>
      </div>

      {ordered.map((s) => (
        <SeriesRow key={s.doc_type} series={s} storeId={storeId} />
      ))}
    </div>
  );
}
