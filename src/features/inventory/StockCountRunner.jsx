// ============================================================================
// features/inventory/StockCountRunner.jsx — Active count session UI
// ============================================================================

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, CheckCircle2, Clock, Search, X,
  Package, BarChart3, ChevronRight, AlertTriangle,
  RefreshCw, Check, Minus, Plus as PlusIcon,
} from "lucide-react";

import { PageHeader }  from "@/components/shared/PageHeader";
import { Spinner }     from "@/components/shared/Spinner";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

import { useCountSession }     from "@/features/inventory/useInventory";
import { useInventory }        from "@/features/inventory/useInventory";
import { useBranchStore }      from "@/stores/branch.store";
import { formatDateTime, formatCurrency, formatQuantity, stepForType } from "@/lib/format";
import { cn }                  from "@/lib/utils";

// ── Progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ counted, total }) {
  const pct = total > 0 ? Math.min((counted / total) * 100, 100) : 0;
  const r   = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="relative flex items-center justify-center">
      <svg width="72" height="72" className="-rotate-90">
        <circle cx="36" cy="36" r={r} strokeWidth="4" className="fill-none stroke-muted/30" />
        <circle cx="36" cy="36" r={r} strokeWidth="4" strokeLinecap="round"
          className="fill-none stroke-primary transition-all duration-500"
          strokeDasharray={circ} strokeDashoffset={offset} />
      </svg>
      <div className="absolute text-center">
        <div className="text-sm font-bold text-foreground tabular-nums">{Math.round(pct)}%</div>
      </div>
    </div>
  );
}

// ── Item count row ────────────────────────────────────────────────────────────
function ItemCountRow({ item, onRecord }) {
  const measureType  = item.measurement_type ?? null;
  const unitType     = item.unit_type ?? null;
  const minIncrement = item.min_increment != null ? parseFloat(item.min_increment) : null;
  const step         = stepForType(measureType, minIncrement);
  const defaultQty   = item.default_qty != null ? parseFloat(item.default_qty) : 0;
  const [qty, setQty] = useState("");
  const [open, setOpen] = useState(false);
  const currentQty = parseFloat(item.quantity ?? 0);

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 px-4 py-3 border-b border-border/60 last:border-0 cursor-pointer hover:bg-muted/20 transition-colors"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5 text-[10px] font-bold uppercase text-primary">
          {(item.item_name ?? "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground line-clamp-1">{item.item_name}</div>
          <div className="text-[10px] font-mono text-muted-foreground">{item.sku}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-muted-foreground tabular-nums">
            System: {formatQuantity(currentQty, measureType, unitType)}
          </div>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </div>

      {/* Count dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl">
          <div className="h-[3px] bg-primary" />
          <div className="px-6 pt-5 pb-6">
            <DialogHeader className="mb-4">
              <DialogTitle className="text-[15px] font-bold">{item.item_name}</DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground">
                SKU: {item.sku}{item.barcode ? ` · ${item.barcode}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">System Qty</p>
                <p className="text-lg font-bold tabular-nums">
                  {formatQuantity(currentQty, measureType, unitType)}
                </p>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">Category</p>
                <p className="text-xs font-semibold text-foreground mt-0.5">{item.category_name ?? "—"}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Counted Quantity <span className="text-destructive">*</span>
              </label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                  onClick={() => setQty((v) => String(Math.max(0, parseFloat(v || 0) - step)))}>
                  <Minus className="h-4 w-4" />
                </Button>
                <Input type="number" min={0} step={step}
                  value={qty} onChange={(e) => setQty(e.target.value)}
                  className="text-center text-lg font-bold h-9" placeholder={String(defaultQty || 0)} autoFocus />
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
                  onClick={() => setQty((v) => String(parseFloat(v || 0) + step))}>
                  <PlusIcon className="h-4 w-4" />
                </Button>
              </div>
              {qty !== "" && (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5">
                  <span className="text-[11px] text-muted-foreground">Variance</span>
                  <span className={cn(
                    "text-xs font-bold tabular-nums",
                    parseFloat(qty) - currentQty > 0 ? "text-emerald-400" :
                    parseFloat(qty) - currentQty < 0 ? "text-rose-400" : "text-muted-foreground",
                  )}>
                    {parseFloat(qty) - currentQty >= 0 ? "+" : ""}{formatQuantity(parseFloat(qty) - currentQty, measureType, unitType)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                disabled={qty === ""}
                onClick={() => {
                  onRecord(item.item_id ?? item.id, parseFloat(qty));
                  setOpen(false);
                  setQty("");
                }}>
                <Check className="h-4 w-4" /> Record
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Complete session dialog ───────────────────────────────────────────────────
function CompleteDialog({ open, onOpenChange, session, mutation, navigate }) {
  const [apply, setApply] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl">
        <div className="h-[3px] bg-emerald-500" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">Complete Count?</DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground">
                  {session?.session_number}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="mb-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Items counted</span>
              <span className="font-semibold">{session?.items_counted ?? 0} / {session?.total_items ?? 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Items with variance</span>
              <span className={cn("font-semibold", (session?.items_with_variance ?? 0) > 0 ? "text-amber-400" : "text-emerald-400")}>
                {session?.items_with_variance ?? 0}
              </span>
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 hover:bg-muted/30 mb-4">
            <div onClick={() => setApply((v) => !v)}
              className={cn("relative h-5 w-9 rounded-full transition-colors", apply ? "bg-primary" : "bg-muted/60 border border-border")}>
              <div className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", apply ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">Apply variances to stock</div>
              <div className="text-[10px] text-muted-foreground">Updates actual stock quantities to match counted values</div>
            </div>
          </label>

          {mutation.error && (
            <p className="mb-3 text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">{String(mutation.error)}</p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white" disabled={mutation.isPending}
              onClick={() => mutation.mutate({ applyVariances: apply }, {
                onSuccess: (report) => {
                  onOpenChange(false);
                  navigate(`/stock-counts/${session.id}/report`);
                },
              })}>
              {mutation.isPending ? "Completing…" : "Complete Count"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── StockCountRunner (main export) ────────────────────────────────────────────
export function StockCountRunner({ sessionId }) {
  const navigate = useNavigate();
  const storeId  = useBranchStore((s) => s.activeStore?.id);
  const [search, setSearch] = useState("");
  const [completeOpen, setCompleteOpen] = useState(false);

  const { session, isLoading: sessionLoading, error: sessionError, recordCount, completeSession } =
    useCountSession(sessionId, storeId);

  const { records: allItems, isLoading: itemsLoading } = useInventory({ limit: 500 });

  const isInProgress = session?.status === "in_progress";

  const filteredItems = useMemo(() => {
    if (!search) return allItems;
    const q = search.toLowerCase();
    return allItems.filter(
      (i) => i.item_name?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q),
    );
  }, [allItems, search]);

  if (sessionLoading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (sessionError)   return <div className="p-6 text-sm text-destructive">{String(sessionError)}</div>;
  if (!session)       return <div className="p-6 text-sm text-muted-foreground">Session not found.</div>;

  const counted  = session.items_counted ?? 0;
  const total    = session.total_items   ?? 0;
  const variance = session.items_with_variance ?? 0;

  return (
    <>
      <PageHeader
        backHref="/stock-counts"
        title={session.session_number ?? `Session #${session.id}`}
        description={`${session.count_type ?? "full"} count · Started by ${session.started_by_username ?? "—"}`}
        badge={
          isInProgress
            ? <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400"><Clock className="h-2.5 w-2.5" />In Progress</span>
            : <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"><CheckCircle2 className="h-2.5 w-2.5" />Completed</span>
        }
        action={
          <div className="flex gap-1.5">
            {session.status === "completed" && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/stock-counts/${sessionId}/report`)}>
                <BarChart3 className="h-3.5 w-3.5" /> View Report
              </Button>
            )}
            {isInProgress && (
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => setCompleteOpen(true)}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Complete
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">
          {/* Progress stats */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-6">
              <ProgressRing counted={counted} total={total} />
              <div className="grid grid-cols-3 flex-1 gap-4">
                {[
                  { label: "Counted",    value: counted,  color: "text-primary" },
                  { label: "Remaining",  value: Math.max(0, total - counted), color: "text-muted-foreground" },
                  { label: "Variances",  value: variance, color: variance > 0 ? "text-amber-400" : "text-emerald-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center">
                    <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            {session.notes && (
              <p className="mt-3 text-xs text-muted-foreground border-t border-border/60 pt-3">{session.notes}</p>
            )}
          </div>

          {/* Items to count */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Items</h3>
              {isInProgress && (
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search items…" className="pl-7 h-7 text-xs" />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {isInProgress ? (
              itemsLoading ? (
                <div className="py-8"><Spinner /></div>
              ) : filteredItems.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No items found.</div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto">
                  {filteredItems.map((item) => (
                    <ItemCountRow
                      key={item.item_id}
                      item={item}
                      onRecord={(itemId, qty) => recordCount.mutate({ itemId, countedQuantity: qty })}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="px-4 py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-foreground">Count completed</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {session.items_counted ?? 0} items counted · {session.items_with_variance ?? 0} variances found
                </p>
                <Button size="sm" className="mt-4" onClick={() => navigate(`/stock-counts/${sessionId}/report`)}>
                  <BarChart3 className="h-3.5 w-3.5" /> View Variance Report
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <CompleteDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        session={session}
        mutation={completeSession}
        navigate={navigate}
      />
    </>
  );
}
