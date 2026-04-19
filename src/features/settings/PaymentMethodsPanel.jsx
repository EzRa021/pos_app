// ============================================================================
// features/settings/PaymentMethodsPanel.jsx
// Enable/disable payment methods, rename, require-reference toggle, drag-sort
// ============================================================================
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, AlertCircle, CreditCard, Smartphone, Landmark,
  Banknote, SplitSquareHorizontal, GripVertical, Pencil,
  Check, X, Info, Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import { toastSuccess, onMutationError } from "@/lib/toast";
import {
  getPaymentMethods,
  upsertPaymentMethod,
  reorderPaymentMethods,
} from "@/commands/payment_methods";
import { useBranchStore } from "@/stores/branch.store";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

// ── method metadata ───────────────────────────────────────────────────────────

const METHOD_META = {
  cash:          { icon: Banknote,              label: "Cash",          color: "text-success"     },
  card:          { icon: CreditCard,            label: "Card",          color: "text-primary"     },
  mobile_money:  { icon: Smartphone,            label: "Mobile Money",  color: "text-warning"     },
  bank_transfer: { icon: Landmark,              label: "Bank Transfer", color: "text-violet-400"  },
  split:         { icon: SplitSquareHorizontal, label: "Split",         color: "text-cyan-400"    },
};

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        "flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      <span className={cn(
        "block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-3.5" : "translate-x-0.5",
      )} />
    </button>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditMethodModal({ method, storeId, storeName, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    display_name:      method.display_name,
    require_reference: method.require_reference,
    reference_label:   method.reference_label ?? "",
  });

  // Live preview of what a generated reference will look like
  const storePrefix = (storeName || "STO")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .substring(0, 3)
    .padEnd(3, "X");
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
  const refPreview = `${storePrefix}-${dateStr}-XXXX`;

  const save = useMutation({
    mutationFn: () => upsertPaymentMethod({
      store_id:          storeId,
      method_key:        method.method_key,
      display_name:      form.display_name.trim() || method.display_name,
      is_enabled:        method.is_enabled,
      require_reference: form.require_reference,
      reference_label:   form.require_reference
        ? (form.reference_label.trim() || null)
        : null,
      sort_order:        method.sort_order,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-methods", storeId] });
      toastSuccess("Method Updated", `"${form.display_name || method.display_name}" saved.`);
      onClose();
    },
    onError: (e) => onMutationError("Save Failed", e),
  });

  const meta = METHOD_META[method.method_key] ?? {};

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit — {meta.label ?? method.method_key}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Display Name
            </label>
            <Input
              value={form.display_name}
              onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              placeholder={meta.label}
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              Name shown to cashiers on the POS checkout screen.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3">
              <div>
                <p className="text-xs font-semibold text-foreground">Auto-generate Reference ID</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  The POS auto-creates a unique reference on each transaction using your store prefix. Enable to log it.
                </p>
              </div>
              <Toggle
                checked={form.require_reference}
                onChange={(v) => setForm((f) => ({ ...f, require_reference: v }))}
              />
            </div>

          {form.require_reference && (
            <>
              {/* Preview */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Hash className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-semibold text-primary">Reference format preview</span>
                </div>
                <code className="font-mono text-[13px] font-bold text-foreground tracking-wider">
                  {refPreview}
                </code>
                <p className="text-[10px] text-muted-foreground">
                  <span className="font-semibold">{storePrefix}</span> = first 3 letters of your store name &middot;
                  {" "}<span className="font-semibold">{dateStr}</span> = date &middot;
                  {" "}<span className="font-semibold">XXXX</span> = 4-digit random
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Reference Field Label
                </label>
                <Input
                  value={form.reference_label}
                  onChange={(e) => setForm((f) => ({ ...f, reference_label: e.target.value }))}
                  placeholder="e.g. Terminal Reference, Transaction ID"
                  className="h-9"
                />
                <p className="text-[11px] text-muted-foreground">
                  Label shown above the auto-generated reference in the POS payment popover.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="gap-1.5"
          >
            {save.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
              : <><Check className="h-3.5 w-3.5" /> Save Changes</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── MethodRow ─────────────────────────────────────────────────────────────────

function MethodRow({ method, storeId, onEdit, dragHandleProps }) {
  const qc = useQueryClient();
  const meta = METHOD_META[method.method_key] ?? { icon: CreditCard, label: method.method_key, color: "text-muted-foreground" };
  const Icon = meta.icon;

  const toggle = useMutation({
    mutationFn: () => upsertPaymentMethod({
      store_id:          storeId,
      method_key:        method.method_key,
      display_name:      method.display_name,
      is_enabled:        !method.is_enabled,
      require_reference: method.require_reference,
      reference_label:   method.reference_label,
      sort_order:        method.sort_order,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment-methods", storeId] }),
    onError:   (e) => onMutationError("Toggle Failed", e),
  });

  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
      method.is_enabled ? "border-border bg-card" : "border-border/40 bg-muted/5 opacity-60",
    )}>
      {/* Drag handle */}
      <div
        {...dragHandleProps}
        className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground shrink-0"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Icon */}
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
        method.is_enabled ? "border-border/60 bg-muted/20" : "border-border/30 bg-transparent",
      )}>
        <Icon className={cn("h-3.5 w-3.5", method.is_enabled ? meta.color : "text-muted-foreground/40")} />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground leading-none">{method.display_name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-mono text-muted-foreground/60">{method.method_key}</span>
          {method.require_reference && (
            <span className="text-[10px] text-muted-foreground">· Requires reference</span>
          )}
          {method.reference_label && (
            <span className="text-[10px] text-muted-foreground italic">({method.reference_label})</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onEdit(method)}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <Toggle
          checked={method.is_enabled}
          onChange={() => toggle.mutate()}
          disabled={toggle.isPending}
        />
      </div>
    </div>
  );
}

// ── PaymentMethodsPanel ───────────────────────────────────────────────────────

export function PaymentMethodsPanel() {
  const storeId   = useBranchStore((s) => s.activeStore?.id);
  const storeName = useBranchStore((s) => s.activeStore?.store_name ?? "");
  const qc      = useQueryClient();
  const [editing, setEditing] = useState(null);

  // Drag state
  const [items,    setItems]    = useState(null);
  const [dragging, setDragging] = useState(null);
  const dragOver = useRef(null);

  const { data: methods = [], isLoading, error } = useQuery({
    queryKey: ["payment-methods", storeId],
    queryFn:  () => getPaymentMethods(storeId),
    enabled:  !!storeId,
    onSuccess: (d) => setItems(d),
  });

  // Use local state for drag reorder, fall back to server data
  const list = items ?? methods;

  const saveOrder = useMutation({
    mutationFn: (order) => reorderPaymentMethods(storeId, order),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["payment-methods", storeId] }),
    onError:    (e) => onMutationError("Reorder Failed", e),
  });

  // ── simple drag-and-drop ──
  const handleDragStart = (idx) => setDragging(idx);
  const handleDragEnter = (idx) => { dragOver.current = idx; };
  const handleDragEnd   = () => {
    if (dragging === null || dragOver.current === null || dragging === dragOver.current) {
      setDragging(null);
      dragOver.current = null;
      return;
    }
    const next = [...list];
    const [moved] = next.splice(dragging, 1);
    next.splice(dragOver.current, 0, moved);
    setItems(next);
    setDragging(null);
    dragOver.current = null;
    saveOrder.mutate(next.map((m) => m.method_key));
  };

  if (!storeId) return (
    <p className="py-8 text-center text-xs text-muted-foreground">No store selected.</p>
  );

  if (isLoading) return (
    <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading payment methods…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 py-12 justify-center text-destructive text-sm">
      <AlertCircle className="h-4 w-4" /> {String(error)}
    </div>
  );

  return (
    <div className="space-y-5">

      {/* Method list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/20">
          <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Payment Methods
          </h3>
          {saveOrder.isPending && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
          )}
        </div>

        <div className="p-4 space-y-2">
          {list.map((m, idx) => (
            <div
              key={m.method_key}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className={cn(dragging === idx && "opacity-40")}
            >
              <MethodRow
                method={m}
                storeId={storeId}
                onEdit={setEditing}
                dragHandleProps={{}}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Info callout */}
      <div className="rounded-xl border border-border/60 bg-muted/10 px-5 py-4">
        <div className="flex gap-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-foreground">Tips</p>
            <ul className="text-[11px] text-muted-foreground space-y-1 leading-relaxed list-disc list-inside">
              <li>Drag rows to reorder — cashiers see methods in this order at checkout.</li>
              <li>Enable <strong>Require Reference</strong> for card/transfer to force cashiers to log a transaction ID.</li>
              <li>Disable <strong>Split</strong> if your POS workflow doesn't support multi-tender sales.</li>
              <li>Disabled methods won't appear on the POS checkout screen.</li>
            </ul>
          </div>
        </div>
      </div>

      {editing && (
        <EditMethodModal
          method={editing}
          storeId={storeId}
          storeName={storeName}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
