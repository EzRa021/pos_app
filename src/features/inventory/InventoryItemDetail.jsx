// ============================================================================
// features/inventory/InventoryItemDetail.jsx — Per-item inventory detail page
// ============================================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes, BarChart3, RefreshCw, History, AlertTriangle,
  TrendingDown, CheckCircle2, XCircle, ArrowRight,
} from "lucide-react";

import { PageHeader }           from "@/components/shared/PageHeader";
import { Spinner }              from "@/components/shared/Spinner";
import { Button }               from "@/components/ui/button";
import { Separator }            from "@/components/ui/separator";

import { useInventoryItem, useMovementHistory } from "@/features/inventory/useInventory";
import { RestockDialog }         from "@/features/inventory/RestockDialog";
import { AdjustInventoryDialog } from "@/features/inventory/AdjustInventoryDialog";
import { useBranchStore }        from "@/stores/branch.store";
import { formatCurrency, formatDecimal, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Event badge ───────────────────────────────────────────────────────────────
function EventBadge({ type }) {
  const styles = {
    RESTOCK:      "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    ADJUSTMENT:   "border-amber-500/25 bg-amber-500/10 text-amber-400",
    SALE:         "border-rose-500/25 bg-rose-500/10 text-rose-400",
    STOCK_COUNT:  "border-indigo-500/25 bg-indigo-500/10 text-indigo-400",
    DAMAGE:       "border-orange-500/25 bg-orange-500/10 text-orange-400",
    THEFT:        "border-red-500/25 bg-red-500/10 text-red-400",
    CREATE:       "border-primary/25 bg-primary/10 text-primary",
    UPDATE:       "border-sky-500/25 bg-sky-500/10 text-sky-400",
  };
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0",
      styles[type] ?? "border-border/60 bg-muted/40 text-muted-foreground",
    )}>
      {(type ?? "—").replace(/_/g, " ")}
    </span>
  );
}

export function InventoryItemDetail({ itemId }) {
  const navigate  = useNavigate();
  const storeId   = useBranchStore((s) => s.activeStore?.id);
  const [restockOpen, setRestockOpen] = useState(false);
  const [adjustOpen,  setAdjustOpen]  = useState(false);

  const { detail, isLoading, error, restock, adjust } = useInventoryItem(itemId, storeId);
  const { movements, isLoading: movLoading } = useMovementHistory(storeId, { item_id: itemId, limit: 30 });

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (error)     return <div className="p-6 text-sm text-destructive">{String(error)}</div>;
  if (!detail)   return <div className="p-6 text-sm text-muted-foreground">Item not found.</div>;

  const item     = detail;
  const qty      = parseFloat(item.quantity ?? 0);
  const avail    = parseFloat(item.available_quantity ?? 0);
  const reserved = parseFloat(item.reserved_quantity ?? 0);
  const minLevel = item.min_stock_level ?? 0;
  const maxLevel = item.max_stock_level ?? 1000;
  const isLow    = minLevel > 0 && qty <= minLevel;
  const isOut    = qty === 0;
  const pct      = maxLevel > 0 ? Math.min((qty / maxLevel) * 100, 100) : 0;

  return (
    <>
      <PageHeader
        backHref="/inventory"
        title={item.item_name ?? "Item Detail"}
        description={`SKU: ${item.sku ?? "—"}${item.barcode ? ` · ${item.barcode}` : ""}`}
        badge={
          isOut ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
              <XCircle className="h-2.5 w-2.5" /> Out of Stock
            </span>
          ) : isLow ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
              <TrendingDown className="h-2.5 w-2.5" /> Low Stock
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              <CheckCircle2 className="h-2.5 w-2.5" /> Normal
            </span>
          )
        }
        action={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => navigate(`/products/${itemId}`)}>
              View Item <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => setRestockOpen(true)}>
              <RefreshCw className="h-3.5 w-3.5" /> Restock
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
              <BarChart3 className="h-3.5 w-3.5" /> Adjust
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-6 py-5 space-y-5">
          {/* Stock level card */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-4">Stock Overview</h3>

            {isOut && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                <p className="text-xs font-semibold text-red-400">Out of Stock — Immediate restock required</p>
              </div>
            )}
            {!isOut && isLow && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <p className="text-xs font-semibold text-amber-400">
                  Low Stock — {formatDecimal(minLevel - qty)} units below minimum ({formatDecimal(minLevel)})
                </p>
              </div>
            )}

            {/* Stock bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-muted-foreground">Stock Level</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{formatDecimal(qty)} / {formatDecimal(maxLevel)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", isOut ? "bg-red-500" : isLow ? "bg-amber-400" : "bg-emerald-400")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "On Hand",   value: qty,      color: "text-foreground"  },
                { label: "Available", value: avail,    color: "text-emerald-400" },
                { label: "Reserved",  value: reserved, color: "text-amber-400"   },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg border border-border/60 bg-muted/20 p-3 text-center">
                  <p className={cn("text-2xl font-bold tabular-nums", color)}>{formatDecimal(value)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Details row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Item Details</h3>
              <Separator className="bg-border" />
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ["Category",    item.category_name],
                  ["Department",  item.department_name],
                  ["Cost Price",  formatCurrency(parseFloat(item.cost_price ?? 0))],
                  ["Sell Price",  formatCurrency(parseFloat(item.selling_price ?? 0))],
                  ["Min Level",   formatDecimal(minLevel)],
                  ["Max Level",   formatDecimal(maxLevel)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</dt>
                    <dd className="text-foreground font-medium">{value ?? "—"}</dd>
                  </div>
                ))}
                {item.last_count_date && (
                  <div className="col-span-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Last Count</dt>
                    <dd className="text-foreground font-medium">{formatDateTime(item.last_count_date)}</dd>
                  </div>
                )}
              </div>
            </div>

            {/* Inventory value */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Inventory Value</h3>
              <Separator className="bg-border" />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Cost Value</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">
                    {formatCurrency(qty * parseFloat(item.cost_price ?? 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Retail Value</span>
                  <span className="text-sm font-bold text-primary tabular-nums">
                    {formatCurrency(qty * parseFloat(item.selling_price ?? 0))}
                  </span>
                </div>
                <Separator className="bg-border" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Potential Profit</span>
                  <span className="text-sm font-bold text-emerald-400 tabular-nums">
                    {formatCurrency(qty * (parseFloat(item.selling_price ?? 0) - parseFloat(item.cost_price ?? 0)))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Movement history */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/20">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Movement History</h3>
            </div>
            {movLoading ? (
              <div className="py-8"><Spinner /></div>
            ) : movements.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No movements recorded.</div>
            ) : (
              movements.map((m) => (
                <div key={m.id} className="flex items-start gap-3 px-4 py-3 border-b border-border/60 last:border-0 hover:bg-muted/10 transition-colors">
                  <EventBadge type={m.event_type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{m.event_description ?? "—"}</p>
                    {m.notes && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{m.notes}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {m.performed_by_username ? `By ${m.performed_by_username} · ` : ""}{formatDateTime(m.performed_at)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {m.quantity_change != null && (
                      <span className={cn(
                        "text-xs font-bold tabular-nums",
                        parseFloat(m.quantity_change) >= 0 ? "text-emerald-400" : "text-rose-400",
                      )}>
                        {parseFloat(m.quantity_change) >= 0 ? "+" : ""}{formatDecimal(m.quantity_change)}
                      </span>
                    )}
                    {(m.quantity_before != null) && (
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        {formatDecimal(m.quantity_before)} → {formatDecimal(m.quantity_after)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <RestockDialog
        open={restockOpen}
        onOpenChange={setRestockOpen}
        item={item}
        mutation={restock}
      />
      <AdjustInventoryDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        item={item}
        mutation={adjust}
      />
    </>
  );
}
