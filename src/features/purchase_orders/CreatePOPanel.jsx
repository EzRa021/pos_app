// ============================================================================
// features/purchase_orders/CreatePOPanel.jsx
// Create PO with item search — item module integration
// ============================================================================
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck, Package, Search, X, Plus, Minus, Trash2,
  ChevronLeft, AlertTriangle, ShoppingCart, Check,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

import { usePurchaseOrders } from "./usePurchaseOrders";
import { searchSuppliers }   from "@/commands/suppliers";
import { searchItems }       from "@/commands/items";
import { PageHeader }        from "@/components/shared/PageHeader";
import { Button }            from "@/components/ui/button";
import { Input }             from "@/components/ui/input";
import { cn }                from "@/lib/utils";
import { formatCurrency, stepForType, unitLabel, measurementTypeLabel } from "@/lib/format";
import { useBranchStore }    from "@/stores/branch.store";
import { Link }              from "react-router-dom";

// ── Item search autocomplete ──────────────────────────────────────────────────

function ItemSearchBox({ storeId, onAdd, addedIds }) {
  const [query,   setQuery]   = useState("");
  const [open,    setOpen]    = useState(false);
  const ref = useRef(null);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["item-search-po", storeId, query],
    queryFn:  () => searchItems(query, storeId, 10),
    enabled:  query.trim().length >= 1 && !!storeId,
    staleTime: 30 * 1000,
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (item) => {
    onAdd(item);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => query && setOpen(true)}
          placeholder="Search items by name, SKU or barcode…"
          className="pl-9 pr-8 h-9 text-sm"
        />
        {query && (
          <button onClick={() => { setQuery(""); setOpen(false); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && query.trim().length >= 1 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          {isFetching && (
            <div className="px-4 py-3 text-[11px] text-muted-foreground">Searching…</div>
          )}
          {!isFetching && results.length === 0 && (
            <div className="px-4 py-3 text-[11px] text-muted-foreground">No items found for "{query}"</div>
          )}
          {results.map((item) => {
            const alreadyAdded = addedIds.has(item.id);
            return (
              <button
                key={item.id}
                onClick={() => !alreadyAdded && handleSelect(item)}
                disabled={alreadyAdded}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  alreadyAdded
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-muted/50 cursor-pointer",
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/8 text-[10px] font-bold text-primary uppercase">
                  {(item.item_name ?? "").slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{item.item_name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{item.sku}</p>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <p className="text-xs font-mono font-semibold text-foreground">
                    {formatCurrency(parseFloat(item.cost_price ?? item.selling_price ?? 0))}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {unitLabel(item.measurement_type, item.unit_type)} · cost
                  </p>
                </div>
                {alreadyAdded && (
                  <Check className="h-3.5 w-3.5 text-success shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Supplier search autocomplete ──────────────────────────────────────────────

function SupplierSearchBox({ storeId, value, onChange }) {
  const [query,   setQuery]   = useState(value?.supplier_name ?? "");
  const [open,    setOpen]    = useState(false);
  const ref = useRef(null);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["supplier-search-po", storeId, query],
    queryFn:  () => searchSuppliers(query, storeId, 8),
    enabled:  query.trim().length >= 1 && !!storeId,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (supplier) => {
    onChange(supplier);
    setQuery(supplier.supplier_name);
    setOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Truck className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); onChange(null); setOpen(true); }}
          onFocus={() => query && setOpen(true)}
          placeholder="Search and select a supplier…"
          className={cn("pl-9 pr-8 h-9 text-sm", value && "border-success/40 bg-success/5")}
        />
        {(query || value) && (
          <button onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && query.trim().length >= 1 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          {isFetching && (
            <div className="px-4 py-3 text-[11px] text-muted-foreground">Searching…</div>
          )}
          {!isFetching && results.length === 0 && (
            <div className="px-4 py-3 text-[11px] text-muted-foreground">No suppliers found</div>
          )}
          {results.map((s) => (
            <button key={s.id} onClick={() => handleSelect(s)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-primary/25 bg-primary/10 text-[9px] font-bold text-primary uppercase">
                {(s.supplier_name ?? "").slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{s.supplier_name}</p>
                {s.contact_name && <p className="text-[10px] text-muted-foreground">{s.contact_name}</p>}
              </div>
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">{s.supplier_code}</span>
            </button>
          ))}
        </div>
      )}

      {value && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2">
          <Check className="h-3.5 w-3.5 text-success shrink-0" />
          <div>
            <p className="text-xs font-semibold text-foreground">{value.supplier_name}</p>
            <p className="text-[10px] text-muted-foreground">
              {value.supplier_code} · {value.payment_terms ?? "Net 30"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Line item row ─────────────────────────────────────────────────────────────

function LineItem({ line, onQtyChange, onCostChange, onRemove }) {
  const lineTotal = (parseFloat(line.quantity) || 0) * (parseFloat(line.unit_cost) || 0);
  const step      = stepForType(line.measurement_type, line.min_increment);
  const minQty    = step;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/40 last:border-0">
      {/* Item info */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/8 text-[10px] font-bold text-primary uppercase">
          {(line.item_name ?? "").slice(0, 2)}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{line.item_name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[10px] font-mono text-muted-foreground">{line.sku}</p>
            {line.measurement_type && line.measurement_type !== "quantity" && (
              <span className="inline-flex items-center rounded border border-primary/20 bg-primary/8 px-1 py-0 text-[9px] font-semibold uppercase tracking-wide text-primary">
                {unitLabel(line.measurement_type, line.unit_type)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Qty */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => {
            const cur  = parseFloat(line.quantity) || 0;
            const next = parseFloat((Math.max(minQty, cur - step)).toFixed(6));
            onQtyChange(next);
          }}
          className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-muted transition-colors"
        >
          <Minus className="h-3 w-3" />
        </button>
        <Input
          type="number"
          min={minQty}
          step="any"
          value={line.quantity}
          onChange={(e) => onQtyChange(e.target.value)}
          className="h-6 w-16 text-center text-xs px-1"
        />
        <button
          onClick={() => {
            const cur  = parseFloat(line.quantity) || 0;
            const next = parseFloat((cur + step).toFixed(6));
            onQtyChange(next);
          }}
          className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-muted transition-colors"
        >
          <Plus className="h-3 w-3" />
        </button>
        <span className="text-[10px] font-semibold text-muted-foreground w-6 shrink-0">
          {unitLabel(line.measurement_type, line.unit_type)}
        </span>
      </div>

      {/* Unit cost */}
      <div className="shrink-0 w-28">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={line.unit_cost}
          onChange={(e) => onCostChange(e.target.value)}
          className="h-6 w-full text-xs text-right px-2"
          placeholder="0.00"
        />
        <p className="text-[9px] text-muted-foreground text-right mt-0.5">unit cost</p>
      </div>

      {/* Line total */}
      <div className="shrink-0 w-24 text-right">
        <p className="text-xs font-mono font-semibold text-foreground tabular-nums">
          {formatCurrency(lineTotal)}
        </p>
        <p className="text-[9px] text-muted-foreground">subtotal</p>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="shrink-0 flex h-6 w-6 items-center justify-center rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function CreatePOPanel() {
  const navigate   = useNavigate();
  const storeId    = useBranchStore((s) => s.activeStore?.id);
  const { create } = usePurchaseOrders();

  const [supplier, setSupplier] = useState(null);
  const [lines,    setLines]    = useState([]);
  const [notes,    setNotes]    = useState("");
  const [saving,   setSaving]   = useState(false);

  // Set of item UUIDs already in the cart (prevents duplicates)
  const addedIds = useMemo(() => new Set(lines.map((l) => l.item_id)), [lines]);

  const handleAddItem = useCallback((item) => {
    setLines((prev) => [
      ...prev,
      {
        item_id:          item.id,
        item_name:        item.item_name,
        sku:              item.sku,
        measurement_type: item.measurement_type,
        unit_type:        item.unit_type,
        min_increment:    item.min_increment,
        quantity:         stepForType(item.measurement_type, item.min_increment),
        unit_cost:        parseFloat(item.cost_price ?? item.selling_price ?? 0) || 0,
      },
    ]);
  }, []);

  const handleQtyChange  = (idx, v) => setLines((p) => p.map((l, i) => i === idx ? { ...l, quantity:  v } : l));
  const handleCostChange = (idx, v) => setLines((p) => p.map((l, i) => i === idx ? { ...l, unit_cost: v } : l));
  const handleRemove     = (idx)    => setLines((p) => p.filter((_, i) => i !== idx));

  const grandTotal = useMemo(() =>
    lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0), 0),
  [lines]);

  const canSubmit = supplier && lines.length > 0 && !saving;

  const handleCreate = async () => {
    if (!supplier) { toast.error("Select a supplier."); return; }
    if (lines.length === 0) { toast.error("Add at least one item."); return; }

    const invalidLine = lines.find((l) => !(parseFloat(l.quantity) > 0));
    if (invalidLine) { toast.error(`Invalid quantity for "${invalidLine.item_name}".`); return; }

    setSaving(true);
    try {
      const result = await create.mutateAsync({
        supplier_id: supplier.id,
        notes:       notes.trim() || undefined,
        items: lines.map((l) => ({
          item_id:   l.item_id,
          quantity:  parseFloat(l.quantity),
          unit_cost: parseFloat(l.unit_cost) || 0,
        })),
      });
      toast.success(`Purchase order ${result.order.po_number} created.`);
      navigate(`/purchase-orders/${result.order.id}`);
    } catch (err) {
      toast.error(err?.message ?? "Failed to create purchase order.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New Purchase Order"
        description="Select a supplier and add items. Receiving the order will update stock automatically."
      >
        <Link
          to="/purchase-orders"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Back to Purchase Orders
        </Link>
      </PageHeader>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-5 space-y-5">

          {/* Supplier */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
              <Truck className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Supplier</h2>
            </div>
            <div className="p-5">
              <SupplierSearchBox storeId={storeId} value={supplier} onChange={setSupplier} />
            </div>
          </div>

          {/* Items */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2.5">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Items
                </h2>
                {lines.length > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-bold text-primary">
                    {lines.length}
                  </span>
                )}
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Item search */}
              <ItemSearchBox storeId={storeId} onAdd={handleAddItem} addedIds={addedIds} />

              {/* Line items */}
              {lines.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <ShoppingCart className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">Search for items above to add them to this order.</p>
                </div>
              ) : (
                <>
                  {/* Column headers */}
                  <div className="flex items-center gap-3 px-0 pb-1 border-b border-border/40">
                    <div className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Item</div>
                    <div className="w-[108px] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Qty</div>
                    <div className="w-28 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Unit Cost</div>
                    <div className="w-24 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Subtotal</div>
                    <div className="w-6" />
                  </div>

                  {lines.map((line, idx) => (
                    <LineItem
                      key={line.item_id}
                      line={line}
                      onQtyChange={(v)  => handleQtyChange(idx, v)}
                      onCostChange={(v) => handleCostChange(idx, v)}
                      onRemove={() => handleRemove(idx)}
                    />
                  ))}

                  {/* Grand total */}
                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className="text-sm font-semibold text-foreground">Grand Total</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-primary">
                      {formatCurrency(grandTotal)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/20">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Notes (optional)</h2>
            </div>
            <div className="p-5">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Add any notes about this order…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          </div>

          {/* Validation warning */}
          {!supplier && lines.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/8 px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
              <p className="text-[11px] text-warning">Select a supplier before creating the order.</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pb-6">
            <Button variant="outline" onClick={() => navigate("/purchase-orders")} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!canSubmit} className="min-w-[140px]">
              {saving ? "Creating…" : `Create PO (${lines.length} item${lines.length !== 1 ? "s" : ""})`}
            </Button>
          </div>

        </div>
      </div>
    </>
  );
}
