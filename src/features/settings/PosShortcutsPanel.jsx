// ============================================================================
// features/settings/PosShortcutsPanel.jsx
// Pin up to 12 frequently-sold items as large quick-access buttons on POS
// ============================================================================
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap, Plus, X, Search, Loader2, AlertCircle,
  GripVertical, Package, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { toastSuccess, onMutationError } from "@/lib/toast";
import {
  getPosShortcuts,
  addPosShortcut,
  removePosShortcut,
  reorderPosShortcuts,
} from "@/commands/pos_shortcuts_settings";
import { searchItems } from "@/commands/items";
import { useBranchStore } from "@/stores/branch.store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const MAX_SLOTS = 12;

// ── Item search picker modal ──────────────────────────────────────────────────

function ItemPickerModal({ storeId, existingIds, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async (q) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await searchItems(q, storeId, 20);
      setResults(res.filter((r) => !existingIds.has(r.id)));
    } finally {
      setSearching(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Shortcut Item</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search items by name or SKU…"
              className="h-9 pl-8"
              autoFocus
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1 rounded-lg border border-border bg-muted/10 p-2">
            {results.length === 0 && query.length >= 2 && !searching && (
              <p className="py-6 text-center text-xs text-muted-foreground">No items found.</p>
            )}
            {results.length === 0 && query.length < 2 && (
              <p className="py-6 text-center text-xs text-muted-foreground">Type at least 2 characters to search.</p>
            )}
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { onPick(item); onClose(); }}
                className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
                  <Package className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-foreground truncate">{item.item_name}</p>
                  <p className="text-[11px] text-muted-foreground">{item.sku ?? "—"}</p>
                </div>
                <span className="text-[12px] font-semibold text-foreground shrink-0">
                  {formatCurrency(item.selling_price)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── ShortcutSlot (filled) ─────────────────────────────────────────────────────

function FilledSlot({ shortcut, position, storeId, onRemove, dragHandleProps, isDragging }) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors",
      isDragging ? "border-primary/50 opacity-50" : "border-border hover:bg-muted/20",
    )}>
      {/* Position badge */}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
        {position + 1}
      </span>

      {/* Drag handle */}
      <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground shrink-0">
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Item info */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground truncate">{shortcut.item_name}</p>
        <p className="text-[11px] text-muted-foreground">{shortcut.sku ?? "—"} · {formatCurrency(shortcut.selling_price)}</p>
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={() => onRemove(shortcut.item_id)}
        className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
        title="Remove shortcut"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── EmptySlot ─────────────────────────────────────────────────────────────────

function EmptySlot({ position, onAdd }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/5 px-3 py-2.5 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors w-full"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted/50 text-[10px] font-bold text-muted-foreground/50">
        {position + 1}
      </span>
      <Plus className="h-3.5 w-3.5 text-muted-foreground/40" />
      <span className="text-[12px] text-muted-foreground/50">Empty slot — click to add item</span>
    </button>
  );
}

// ── PosShortcutsPanel ─────────────────────────────────────────────────────────

export function PosShortcutsPanel() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);

  // Drag state
  const [localOrder, setLocalOrder] = useState(null);
  const [dragging,   setDragging]   = useState(null);
  const dragOver = useRef(null);

  const { data: shortcuts = [], isLoading, error } = useQuery({
    queryKey: ["pos-shortcuts", storeId],
    queryFn:  () => getPosShortcuts(storeId),
    enabled:  !!storeId,
    onSuccess: (d) => setLocalOrder(d),
  });

  const list = localOrder ?? shortcuts;

  // ── mutations ─────────────────────────────────────────────────────────────

  const add = useMutation({
    mutationFn: (item) => addPosShortcut(storeId, item.id, list.length),
    onSuccess: (updated) => {
      setLocalOrder(updated);
      qc.setQueryData(["pos-shortcuts", storeId], updated);
      toastSuccess("Shortcut Added");
    },
    onError: (e) => onMutationError("Add Failed", e),
  });

  const remove = useMutation({
    mutationFn: (itemId) => removePosShortcut(storeId, itemId),
    onSuccess: (updated) => {
      setLocalOrder(updated);
      qc.setQueryData(["pos-shortcuts", storeId], updated);
      toastSuccess("Shortcut Removed");
    },
    onError: (e) => onMutationError("Remove Failed", e),
  });

  const reorder = useMutation({
    mutationFn: (order) => reorderPosShortcuts(storeId, order),
    onSuccess: (updated) => {
      setLocalOrder(updated);
      qc.setQueryData(["pos-shortcuts", storeId], updated);
    },
    onError: (e) => onMutationError("Reorder Failed", e),
  });

  // ── drag handlers ─────────────────────────────────────────────────────────

  const handleDragStart = (idx) => setDragging(idx);
  const handleDragEnter = (idx) => { dragOver.current = idx; };
  const handleDragEnd   = () => {
    if (dragging === null || dragOver.current === null || dragging === dragOver.current) {
      setDragging(null); dragOver.current = null; return;
    }
    const next = [...list];
    const [moved] = next.splice(dragging, 1);
    next.splice(dragOver.current, 0, moved);
    setLocalOrder(next);
    setDragging(null);
    dragOver.current = null;
    reorder.mutate(next.map((s) => s.item_id));
  };

  // ── render ────────────────────────────────────────────────────────────────

  if (!storeId) return <p className="py-8 text-center text-xs text-muted-foreground">No store selected.</p>;
  if (isLoading) return (
    <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading shortcuts…
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-2 py-8 justify-center text-destructive text-sm">
      <AlertCircle className="h-4 w-4" /> {String(error)}
    </div>
  );

  const existingIds = new Set(list.map((s) => s.item_id));
  const emptySlots  = MAX_SLOTS - list.length;
  const canAdd      = list.length < MAX_SLOTS;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Pinned Items
            </h3>
            <span className="text-[10px] text-muted-foreground">
              — {list.length}/{MAX_SLOTS} slots used
            </span>
          </div>
          {canAdd && (
            <Button
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => setShowPicker(true)}
              disabled={add.isPending}
            >
              <Plus className="h-3.5 w-3.5" /> Pin Item
            </Button>
          )}
        </div>

        {/* Slot list */}
        <div className="p-4 space-y-2">
          {list.map((s, idx) => (
            <div
              key={s.item_id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
            >
              <FilledSlot
                shortcut={s}
                position={idx}
                storeId={storeId}
                onRemove={(itemId) => remove.mutate(itemId)}
                isDragging={dragging === idx}
                dragHandleProps={{}}
              />
            </div>
          ))}

          {/* Empty slots */}
          {Array.from({ length: emptySlots }, (_, i) => (
            <EmptySlot
              key={`empty-${i}`}
              position={list.length + i}
              onAdd={() => setShowPicker(true)}
            />
          ))}

          {list.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted/30">
                <Zap className="h-5 w-5 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">No shortcuts pinned yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Pin your best-selling items to the POS grid for one-tap checkout.
                </p>
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => setShowPicker(true)}>
                <Plus className="h-3.5 w-3.5" /> Pin First Item
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-border/60 bg-muted/10 px-5 py-4">
        <div className="flex gap-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-foreground">Tips</p>
            <ul className="text-[11px] text-muted-foreground space-y-1 list-disc list-inside leading-relaxed">
              <li>Pinned items appear as large buttons at the top of the POS item grid.</li>
              <li>Drag rows to reorder — position 1 appears top-left on the POS.</li>
              <li>Up to {MAX_SLOTS} items can be pinned per store.</li>
              <li>Removing an item from inventory automatically removes its shortcut.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Item picker modal */}
      {showPicker && (
        <ItemPickerModal
          storeId={storeId}
          existingIds={existingIds}
          onPick={(item) => add.mutate(item)}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
