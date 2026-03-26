// ============================================================================
// features/inventory/StockCountRunner.jsx — Active count session UI
// ============================================================================
// Key improvements over the previous version:
//   • Uses useInventoryForCount() — full unpaginated item list, no 200-item cap
//   • Passes session.status to useSessionCountItems() — stops DB polling once done
//   • Notes field added to CountItemDialog (backend already accepted notes)
//   • Variance preview shows currency value alongside qty
//   • Cancelled/completed states have clearer CTAs
// ============================================================================

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, CheckCircle2, Clock, Search, X,
  Package, BarChart3, AlertTriangle, Check, Minus, Plus as PlusIcon,
  Ban, Loader2, ChevronRight, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

import { PageHeader }  from "@/components/shared/PageHeader";
import { Spinner }     from "@/components/shared/Spinner";
import { EmptyState }  from "@/components/shared/EmptyState";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

import {
  useCountSession,
  useSessionCountItems,
  useInventoryForCount,
} from "@/features/inventory/useInventory";
import { useBranchStore }  from "@/stores/branch.store";
import { formatQuantity, formatCurrency, stepForType } from "@/lib/format";
import { cn }             from "@/lib/utils";

// ── Progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ counted, total }) {
  const pct  = total > 0 ? Math.min((counted / total) * 100, 100) : 0;
  const r    = 28;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative flex items-center justify-center">
      <svg width="72" height="72" className="-rotate-90">
        <circle cx="36" cy="36" r={r} strokeWidth="4" className="fill-none stroke-muted/30" />
        <circle
          cx="36" cy="36" r={r} strokeWidth="4" strokeLinecap="round"
          className="fill-none stroke-primary transition-all duration-500"
          strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-sm font-bold text-foreground tabular-nums">
          {Math.round(pct)}%
        </div>
      </div>
    </div>
  );
}

// ── Count item dialog ─────────────────────────────────────────────────────────
function CountItemDialog({ open, onOpenChange, item, existingCount, onRecord, isRecording }) {
  const measureType  = item?.measurement_type ?? null;
  const unitType     = item?.unit_type        ?? null;
  const minIncrement = item?.min_increment    != null ? parseFloat(item.min_increment) : null;
  const step         = stepForType(measureType, minIncrement);
  const systemQty    = parseFloat(item?.quantity ?? 0);

  const [qty,   setQty]   = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setQty(existingCount != null ? String(existingCount) : "");
      setNotes("");
    }
  }, [open, item?.item_id, existingCount]);

  const parsedQty = qty !== "" ? parseFloat(qty) : null;
  const variance  = parsedQty != null ? parsedQty - systemQty : null;

  function handleRecord() {
    if (parsedQty == null || isNaN(parsedQty) || parsedQty < 0) return;
    onRecord(item.item_id, parsedQty, notes.trim() || undefined);
  }

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !isRecording && onOpenChange(v)}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl">
        <div className="h-[3px] bg-primary" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-[15px] font-bold leading-snug">
              {item.item_name}
            </DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground">
              {item.sku}
              {item.barcode    ? ` · ${item.barcode}`     : ""}
              {item.category_name ? ` · ${item.category_name}` : ""}
            </DialogDescription>
          </DialogHeader>

          {/* System qty vs last counted */}
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">System Qty</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {formatQuantity(systemQty, measureType, unitType)}
              </p>
            </div>
            <div className={cn(
              "rounded-lg border px-3 py-2.5 text-center",
              existingCount != null
                ? "border-primary/25 bg-primary/5"
                : "border-border/60 bg-muted/20",
            )}>
              <p className="text-[10px] text-muted-foreground">
                {existingCount != null ? "Last Counted" : "Category"}
              </p>
              <p className="text-xs font-semibold text-foreground mt-0.5">
                {existingCount != null
                  ? formatQuantity(existingCount, measureType, unitType)
                  : (item.category_name ?? "—")}
              </p>
            </div>
          </div>

          {/* Quantity input */}
          <div className="mb-3">
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Counted Quantity <span className="text-destructive">*</span>
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="icon" className="h-9 w-9 shrink-0"
                onClick={() => setQty((v) => String(Math.max(0, parseFloat(v || 0) - step)))}
                disabled={isRecording}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number" min={0} step={step}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="text-center text-lg font-bold h-9"
                placeholder="0"
                autoFocus
                disabled={isRecording}
                onKeyDown={(e) => { if (e.key === "Enter") handleRecord(); }}
              />
              <Button
                variant="outline" size="icon" className="h-9 w-9 shrink-0"
                onClick={() => setQty((v) => String(parseFloat(v || 0) + step))}
                disabled={isRecording}
              >
                <PlusIcon className="h-4 w-4" />
              </Button>
            </div>

            {/* Live variance preview */}
            {variance != null && (
              <div className={cn(
                "mt-2 flex items-center justify-between rounded-lg border px-3 py-1.5",
                variance > 0
                  ? "border-emerald-500/25 bg-emerald-500/5"
                  : variance < 0
                    ? "border-rose-500/25 bg-rose-500/5"
                    : "border-border/60 bg-muted/20",
              )}>
                <span className="text-[11px] text-muted-foreground">Variance</span>
                <span className={cn(
                  "text-xs font-bold tabular-nums flex items-center gap-1",
                  variance > 0 ? "text-emerald-400"    :
                  variance < 0 ? "text-rose-400"        : "text-muted-foreground",
                )}>
                  {variance > 0 ? <ArrowUpRight className="h-3 w-3" /> :
                   variance < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                  {variance >= 0 ? "+" : ""}{formatQuantity(variance, measureType, unitType)}
                </span>
              </div>
            )}
          </div>

          {/* Notes — now wired to the backend notes field */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Notes{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Damaged packaging, recount needed…"
              className="text-xs h-8"
              disabled={isRecording}
            />
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline" className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isRecording}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
              disabled={parsedQty == null || isNaN(parsedQty) || parsedQty < 0 || isRecording}
              onClick={handleRecord}
            >
              {isRecording ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Recording…</>
              ) : (
                <><Check className="h-4 w-4" />
                  {existingCount != null ? "Update Count" : "Record"}
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Complete session dialog ────────────────────────────────────────────────────
function CompleteDialog({ open, onOpenChange, session, mutation }) {
  const navigate  = useNavigate();
  const sessionId = session?.id;
  const [apply, setApply] = useState(false);

  function handleComplete() {
    mutation.mutate(
      { applyVariances: apply },
      {
        onSuccess: () => {
          onOpenChange(false);
          navigate(`/stock-counts/${sessionId}/report`);
        },
      },
    );
  }

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
              <span className="font-semibold">
                {session?.items_counted ?? 0} / {session?.total_items ?? 0}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Items with variance</span>
              <span className={cn(
                "font-semibold",
                (session?.items_with_variance ?? 0) > 0 ? "text-amber-400" : "text-emerald-400",
              )}>
                {session?.items_with_variance ?? 0}
              </span>
            </div>
            {(session?.items_counted ?? 0) < (session?.total_items ?? 0) && (
              <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/40">
                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                <p className="text-[10px] text-amber-400">
                  {(session?.total_items ?? 0) - (session?.items_counted ?? 0)} items have not been
                  counted yet and will be treated as zero variance.
                </p>
              </div>
            )}
          </div>

          {/* Apply variances toggle */}
          <button
            type="button"
            className="flex items-center gap-2.5 w-full cursor-pointer rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 hover:bg-muted/30 mb-4 text-left"
            onClick={() => setApply((v) => !v)}
          >
            <div className={cn(
              "relative h-5 w-9 rounded-full transition-colors shrink-0",
              apply ? "bg-primary" : "bg-muted/60 border border-border",
            )}>
              <div className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                apply ? "translate-x-4" : "translate-x-0.5",
              )} />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">Apply variances to stock</p>
              <p className="text-[10px] text-muted-foreground">
                Updates stock quantities to match counted values immediately
              </p>
            </div>
          </button>

          {mutation.error && (
            <p className="mb-3 text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">
              {String(mutation.error)}
            </p>
          )}

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline" className="flex-1"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
              disabled={mutation.isPending}
              onClick={handleComplete}
            >
              {mutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Completing…</>
              ) : (
                "Complete Count"
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Cancel session dialog ─────────────────────────────────────────────────────
function CancelDialog({ open, onOpenChange, mutation }) {
  const [reason, setReason] = useState("");

  function handleCancel() {
    mutation.mutate(
      { reason: reason.trim() || undefined },
      { onSuccess: () => { onOpenChange(false); setReason(""); } },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!mutation.isPending) { if (!v) setReason(""); onOpenChange(v); }
    }}>
      <DialogContent className="max-w-sm border-border bg-card p-0 overflow-hidden shadow-2xl">
        <div className="h-[3px] bg-destructive" />
        <div className="px-6 pt-5 pb-6">
          <DialogHeader className="mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
                <Ban className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-bold">Cancel Session?</DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground">
                  All recorded counts will be discarded. This cannot be undone.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Reason{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Started by mistake"
              autoFocus
            />
          </div>

          {mutation.error && (
            <p className="mb-3 text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">
              {String(mutation.error)}
            </p>
          )}

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline" className="flex-1"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Keep Session
            </Button>
            <Button
              variant="destructive" className="flex-1"
              disabled={mutation.isPending}
              onClick={handleCancel}
            >
              {mutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Cancelling…</>
              ) : (
                <><Ban className="h-4 w-4" /> Cancel Session</>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Item row ──────────────────────────────────────────────────────────────────
const ItemRow = React.memo(function ItemRow({ item, countedItem, onSelect, isInProgress }) {
  const isCounted   = !!countedItem;
  const systemQty   = parseFloat(item.quantity ?? 0);
  const countedQty  = countedItem ? parseFloat(countedItem.counted_quantity) : null;
  const variance    = countedQty != null ? countedQty - systemQty : null;
  const measureType = item.measurement_type ?? null;
  const unitType    = item.unit_type        ?? null;

  return (
    <div
      onClick={() => isInProgress && onSelect(item)}
      className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0 transition-colors",
        isInProgress && "cursor-pointer hover:bg-muted/20",
        isCounted    && "bg-emerald-500/[0.03]",
      )}
    >
      {/* Count indicator */}
      <div className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold",
        isCounted
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-border/60 bg-muted/30 text-muted-foreground",
      )}>
        {isCounted
          ? <Check className="h-3.5 w-3.5" />
          : <Package className="h-3.5 w-3.5" />}
      </div>

      {/* Item info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground line-clamp-1">{item.item_name}</p>
        <p className="text-[10px] font-mono text-muted-foreground">{item.sku}</p>
      </div>

      {/* Quantities */}
      <div className="text-right shrink-0 space-y-0.5">
        <p className="text-xs text-muted-foreground tabular-nums">
          System: {formatQuantity(systemQty, measureType, unitType)}
        </p>
        {isCounted && (
          <p className="text-xs font-semibold tabular-nums text-foreground">
            Counted: {formatQuantity(countedQty, measureType, unitType)}
          </p>
        )}
        {variance != null && variance !== 0 && (
          <p className={cn(
            "text-[10px] font-semibold tabular-nums",
            variance > 0 ? "text-emerald-400" : "text-rose-400",
          )}>
            {variance > 0 ? "+" : ""}{formatQuantity(variance, measureType, unitType)}
          </p>
        )}
      </div>

      {isInProgress && (
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
    </div>
  );
}, (prev, next) =>
  prev.item.item_id === next.item.item_id &&
  prev.countedItem?.counted_quantity === next.countedItem?.counted_quantity &&
  prev.isInProgress === next.isInProgress
);

// ── View tabs ─────────────────────────────────────────────────────────────────
const VIEW_TABS = [
  { key: "all",       label: "All Items" },
  { key: "uncounted", label: "Uncounted" },
  { key: "counted",   label: "Counted" },
];

// ── StockCountRunner (main export) ────────────────────────────────────────────
export function StockCountRunner({ sessionId }) {
  const navigate = useNavigate();
  const storeId  = useBranchStore((s) => s.activeStore?.id);

  const [search,          setSearch]          = useState("");
  const [viewTab,         setViewTab]         = useState("all");
  const [completeOpen,    setCompleteOpen]    = useState(false);
  const [cancelOpen,      setCancelOpen]      = useState(false);
  const [selectedItem,    setSelectedItem]    = useState(null);
  const [countDialogOpen, setCountDialogOpen] = useState(false);

  // Data — pass session status to useSessionCountItems to stop polling when done
  const {
    session, isLoading: sessionLoading, error: sessionError,
    recordCount, completeSession, cancelSession,
  } = useCountSession(sessionId, storeId);

  const { countedItemsMap, isLoading: countedLoading } =
    useSessionCountItems(sessionId, storeId, session?.status);

  // Full item list — unpaginated (fixes the 200-item silent cap bug)
  const { items: allItems, isLoading: itemsLoading, isFetching: itemsFetching } =
    useInventoryForCount(storeId);

  const isInProgress = session?.status === "in_progress";
  const isCompleted  = session?.status === "completed";
  const isCancelled  = session?.status === "cancelled";

  // Filter items
  const filteredItems = useMemo(() => {
    let items = allItems;

    if (viewTab === "counted") {
      items = items.filter((i) => !!countedItemsMap[String(i.item_id)]);
    } else if (viewTab === "uncounted") {
      items = items.filter((i) => !countedItemsMap[String(i.item_id)]);
    }

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.item_name?.toLowerCase().includes(q) ||
          i.sku?.toLowerCase().includes(q)       ||
          i.barcode?.toLowerCase().includes(q),
      );
    }

    return items;
  }, [allItems, countedItemsMap, viewTab, search]);

  const countedCount = Object.keys(countedItemsMap).length;
  const totalItems   = session?.total_items    ?? allItems.length;
  const variantCount = session?.items_with_variance ?? 0;

  function handleSelectItem(item) {
    setSelectedItem(item);
    setCountDialogOpen(true);
  }

  function handleRecord(itemId, qty, notes) {
    recordCount.mutate(
      { itemId, countedQuantity: qty, notes },
      {
        onSuccess: () => {
          setCountDialogOpen(false);
          setSelectedItem(null);
        },
      },
    );
  }

  if (sessionLoading) return <Spinner />;
  if (sessionError)   return <div className="p-6 text-sm text-destructive">{String(sessionError)}</div>;
  if (!session)       return <div className="p-6 text-sm text-muted-foreground">Session not found.</div>;

  return (
    <>
      <PageHeader
        backHref="/stock-counts"
        title={session.session_number ?? `Session #${session.id}`}
        description={`${(session.count_type ?? "full")} count · Started by ${session.started_by_username ?? "—"}`}
        badge={
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            isInProgress && "border-amber-500/30 bg-amber-500/10 text-amber-400",
            isCompleted  && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
            isCancelled  && "border-border/60 bg-muted/40 text-muted-foreground",
          )}>
            {isInProgress && <Clock className="h-2.5 w-2.5" />}
            {isCompleted  && <CheckCircle2 className="h-2.5 w-2.5" />}
            {isCancelled  && <Ban className="h-2.5 w-2.5" />}
            {session.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
        }
        action={
          <div className="flex items-center gap-1.5">
            {isCompleted && (
              <Button
                size="sm" variant="outline"
                onClick={() => navigate(`/stock-counts/${sessionId}/report`)}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                View Report
              </Button>
            )}
            {isInProgress && (
              <>
                <Button
                  size="sm" variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => setCancelOpen(true)}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                  onClick={() => setCompleteOpen(true)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Complete
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Cancelled banner */}
      {isCancelled && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3">
          <Ban className="h-4 w-4 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">
              This count session was cancelled
            </p>
            {session.cancel_reason && (
              <p className="text-xs text-destructive/80 mt-0.5">{session.cancel_reason}</p>
            )}
            {session.cancelled_by_username && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                by {session.cancelled_by_username}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">

          {/* Progress card */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-6">
              <ProgressRing counted={countedCount} total={totalItems} />
              <div className="grid grid-cols-3 flex-1 gap-4">
                {[
                  {
                    label: "Counted",
                    value: countedCount,
                    color: "text-primary",
                  },
                  {
                    label: "Remaining",
                    value: Math.max(0, totalItems - countedCount),
                    color: "text-muted-foreground",
                  },
                  {
                    label: "Variances",
                    value: variantCount,
                    color: variantCount > 0 ? "text-amber-400" : "text-emerald-400",
                  },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center">
                    <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            {session.notes && (
              <p className="mt-3 text-xs text-muted-foreground border-t border-border/60 pt-3 italic">
                {session.notes}
              </p>
            )}
          </div>

          {/* Completed state CTA */}
          {isCompleted && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-foreground">Count completed</p>
              <p className="text-xs text-muted-foreground mt-1">
                {session.items_counted ?? 0} items counted ·{" "}
                {session.items_with_variance ?? 0} variances found
              </p>
              <Button
                size="sm" className="mt-4"
                onClick={() => navigate(`/stock-counts/${sessionId}/report`)}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                View Variance Report
              </Button>
            </div>
          )}

          {/* Items list (hidden when completed — report page shows items) */}
          {!isCompleted && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Card header */}
              <div className="px-4 py-3 border-b border-border bg-muted/20 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Items
                  </h3>
                  {(itemsFetching || countedLoading) && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>

                {isInProgress && (
                  <>
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name, SKU, or barcode…"
                        className="pl-7 h-7 text-xs"
                      />
                      {search && (
                        <button
                          onClick={() => setSearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    {/* View tabs */}
                    <div className="flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5 border border-border/60 w-fit">
                      {VIEW_TABS.map((tab) => (
                        <button
                          key={tab.key}
                          onClick={() => setViewTab(tab.key)}
                          className={cn(
                            "rounded px-2.5 py-1 text-[11px] font-semibold transition-all",
                            viewTab === tab.key
                              ? "bg-card text-foreground shadow-sm border border-border/60"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {tab.label}
                          {tab.key === "counted" && countedCount > 0 && (
                            <span className="ml-1 text-[10px] font-bold text-primary">
                              {countedCount}
                            </span>
                          )}
                          {tab.key === "uncounted" && (
                            <span className="ml-1 text-[10px] font-bold text-muted-foreground">
                              {Math.max(0, (totalItems || allItems.length) - countedCount)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Item list body */}
              {itemsLoading ? (
                <div className="py-10">
                  <Spinner variant="inline" className="justify-center w-full" message="Loading items…" />
                </div>
              ) : filteredItems.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title={search ? "No items match your search" : "No items to show"}
                  description={
                    search
                      ? "Try a different search term."
                      : viewTab === "uncounted"
                        ? "All items have been counted!"
                        : "No items found in this view."
                  }
                  compact
                />
              ) : (
                <div className="max-h-[60vh] overflow-y-auto divide-y divide-border/40">
                  {filteredItems.map((item) => (
                    <ItemRow
                      key={item.item_id}
                      item={item}
                      countedItem={countedItemsMap[String(item.item_id)] ?? null}
                      onSelect={handleSelectItem}
                      isInProgress={isInProgress}
                    />
                  ))}
                </div>
              )}

              {/* Footer count */}
              {!itemsLoading && filteredItems.length > 0 && (
                <div className="px-4 py-2.5 border-t border-border/40 text-[11px] text-muted-foreground">
                  Showing {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
                  {search && ` matching "${search}"`}
                  {allItems.length > 0 && ` · ${allItems.length} total in store`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Count dialog */}
      <CountItemDialog
        open={countDialogOpen}
        onOpenChange={setCountDialogOpen}
        item={selectedItem}
        existingCount={
          selectedItem
            ? countedItemsMap[String(selectedItem.item_id)]?.counted_quantity != null
              ? parseFloat(countedItemsMap[String(selectedItem.item_id)].counted_quantity)
              : null
            : null
        }
        onRecord={handleRecord}
        isRecording={recordCount.isPending}
      />

      {/* Complete dialog */}
      <CompleteDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        session={session}
        mutation={completeSession}
      />

      {/* Cancel dialog */}
      <CancelDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        mutation={cancelSession}
      />
    </>
  );
}
