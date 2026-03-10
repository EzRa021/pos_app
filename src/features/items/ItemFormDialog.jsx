// ============================================================================
// features/items/ItemFormDialog.jsx
// ============================================================================
// Shared create / edit dialog for product items.
//
// Sections:
//   1. Basic Info    — item_name, sku, barcode, description
//   2. Classification — category_id (required), department_id
//   3. Pricing       — cost_price, selling_price, discount_price + live margin
//   4. Stock         — track_stock, initial_quantity (create only), min/max levels
//   5. Settings      — all boolean flags + unit type/value
// ============================================================================

import { useState, useEffect } from "react";
import {
  Package, RefreshCw, ShoppingCart, BarChart2,
  Tag, Building2, DollarSign, Layers, Settings2,
  Percent, Scale, AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn }     from "@/lib/utils";
import { useCategories } from "@/features/categories/useCategories";
import { useDepartments } from "@/features/departments/useDepartments";

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateSku() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function calcMargin(cost, sell) {
  const c = parseFloat(cost);
  const s = parseFloat(sell);
  if (!c || !s || c <= 0) return null;
  return ((s - c) / c * 100).toFixed(1);
}

function toNum(s) {
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function FormSection({ icon: Icon, title, children, accent = "default" }) {
  const accents = {
    default: "border-border/60",
    primary: "border-primary/25",
    success: "border-success/25",
    warning: "border-warning/25",
  };
  return (
    <div className={cn("rounded-xl border bg-muted/20 overflow-hidden", accents[accent])}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/30">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="px-4 py-4 space-y-3">{children}</div>
    </div>
  );
}

// ── FieldRow ──────────────────────────────────────────────────────────────────
function FieldRow({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-foreground mb-1.5">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Toggle flag row ────────────────────────────────────────────────────────────
function FlagRow({ label, description, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          "flex items-center gap-1.5 shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold",
          "transition-all duration-150",
          value
            ? "border-success/30 bg-success/10 text-success"
            : "border-border/60 bg-muted text-muted-foreground",
        )}
      >
        {value
          ? <><CheckCircle2 className="h-3 w-3" />Yes</>
          : <><XCircle className="h-3 w-3" />No</>
        }
      </button>
    </div>
  );
}

// ── Styled native select ───────────────────────────────────────────────────────
function NativeSelect({ value, onChange, children, placeholder, disabled }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      disabled={disabled}
      className={cn(
        "w-full h-9 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground",
        "focus:outline-none focus:ring-1 focus:ring-ring",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        (!value) && "text-muted-foreground",
      )}
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  );
}

// ── Default form values ────────────────────────────────────────────────────────
const DEFAULTS = {
  item_name: "", sku: "", barcode: "", description: "",
  category_id: null, department_id: null,
  cost_price: "", selling_price: "", discount_price: "",
  initial_quantity: "0",
  track_stock: true, min_stock_level: "0", max_stock_level: "1000",
  allow_negative_stock: false,
  is_active: true, sellable: true, available_for_pos: true,
  taxable: false, allow_discount: true, max_discount_percent: "",
  unit_type: "", unit_value: "",
  requires_weight: false,
};

function itemToForm(item) {
  if (!item) return DEFAULTS;
  return {
    item_name:            item.item_name ?? "",
    sku:                  item.sku ?? "",
    barcode:              item.barcode ?? "",
    description:          item.description ?? "",
    category_id:          item.category_id ?? null,
    department_id:        item.department_id ?? null,
    cost_price:           item.cost_price   != null ? String(parseFloat(item.cost_price))   : "",
    selling_price:        item.selling_price != null ? String(parseFloat(item.selling_price)) : "",
    discount_price:       item.discount_price != null ? String(parseFloat(item.discount_price)) : "",
    initial_quantity:     "0",
    track_stock:          item.track_stock         ?? true,
    min_stock_level:      item.min_stock_level      != null ? String(item.min_stock_level)      : "0",
    max_stock_level:      item.max_stock_level      != null ? String(item.max_stock_level)      : "1000",
    allow_negative_stock: item.allow_negative_stock ?? false,
    is_active:            item.is_active            ?? true,
    sellable:             item.sellable             ?? true,
    available_for_pos:    item.available_for_pos    ?? true,
    taxable:              item.taxable              ?? false,
    allow_discount:       item.allow_discount       ?? true,
    max_discount_percent: item.max_discount_percent != null ? String(parseFloat(item.max_discount_percent)) : "",
    unit_type:            item.unit_type            ?? "",
    unit_value:           item.unit_value           != null ? String(parseFloat(item.unit_value)) : "",
    requires_weight:      item.requires_weight      ?? false,
  };
}

// ── ItemFormDialog ─────────────────────────────────────────────────────────────

export function ItemFormDialog({ open, onOpenChange, mode, initial, mutation, storeId }) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState(DEFAULTS);
  const set = (field, val) => setForm((f) => ({ ...f, [field]: val }));

  // Load categories and departments for this store
  const { categories } = useCategories();
  const { departments } = useDepartments();

  // Reset form when dialog opens or target item changes
  useEffect(() => {
    if (!open) return;
    setForm(isEdit ? itemToForm(initial) : DEFAULTS);
  }, [open, initial?.id, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const margin = calcMargin(form.cost_price, form.selling_price);

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.item_name.trim() || !form.sku.trim() || !form.category_id) return;

    const payload = {
      item_name:            form.item_name.trim(),
      sku:                  form.sku.trim().toUpperCase(),
      barcode:              form.barcode.trim() || null,
      description:          form.description.trim() || null,
      category_id:          parseInt(form.category_id, 10),
      department_id:        form.department_id ? parseInt(form.department_id, 10) : null,
      cost_price:           toNum(form.cost_price) ?? 0,
      selling_price:        toNum(form.selling_price) ?? 0,
      discount_price:       toNum(form.discount_price) ?? null,
      track_stock:          form.track_stock,
      min_stock_level:      toNum(form.min_stock_level) ?? 0,
      max_stock_level:      toNum(form.max_stock_level) ?? 1000,
      allow_negative_stock: form.allow_negative_stock,
      is_active:            form.is_active,
      sellable:             form.sellable,
      available_for_pos:    form.available_for_pos,
      taxable:              form.taxable,
      allow_discount:       form.allow_discount,
      max_discount_percent: toNum(form.max_discount_percent) ?? null,
      unit_type:            form.unit_type.trim() || null,
      unit_value:           toNum(form.unit_value) ?? null,
      requires_weight:      form.requires_weight,
      ...(!isEdit && { initial_quantity: toNum(form.initial_quantity) ?? 0 }),
    };

    const opts = { onSuccess: () => onOpenChange(false) };
    if (isEdit) mutation.mutate({ id: initial.id, ...payload }, opts);
    else        mutation.mutate(payload, opts);
  }

  const isValid = form.item_name.trim() && form.sku.trim() && form.category_id;
  const isPending = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !isPending && onOpenChange(v)}>
      <DialogContent className="max-w-2xl border-border bg-card p-0 overflow-hidden shadow-2xl shadow-black/60 flex flex-col max-h-[90vh]">
        {/* Coloured top bar */}
        <div className="h-[3px] w-full bg-primary shrink-0" />

        {/* Header */}
        <div className="px-6 pt-5 pb-3 shrink-0">
          <DialogHeader>
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold text-foreground leading-tight">
                  {isEdit ? `Edit: ${initial?.item_name ?? "Item"}` : "New Product Item"}
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  {isEdit
                    ? "Update item details. All fields are optional — only provided values change."
                    : "Fill in the details below. SKU must be unique across all stores."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-6 pb-2">
          <form id="item-form" onSubmit={handleSubmit} className="space-y-4 pb-2">

            {/* ── 1. Basic Info ──────────────────────────────────────────── */}
            <FormSection icon={Package} title="Basic Info" accent="primary">
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Item Name" required>
                  <Input
                    value={form.item_name}
                    onChange={(e) => set("item_name", e.target.value)}
                    placeholder="e.g. Coca-Cola 50cl"
                    autoFocus
                  />
                </FieldRow>
                <FieldRow label="SKU" required hint="Must be unique. Will be uppercased.">
                  <div className="flex gap-1.5">
                    <Input
                      value={form.sku}
                      onChange={(e) => set("sku", e.target.value.toUpperCase())}
                      placeholder="e.g. CC50CL"
                      className="flex-1"
                    />
                    {!isEdit && (
                      <Button type="button" variant="outline" size="sm" className="shrink-0 px-2"
                        onClick={() => set("sku", generateSku())} title="Generate random SKU">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </FieldRow>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Barcode" hint="Optional — for scanner lookup.">
                  <Input
                    value={form.barcode}
                    onChange={(e) => set("barcode", e.target.value)}
                    placeholder="EAN / UPC / QR code"
                  />
                </FieldRow>
                <FieldRow label="Description">
                  <Input
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder="Short product description"
                  />
                </FieldRow>
              </div>
            </FormSection>

            {/* ── 2. Classification ─────────────────────────────────────── */}
            <FormSection icon={Tag} title="Classification">
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Category" required>
                  <NativeSelect
                    value={form.category_id}
                    onChange={(v) => set("category_id", v)}
                    placeholder="— Select category —"
                  >
                    {categories
                      .filter((c) => c.is_active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>{c.category_name}</option>
                      ))}
                  </NativeSelect>
                </FieldRow>
                <FieldRow label="Department" hint="Optional grouping above category.">
                  <NativeSelect
                    value={form.department_id}
                    onChange={(v) => set("department_id", v)}
                    placeholder="— No department —"
                  >
                    {departments
                      .filter((d) => d.is_active)
                      .map((d) => (
                        <option key={d.id} value={d.id}>{d.department_name}</option>
                      ))}
                  </NativeSelect>
                </FieldRow>
              </div>
            </FormSection>

            {/* ── 3. Pricing ────────────────────────────────────────────── */}
            <FormSection icon={DollarSign} title="Pricing" accent="success">
              <div className="grid grid-cols-3 gap-3">
                <FieldRow label="Cost Price (₦)">
                  <Input
                    type="number" min="0" step="0.01"
                    value={form.cost_price}
                    onChange={(e) => set("cost_price", e.target.value)}
                    placeholder="0.00"
                  />
                </FieldRow>
                <FieldRow label="Selling Price (₦)" required>
                  <Input
                    type="number" min="0" step="0.01"
                    value={form.selling_price}
                    onChange={(e) => set("selling_price", e.target.value)}
                    placeholder="0.00"
                  />
                </FieldRow>
                <FieldRow label="Discount Price (₦)" hint="Leave blank if none.">
                  <Input
                    type="number" min="0" step="0.01"
                    value={form.discount_price}
                    onChange={(e) => set("discount_price", e.target.value)}
                    placeholder="0.00"
                  />
                </FieldRow>
              </div>
              {/* Margin indicator */}
              {margin !== null && (
                <div className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold",
                  parseFloat(margin) >= 0
                    ? "border-success/25 bg-success/10 text-success"
                    : "border-destructive/25 bg-destructive/10 text-destructive",
                )}>
                  <Percent className="h-3 w-3 shrink-0" />
                  Gross margin: {margin}%
                  {parseFloat(margin) < 0 && (
                    <span className="flex items-center gap-1 ml-auto">
                      <AlertTriangle className="h-3 w-3" /> Selling below cost
                    </span>
                  )}
                </div>
              )}
            </FormSection>

            {/* ── 4. Stock ──────────────────────────────────────────────── */}
            <FormSection icon={BarChart2} title="Stock" accent="warning">
              <FlagRow
                label="Track Stock"
                description="Count stock movements and enforce min/max levels."
                value={form.track_stock}
                onChange={(v) => set("track_stock", v)}
              />
              {form.track_stock && (
                <div className="grid grid-cols-3 gap-3 mt-1">
                  {!isEdit && (
                    <FieldRow label="Opening Stock">
                      <Input
                        type="number" min="0" step="0.01"
                        value={form.initial_quantity}
                        onChange={(e) => set("initial_quantity", e.target.value)}
                        placeholder="0"
                      />
                    </FieldRow>
                  )}
                  <FieldRow label="Min Level" hint="Alert threshold.">
                    <Input
                      type="number" min="0" step="1"
                      value={form.min_stock_level}
                      onChange={(e) => set("min_stock_level", e.target.value)}
                      placeholder="0"
                    />
                  </FieldRow>
                  <FieldRow label="Max Level" hint="Reorder ceiling.">
                    <Input
                      type="number" min="0" step="1"
                      value={form.max_stock_level}
                      onChange={(e) => set("max_stock_level", e.target.value)}
                      placeholder="1000"
                    />
                  </FieldRow>
                </div>
              )}
              <FlagRow
                label="Allow Negative Stock"
                description="Sell even when quantity reaches 0."
                value={form.allow_negative_stock}
                onChange={(v) => set("allow_negative_stock", v)}
              />
            </FormSection>

            {/* ── 5. Settings ───────────────────────────────────────────── */}
            <FormSection icon={Settings2} title="Settings">
              <div className="grid grid-cols-2 gap-x-6 divide-y divide-border/30">
                {[
                  ["Active",             "is_active",         "Visible in product catalog."],
                  ["Sellable",           "sellable",          "Can be added to a sale."],
                  ["Available on POS",   "available_for_pos", "Shows in the cashier screen."],
                  ["Taxable",            "taxable",           "Apply tax during checkout."],
                  ["Allow Discount",     "allow_discount",    "Cashier can apply a discount."],
                  ["Requires Weighing",  "requires_weight",   "Prompt cashier to weigh item."],
                ].map(([label, field, desc]) => (
                  <FlagRow
                    key={field}
                    label={label}
                    description={desc}
                    value={form[field]}
                    onChange={(v) => set(field, v)}
                  />
                ))}
              </div>

              {/* Conditional: max discount % */}
              {form.allow_discount && (
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border/30">
                  <FieldRow label="Max Discount %" hint="Leave blank for no limit.">
                    <Input
                      type="number" min="0" max="100" step="0.1"
                      value={form.max_discount_percent}
                      onChange={(e) => set("max_discount_percent", e.target.value)}
                      placeholder="e.g. 20"
                    />
                  </FieldRow>
                  <FieldRow label="Unit Type" hint="e.g. kg, litre, piece.">
                    <Input
                      value={form.unit_type}
                      onChange={(e) => set("unit_type", e.target.value)}
                      placeholder="piece"
                    />
                  </FieldRow>
                  <FieldRow label="Unit Value" hint="Quantity per unit (for weighing).">
                    <Input
                      type="number" min="0" step="0.001"
                      value={form.unit_value}
                      onChange={(e) => set("unit_value", e.target.value)}
                      placeholder="1"
                    />
                  </FieldRow>
                </div>
              )}
            </FormSection>

          </form>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-border bg-muted/20">
          {mutation.error && (
            <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {String(mutation.error)}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1"
              disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="item-form" className="flex-1"
              disabled={isPending || !isValid}>
              {isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Item"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
