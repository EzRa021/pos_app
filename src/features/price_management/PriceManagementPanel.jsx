// ============================================================================
// features/price_management/PriceManagementPanel.jsx
// ============================================================================
// Three tabs:
//   Overview   — KPI stat cards + Price Change Requests
//   Scheduled  — Schedule a future price change, Apply Due button, history
//   Price Lists — Custom price lists per segment (wholesale, VIP, etc.)
// ============================================================================
import { useState, useMemo, useCallback } from "react";
import {
  Tag, TrendingUp, TrendingDown, Check, X, Plus,
  Edit3, Trash2, Clock, Search, AlertTriangle,
  Loader2, List, RefreshCw, Calendar, History,
  Power, PowerOff, ChevronRight, Package,
} from "lucide-react";
import { toast } from "sonner";

import {
  usePriceLists, usePriceListItems,
  usePriceChanges, useScheduledPriceChanges,
  extractError,
} from "./usePriceManagement";
import { getItems } from "@/commands/items";
import { PageHeader }      from "@/components/shared/PageHeader";
import { DataTable }       from "@/components/shared/DataTable";
import { EmptyState }      from "@/components/shared/EmptyState";
import { ConfirmDialog }   from "@/components/shared/ConfirmDialog";
import { Button }          from "@/components/ui/button";
import { Input }           from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/format";
import { usePermission } from "@/hooks/usePermission";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAIN_TABS = [
  { id: "overview",   label: "Overview"       },
  { id: "scheduled",  label: "Scheduled"      },
  { id: "lists",      label: "Price Lists"    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, action, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent = "default" }) {
  const ring = {
    default: "border-border/60   bg-card",
    primary: "border-primary/25  bg-primary/[0.06]",
    success: "border-success/25  bg-success/[0.06]",
    warning: "border-warning/25  bg-warning/[0.06]",
    muted:   "border-border/60   bg-muted/30",
  }[accent];
  const val = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    muted:   "text-muted-foreground",
  }[accent];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border px-4 py-3.5", ring)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums leading-none", val)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ── Status badges ─────────────────────────────────────────────────────────────

const CHANGE_STATUS_STYLES = {
  pending:  "bg-warning/10 text-warning border-warning/20",
  applied:  "bg-success/10 text-success border-success/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
};
function ChangeStatusBadge({ status }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
      CHANGE_STATUS_STYLES[status] ?? CHANGE_STATUS_STYLES.pending,
    )}>{status}</span>
  );
}

const LIST_TYPE_STYLES = {
  standard:    "bg-muted/50 text-muted-foreground border-border/60",
  wholesale:   "bg-primary/10 text-primary border-primary/20",
  vip:         "bg-warning/10 text-warning border-warning/20",
  promotional: "bg-success/10 text-success border-success/20",
};

// ── Status tab filter ─────────────────────────────────────────────────────────

function StatusTabs({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 border border-border/60">
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button key={String(tab.key)} onClick={() => onChange(tab.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all duration-150",
              isActive
                ? "bg-card text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground",
            )}>
            {tab.label}
            {tab.count != null && (
              <span className={cn(
                "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Item search dropdown (shared) ─────────────────────────────────────────────

function ItemSearchField({ storeId, value, onChange, onSelect, placeholder = "Search item name or SKU…" }) {
  const [results,   setResults]   = useState([]);
  const [searching, setSearching] = useState(false);

  const handleChange = useCallback(async (q) => {
    onChange(q);
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await getItems({ store_id: storeId, search: q, page: 1, limit: 10, is_active: true });
      setResults(res?.data ?? (Array.isArray(res) ? res : []));
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, [storeId, onChange]);

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input value={value} onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder} className="h-8 text-sm pl-8" />
      {searching && (
        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
      {results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-lg overflow-hidden max-h-44 overflow-y-auto">
          {results.map((item) => (
            <button key={item.id}
              onClick={() => { onSelect(item); setResults([]); }}
              className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors border-b border-border/40 last:border-0">
              <div>
                <p className="font-semibold text-foreground">{item.item_name}</p>
                <p className="text-muted-foreground">{item.sku ?? "—"}</p>
              </div>
              <span className="font-mono font-bold tabular-nums text-foreground ml-3">
                {formatCurrency(parseFloat(item.selling_price ?? 0))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Request Price Change Dialog ───────────────────────────────────────────────

const CHANGE_TYPES = [
  { value: "increase",   label: "Price Increase" },
  { value: "decrease",   label: "Price Decrease" },
  { value: "adjustment", label: "Adjustment"     },
];

function RequestPriceChangeDialog({ open, onOpenChange, storeId, onRequest }) {
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState(null);
  const [newPrice,   setNewPrice]   = useState("");
  const [changeType, setChangeType] = useState("increase");
  const [reason,     setReason]     = useState("");
  const [busy,       setBusy]       = useState(false);

  const reset = () => {
    setSearch(""); setSelected(null);
    setNewPrice(""); setChangeType("increase"); setReason("");
  };
  const handleOpenChange = (val) => { if (!val) reset(); onOpenChange(val); };

  const handleSelect = (item) => {
    setSelected(item);
    setSearch(item.item_name);
    setNewPrice(String(parseFloat(item.selling_price ?? 0)));
  };

  const currentPrice = selected ? parseFloat(selected.selling_price ?? 0) : null;
  const reqPrice     = parseFloat(newPrice) || 0;
  const diff         = currentPrice != null ? reqPrice - currentPrice : 0;
  const diffPct      = currentPrice > 0 ? ((diff / currentPrice) * 100).toFixed(1) : null;
  const canSubmit    = selected && reqPrice > 0 && reason.trim();

  const handleSave = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onRequest({
        item_id:     selected.id,
        new_price:   reqPrice,
        change_type: changeType,
        reason:      reason.trim(),
      });
      toast.success("Price change request submitted.");
      reset(); onOpenChange(false);
    } catch (err) { toast.error(extractError(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Tag className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Request Price Change</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Submitted requests require manager approval before prices update.
              </DialogDescription>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Item <span className="text-destructive">*</span>
            </label>
            <ItemSearchField storeId={storeId} value={search} onChange={setSearch} onSelect={handleSelect} />
          </div>
          {selected && (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Current Price</span>
                <span className="font-mono font-bold tabular-nums text-foreground">{formatCurrency(currentPrice)}</span>
              </div>
              {reqPrice > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Requested Price</span>
                  <span className={cn("font-mono font-bold tabular-nums",
                    diff > 0 ? "text-destructive" : diff < 0 ? "text-success" : "text-foreground")}>
                    {formatCurrency(reqPrice)}
                    {diffPct && <span className="ml-1.5 text-[10px]">({diff > 0 ? "+" : ""}{diffPct}%)</span>}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                New Price (₦) <span className="text-destructive">*</span>
              </label>
              <Input type="number" min="0" step="0.01" value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Change Type</label>
              <select value={changeType} onChange={(e) => setChangeType(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                {CHANGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Reason <span className="text-destructive">*</span>
            </label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why the price should change…" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy || !canSubmit} className="gap-1.5">
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Submitting…</> : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Schedule Price Change Dialog ──────────────────────────────────────────────

function SchedulePriceChangeDialog({ open, onOpenChange, storeId, onSchedule }) {
  const [search,    setSearch]    = useState("");
  const [selected,  setSelected]  = useState(null);
  const [newPrice,  setNewPrice]  = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [reason,    setReason]    = useState("");
  const [effectAt,  setEffectAt]  = useState("");
  const [busy,      setBusy]      = useState(false);

  const reset = () => {
    setSearch(""); setSelected(null);
    setNewPrice(""); setCostPrice(""); setReason(""); setEffectAt("");
  };
  const handleOpenChange = (val) => { if (!val) reset(); onOpenChange(val); };

  const handleSelect = (item) => {
    setSelected(item);
    setSearch(item.item_name);
    setNewPrice(String(parseFloat(item.selling_price ?? 0)));
  };

  const canSubmit = selected && parseFloat(newPrice) > 0 && effectAt;

  const handleSave = async () => {
    if (!canSubmit) return;
    if (new Date(effectAt) <= new Date()) {
      toast.error("Effective date must be in the future.");
      return;
    }
    setBusy(true);
    try {
      await onSchedule({
        item_id:           selected.id,
        new_selling_price: parseFloat(newPrice),
        new_cost_price:    costPrice ? parseFloat(costPrice) : undefined,
        change_reason:     reason.trim() || undefined,
        effective_at:      new Date(effectAt).toISOString(),
      });
      toast.success("Price change scheduled.");
      reset(); onOpenChange(false);
    } catch (err) { toast.error(extractError(err)); }
    finally { setBusy(false); }
  };

  const minDateTime = useMemo(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() + 1);
    return d.toISOString().slice(0, 16);
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-warning" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-warning/25 bg-warning/10">
              <Calendar className="h-5 w-5 text-warning" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Schedule Price Change</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Set a future date and time for the price to update automatically.
              </DialogDescription>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Item <span className="text-destructive">*</span>
            </label>
            <ItemSearchField storeId={storeId} value={search} onChange={setSearch} onSelect={handleSelect} />
          </div>
          {selected && (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Current selling price</span>
                <span className="font-mono font-bold tabular-nums text-foreground">
                  {formatCurrency(parseFloat(selected.selling_price ?? 0))}
                </span>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                New Selling Price (₦) <span className="text-destructive">*</span>
              </label>
              <Input type="number" min="0" step="0.01" value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">New Cost Price (₦)</label>
              <Input type="number" min="0" step="0.01" value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)} placeholder="Optional" className="h-8 text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Effective At <span className="text-destructive">*</span>
            </label>
            <Input type="datetime-local" value={effectAt} min={minDateTime}
              onChange={(e) => setEffectAt(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Reason</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Optional reason for this change" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy || !canSubmit}
            className="gap-1.5 bg-warning hover:bg-warning/90 text-white">
            {busy
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Scheduling…</>
              : <><Calendar className="h-3.5 w-3.5" />Schedule</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Price List Items Dialog ───────────────────────────────────────────────────

function PriceListItemsDialog({ open, onOpenChange, priceList, storeId, canManage }) {
  const { items, isLoading, addItem, removeItem } = usePriceListItems(priceList?.id);
  const [search,       setSearch]       = useState("");
  const [selected,     setSelected]     = useState(null);
  const [price,        setPrice]        = useState("");
  const [busy,         setBusy]         = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);

  // Reset add form when dialog closes
  const handleOpenChange = (val) => {
    if (!val) { setSearch(""); setSelected(null); setPrice(""); setRemoveTarget(null); }
    onOpenChange(val);
  };

  const handleAddItem = async () => {
    if (!selected || !(parseFloat(price) > 0)) {
      toast.error("Select an item and enter a valid price.");
      return;
    }
    setBusy(true);
    try {
      await addItem.mutateAsync({ item_id: selected.id, price: parseFloat(price) });
      setSearch(""); setSelected(null); setPrice("");
    } catch (err) { toast.error(extractError(err)); }
    finally { setBusy(false); }
  };

  const handleRemove = async (row) => {
    try {
      await removeItem.mutateAsync(row.item_id);
      setRemoveTarget(null);
    } catch (err) { toast.error(extractError(err)); }
  };

  const columns = useMemo(() => [
    {
      key: "item_name", header: "Item",
      render: (row) => (
        <div>
          <p className="text-xs font-semibold text-foreground">{row.item_name}</p>
          <p className="text-[11px] text-muted-foreground font-mono">{row.sku ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "price", header: "List Price", align: "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums font-bold text-primary">
          {formatCurrency(parseFloat(row.price))}
        </span>
      ),
    },
    {
      key: "effective_from", header: "From",
      render: (row) => <span className="text-xs text-muted-foreground">{row.effective_from ? formatDate(row.effective_from) : "—"}</span>,
    },
    {
      key: "effective_to", header: "To",
      render: (row) => <span className="text-xs text-muted-foreground">{row.effective_to ? formatDate(row.effective_to) : "—"}</span>,
    },
    ...(canManage ? [{
      key: "remove", header: "", align: "right",
      render: (row) => (
        <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10"
          title="Remove from list"
          onClick={(e) => { e.stopPropagation(); setRemoveTarget(row); }}>
          <Trash2 className="h-3.5 w-3.5 text-destructive/70 hover:text-destructive" />
        </Button>
      ),
    }] : []),
  ], [canManage]);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
          <div className="h-[3px] w-full shrink-0 bg-primary" />
          <div className="p-5 pb-4 flex-1 overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                <List className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">{priceList?.list_name}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5 capitalize">
                  {priceList?.list_type} price list
                  {!isLoading && (
                    <span className="ml-2 inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0 text-[10px] font-semibold tabular-nums">
                      {items.length} item{items.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </DialogDescription>
              </div>
            </div>

            {canManage && (
              <div className="flex items-end gap-2 mb-4 p-3 rounded-lg border border-border bg-muted/20">
                <div className="flex-1 space-y-1.5 min-w-0">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Add / Update Item
                  </label>
                  <ItemSearchField
                    storeId={storeId}
                    value={search}
                    onChange={setSearch}
                    onSelect={(item) => { setSelected(item); setSearch(item.item_name); }}
                    placeholder="Search to add an item…"
                  />
                </div>
                <div className="w-32 space-y-1.5 shrink-0">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">List Price (₦)</label>
                  <Input type="number" min="0" step="0.01" value={price}
                    onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className="h-8 text-sm" />
                </div>
                <Button size="sm" onClick={handleAddItem} disabled={busy || !selected || !price}
                  className="h-8 gap-1.5 shrink-0">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {selected && items.some((i) => i.item_id === selected.id) ? "Update" : "Add"}
                </Button>
              </div>
            )}

            <DataTable
              columns={columns}
              data={items}
              isLoading={isLoading}
              emptyState={
                <EmptyState icon={Package}
                  title="No items in this price list"
                  description={canManage ? "Use the form above to add items with custom prices." : "No items configured."}
                  compact
                />
              }
            />
          </div>
          <DialogFooter className="shrink-0 px-5 py-3.5 border-t border-border bg-muted/10">
            <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove item confirm */}
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(v) => { if (!v) setRemoveTarget(null); }}
        title={`Remove "${removeTarget?.item_name}"?`}
        description="This item's custom price will be removed from this price list. The item's regular selling price is not affected."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => handleRemove(removeTarget)}
      />
    </>
  );
}

// ── Create Price List Dialog ──────────────────────────────────────────────────

const LIST_TYPES = ["standard", "wholesale", "vip", "promotional"];

function CreatePriceListDialog({ open, onOpenChange, onCreate, storeId }) {
  const [form, setForm] = useState({ list_name: "", list_type: "standard", description: "" });
  const [busy, setBusy] = useState(false);
  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const handleOpenChange = (val) => {
    if (!val) setForm({ list_name: "", list_type: "standard", description: "" });
    onOpenChange(val);
  };

  const handleSave = async () => {
    if (!form.list_name.trim()) { toast.error("Price list name is required."); return; }
    if (!storeId) { toast.error("No active store selected."); return; }
    setBusy(true);
    try {
      await onCreate({
        list_name:   form.list_name.trim(),
        list_type:   form.list_type,
        description: form.description.trim() || undefined,
      });
      toast.success("Price list created.");
      handleOpenChange(false);
    } catch (err) { toast.error(extractError(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-[3px] w-full bg-primary" />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <List className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">New Price List</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Custom pricing for a customer segment
              </DialogDescription>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Name <span className="text-destructive">*</span>
            </label>
            <Input value={form.list_name} onChange={set("list_name")} placeholder="e.g. Wholesale 2026" className="h-8 text-sm" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Type</label>
            <select value={form.list_type} onChange={set("list_type")}
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              {LIST_TYPES.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Description</label>
            <Input value={form.description} onChange={set("description")} placeholder="Optional" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy} className="gap-1.5">
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating…</> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab: Overview (KPI + Price Change Requests) ───────────────────────────────

const REQUEST_STATUS_TABS = [
  { key: null,       label: "All"      },
  { key: "pending",  label: "Pending"  },
  { key: "applied",  label: "Applied"  },
  { key: "rejected", label: "Rejected" },
];

function OverviewTab({ canManage, storeId }) {
  const [statusFilter, setStatusFilter] = useState(null);
  const [page,         setPage]         = useState(1);
  const [reqOpen,      setReqOpen]      = useState(false);
  const [confirm,      setConfirm]      = useState(null); // { id, action, item_name, old_price, new_price }

  const { records, total, isLoading, request, approve, reject } =
    usePriceChanges({ status: statusFilter, page, limit: 15 });

  // Separate query to always get accurate pending count regardless of filter
  const { records: pendingRecords } = usePriceChanges({ status: "pending", page: 1, limit: 200 });
  const pendingCount = pendingRecords.length;

  const tabs = REQUEST_STATUS_TABS.map((t) => ({
    ...t,
    count: t.key === null ? total
         : t.key === "pending" ? pendingCount
         : undefined,
  }));

  const handleConfirm = async () => {
    if (!confirm) return;
    try {
      if (confirm.action === "approve") {
        await approve.mutateAsync(confirm.id);
        toast.success("Price change approved and applied.");
      } else {
        await reject.mutateAsync(confirm.id);
        toast.success("Price change rejected.");
      }
    } catch (err) { toast.error(extractError(err)); }
    finally { setConfirm(null); }
  };

  const columns = useMemo(() => [
    {
      key: "item_name", header: "Item",
      render: (row) => <p className="text-xs font-semibold text-foreground">{row.item_name}</p>,
    },
    {
      key: "old_price", header: "Old Price", align: "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums text-muted-foreground line-through">
          {formatCurrency(parseFloat(row.old_price))}
        </span>
      ),
    },
    {
      key: "new_price", header: "New Price", align: "right",
      render: (row) => {
        const diff = parseFloat(row.new_price) - parseFloat(row.old_price);
        return (
          <div className="flex items-center justify-end gap-1">
            {diff > 0 ? <TrendingUp className="h-3 w-3 text-destructive shrink-0" />
              : diff < 0 ? <TrendingDown className="h-3 w-3 text-success shrink-0" /> : null}
            <span className={cn("text-xs font-mono tabular-nums font-bold",
              diff > 0 ? "text-destructive" : diff < 0 ? "text-success" : "text-foreground")}>
              {formatCurrency(parseFloat(row.new_price))}
            </span>
          </div>
        );
      },
    },
    {
      key: "pct", header: "%", align: "right",
      render: (row) => {
        const old = parseFloat(row.old_price);
        const pct = old > 0 ? (((parseFloat(row.new_price) - old) / old) * 100).toFixed(1) : null;
        if (!pct) return <span className="text-xs text-muted-foreground">—</span>;
        const pos = parseFloat(pct) > 0;
        return (
          <span className={cn("text-[11px] font-bold tabular-nums", pos ? "text-destructive" : "text-success")}>
            {pos ? "+" : ""}{pct}%
          </span>
        );
      },
    },
    {
      key: "reason", header: "Reason",
      render: (row) => (
        <span className="text-xs text-muted-foreground truncate max-w-[180px] block">{row.reason ?? "—"}</span>
      ),
    },
    {
      key: "status", header: "Status",
      render: (row) => <ChangeStatusBadge status={row.status} />,
    },
    {
      key: "created_at", header: "Requested",
      render: (row) => <span className="text-xs text-muted-foreground">{formatDate(row.created_at)}</span>,
    },
    {
      key: "actions", header: "", align: "right",
      render: (row) => {
        if (row.status !== "pending" || !canManage) return null;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button size="xs" variant="outline"
              className="h-6 px-2 text-[10px] font-semibold border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); setConfirm({ id: row.id, action: "reject", item_name: row.item_name, old_price: row.old_price, new_price: row.new_price }); }}>
              <X className="h-3 w-3 mr-0.5" />Reject
            </Button>
            <Button size="xs"
              className="h-6 px-2 text-[10px] font-semibold bg-success hover:bg-success/90 text-white"
              onClick={(e) => { e.stopPropagation(); setConfirm({ id: row.id, action: "approve", item_name: row.item_name, old_price: row.old_price, new_price: row.new_price }); }}>
              <Check className="h-3 w-3 mr-0.5" />Approve
            </Button>
          </div>
        );
      },
    },
  ], [canManage]);

  return (
    <>
      <Section title="Price Change Requests" icon={Tag}
        action={
          <div className="flex items-center gap-2">
            <StatusTabs tabs={tabs} active={statusFilter}
              onChange={(v) => { setStatusFilter(v); setPage(1); }} />
            {canManage && (
              <Button size="sm" onClick={() => setReqOpen(true)} className="h-7 gap-1 text-xs px-2.5">
                <Plus className="h-3 w-3" />Request Change
              </Button>
            )}
          </div>
        }
      >
        {statusFilter === null && pendingCount > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.08] px-3 py-2.5 mb-4">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[11px] text-warning leading-relaxed">
              <strong>{pendingCount}</strong> pending price change{pendingCount !== 1 ? "s" : ""} awaiting
              {canManage ? " your approval." : " manager approval."}
            </p>
          </div>
        )}
        <DataTable columns={columns} data={records} isLoading={isLoading}
          pagination={{ page, pageSize: 15, total, onPageChange: setPage }}
          emptyState={
            <EmptyState icon={Tag}
              title={statusFilter ? `No ${statusFilter} price changes` : "No price change requests"}
              description={canManage
                ? "Submit a request to change an item's selling price."
                : "Price change requests will appear here."}
            />
          }
        />
      </Section>

      <RequestPriceChangeDialog
        open={reqOpen}
        onOpenChange={setReqOpen}
        storeId={storeId}
        onRequest={(p) => request.mutateAsync(p)}
      />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => { if (!v) setConfirm(null); }}
        title={confirm?.action === "approve" ? "Approve Price Change?" : "Reject Price Change?"}
        description={confirm?.action === "approve"
          ? `"${confirm?.item_name}" will be updated from ${formatCurrency(parseFloat(confirm?.old_price ?? 0))} → ${formatCurrency(parseFloat(confirm?.new_price ?? 0))}. This applies immediately to the POS.`
          : `The price change request for "${confirm?.item_name}" will be rejected. The selling price will remain unchanged.`}
        confirmLabel={confirm?.action === "approve" ? "Approve & Apply Now" : "Reject Request"}
        variant={confirm?.action === "approve" ? "default" : "destructive"}
        onConfirm={handleConfirm}
      />
    </>
  );
}

// ── Tab: Scheduled Changes ────────────────────────────────────────────────────

const SCHED_FILTER_TABS = [
  { key: "pending", label: "Pending"            },
  { key: "all",     label: "All (incl. applied)" },
];

function ScheduledTab({ canManage, storeId }) {
  const [filter,       setFilter]       = useState("pending"); // "pending" | "all"
  const [schedOpen,    setSchedOpen]    = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);

  const showAll = filter === "all";
  const { records, isLoading, schedule, cancel, applyDue } =
    useScheduledPriceChanges(showAll);

  const pendingRecords = records.filter((r) => !r.applied && !r.cancelled);
  const dueNow         = pendingRecords.filter((r) => new Date(r.effective_at) <= new Date());
  const displayRows    = showAll ? records : pendingRecords;

  const tabs = SCHED_FILTER_TABS.map((t) => ({
    ...t,
    count: t.key === "pending" ? pendingRecords.length : records.length,
  }));

  const handleApplyDue = async () => {
    try {
      const res = await applyDue.mutateAsync();
      toast.success(
        `Applied ${res?.applied ?? 0} scheduled price change${res?.applied !== 1 ? "s" : ""}.`
      );
    } catch (err) { toast.error(extractError(err)); }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancel.mutateAsync(cancelTarget.id);
      toast.success("Scheduled change cancelled.");
      setCancelTarget(null);
    } catch (err) { toast.error(extractError(err)); }
  };

  const columns = useMemo(() => [
    {
      key: "item_name", header: "Item",
      render: (row) => (
        <div>
          <p className="text-xs font-semibold text-foreground">{row.item_name}</p>
        </div>
      ),
    },
    {
      key: "new_selling_price", header: "New Selling Price", align: "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums font-bold text-primary">
          {formatCurrency(parseFloat(row.new_selling_price))}
        </span>
      ),
    },
    {
      key: "new_cost_price", header: "New Cost", align: "right",
      render: (row) => (
        <span className="text-xs font-mono tabular-nums text-muted-foreground">
          {row.new_cost_price != null ? formatCurrency(parseFloat(row.new_cost_price)) : "—"}
        </span>
      ),
    },
    {
      key: "effective_at", header: "Effective At",
      render: (row) => {
        const isPast = new Date(row.effective_at) <= new Date();
        const isDue  = isPast && !row.applied && !row.cancelled;
        return (
          <span className={cn("text-xs",
            isDue ? "text-warning font-semibold" : "text-muted-foreground")}>
            {formatDateTime(row.effective_at)}
            {isDue && (
              <span className="ml-1.5 inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0 text-[9px] font-bold text-warning">
                DUE
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "status", header: "Status",
      render: (row) => (
        <span className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
          row.applied
            ? "bg-success/10 text-success border-success/20"
            : row.cancelled
            ? "bg-muted/50 text-muted-foreground border-border/60"
            : "bg-warning/10 text-warning border-warning/20",
        )}>
          {row.applied ? "Applied" : row.cancelled ? "Cancelled" : "Pending"}
        </span>
      ),
    },
    {
      key: "applied_at", header: "Applied At",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.applied_at ? formatDateTime(row.applied_at) : "—"}
        </span>
      ),
    },
    {
      key: "change_reason", header: "Reason",
      render: (row) => (
        <span className="text-xs text-muted-foreground truncate max-w-[160px] block">
          {row.change_reason ?? "—"}
        </span>
      ),
    },
    {
      key: "actions", header: "", align: "right",
      render: (row) => {
        if (row.applied || row.cancelled || !canManage) return null;
        return (
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Cancel scheduled change"
            onClick={(e) => { e.stopPropagation(); setCancelTarget(row); }}>
            <X className="h-3.5 w-3.5 text-destructive" />
          </Button>
        );
      },
    },
  ], [canManage]);

  return (
    <>
      {/* Apply-due banner */}
      {dueNow.length > 0 && canManage && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/[0.07] px-4 py-3 mb-5">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-warning shrink-0" />
            <p className="text-[11px] text-warning leading-relaxed">
              <strong>{dueNow.length}</strong> scheduled change{dueNow.length !== 1 ? "s" : ""}{" "}
              {dueNow.length === 1 ? "is" : "are"} past their effective date and waiting to be applied.
            </p>
          </div>
          <Button size="sm" onClick={handleApplyDue} disabled={applyDue.isPending}
            className="shrink-0 gap-1.5 bg-warning hover:bg-warning/90 text-white">
            {applyDue.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Applying…</>
              : <><Check className="h-3.5 w-3.5" />Apply Now ({dueNow.length})</>}
          </Button>
        </div>
      )}

      <Section title="Scheduled Price Changes" icon={Calendar}
        action={
          <div className="flex items-center gap-2">
            <StatusTabs tabs={tabs} active={filter} onChange={setFilter} />
            {canManage && (
              <Button size="sm" onClick={() => setSchedOpen(true)} className="h-7 gap-1 text-xs px-2.5">
                <Plus className="h-3 w-3" />Schedule Change
              </Button>
            )}
          </div>
        }
      >
        <DataTable
          columns={columns}
          data={displayRows}
          isLoading={isLoading}
          emptyState={
            <EmptyState icon={Calendar}
              title={filter === "pending" ? "No pending scheduled changes" : "No scheduled changes"}
              description={canManage
                ? "Click 'Schedule Change' to set a future price update for any item."
                : "No future price changes are scheduled."}
            />
          }
        />
      </Section>

      {/* How it works explainer — only shown when there are no rows */}
      {!isLoading && displayRows.length === 0 && canManage && (
        <div className="rounded-xl border border-border bg-muted/20 px-5 py-4 mt-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">How scheduled prices work</p>
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: Calendar, label: "1. Schedule", desc: "Pick an item, set the new price, and choose a future date and time." },
              { icon: Clock,    label: "2. Wait",     desc: "The change stays pending until the effective date arrives." },
              { icon: Check,    label: "3. Apply",    desc: "Click 'Apply Now' to push all due changes, or apply them one by one." },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">{label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <SchedulePriceChangeDialog
        open={schedOpen}
        onOpenChange={setSchedOpen}
        storeId={storeId}
        onSchedule={(p) => schedule.mutateAsync(p)}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(v) => { if (!v) setCancelTarget(null); }}
        title="Cancel Scheduled Change?"
        description={`The scheduled price change for "${cancelTarget?.item_name}" will be cancelled. The price will not change.`}
        confirmLabel="Cancel Change"
        variant="destructive"
        onConfirm={handleCancel}
      />
    </>
  );
}

// ── Tab: Price Lists ──────────────────────────────────────────────────────────

function PriceListsTab({ canManage, storeId }) {
  const [createOpen,   setCreateOpen]   = useState(false);
  const [itemsTarget,  setItemsTarget]  = useState(null);
  const [toggleTarget, setToggleTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { lists, isLoading, create, update, remove } = usePriceLists();

  const handleToggle = async () => {
    try {
      await update.mutateAsync({ id: toggleTarget.id, is_active: !toggleTarget.is_active });
      toast.success(toggleTarget.is_active ? "Price list deactivated." : "Price list activated.");
      setToggleTarget(null);
    } catch (err) { toast.error(extractError(err)); }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync(deleteTarget.id);
      toast.success(`"${deleteTarget.list_name}" deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(extractError(err) || "Failed to delete. Remove all items first.");
    }
  };

  const columns = useMemo(() => [
    {
      key: "list_name", header: "Name",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold uppercase",
            row.is_active
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-muted/40 bg-muted/30 text-muted-foreground",
          )}>
            {row.list_name.slice(0, 2).toUpperCase()}
          </div>
          <span className={cn("text-xs font-semibold",
            row.is_active ? "text-foreground" : "text-muted-foreground line-through decoration-muted-foreground/40")}>
            {row.list_name}
          </span>
        </div>
      ),
    },
    {
      key: "list_type", header: "Type",
      render: (row) => (
        <span className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
          LIST_TYPE_STYLES[row.list_type] ?? LIST_TYPE_STYLES.standard,
        )}>
          {row.list_type}
        </span>
      ),
    },
    {
      key: "description", header: "Description",
      render: (row) => <span className="text-xs text-muted-foreground">{row.description ?? "—"}</span>,
    },
    {
      key: "status", header: "Status",
      render: (row) => (
        <span className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
          row.is_active
            ? "bg-success/10 text-success border-success/20"
            : "bg-muted/50 text-muted-foreground border-border/60",
        )}>
          {row.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "created_at", header: "Created",
      render: (row) => <span className="text-xs text-muted-foreground">{formatDate(row.created_at)}</span>,
    },
    {
      key: "actions", header: "", align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" title="View items"
            onClick={(e) => { e.stopPropagation(); setItemsTarget(row); }}>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          {canManage && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7"
                title={row.is_active ? "Deactivate" : "Activate"}
                onClick={(e) => { e.stopPropagation(); setToggleTarget(row); }}>
                {row.is_active
                  ? <PowerOff className="h-3.5 w-3.5 text-warning" />
                  : <Power    className="h-3.5 w-3.5 text-success" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ], [canManage]);

  const isActivating = toggleTarget && !toggleTarget.is_active;

  return (
    <>
      <Section title="Price Lists" icon={List}
        action={canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="h-7 gap-1 text-xs px-2.5">
            <Plus className="h-3 w-3" />New List
          </Button>
        )}
      >
        <DataTable
          columns={columns}
          data={lists}
          isLoading={isLoading}
          onRowClick={(row) => setItemsTarget(row)}
          emptyState={
            <EmptyState icon={List}
              title="No price lists"
              description="Create price lists for wholesale, VIP, or promotional pricing."
            />
          }
        />
        {lists.length > 0 && (
          <div className="flex flex-wrap items-center gap-5 mt-3 px-1 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5"><ChevronRight className="h-3 w-3" /><span>View items</span></div>
            <div className="flex items-center gap-1.5"><Power className="h-3 w-3 text-success" /><span>Activate</span></div>
            <div className="flex items-center gap-1.5"><PowerOff className="h-3 w-3 text-warning" /><span>Deactivate</span></div>
            <div className="flex items-center gap-1.5"><Trash2 className="h-3 w-3 text-destructive" /><span>Delete</span></div>
          </div>
        )}
      </Section>

      <CreatePriceListDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        storeId={storeId}
        onCreate={(p) => create.mutateAsync(p)}
      />

      <PriceListItemsDialog
        open={!!itemsTarget}
        onOpenChange={(v) => { if (!v) setItemsTarget(null); }}
        priceList={itemsTarget}
        storeId={storeId}
        canManage={canManage}
      />

      <Dialog open={!!toggleTarget} onOpenChange={(v) => { if (!v) setToggleTarget(null); }}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          <div className={cn("h-[3px] w-full", isActivating ? "bg-success" : "bg-warning")} />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg border",
                isActivating ? "border-success/25 bg-success/10" : "border-warning/25 bg-warning/10",
              )}>
                {isActivating
                  ? <Power    className="h-4 w-4 text-success" />
                  : <PowerOff className="h-4 w-4 text-warning" />}
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold">
                  {isActivating ? "Activate" : "Deactivate"} Price List?
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {toggleTarget?.list_name}
                </DialogDescription>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {isActivating
                ? "This price list will be available for use."
                : "This price list will be disabled and hidden from use."}
            </p>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
            <Button variant="outline" size="sm" onClick={() => setToggleTarget(null)}>Keep</Button>
            <Button size="sm" disabled={update.isPending}
              className={cn("flex-1 text-white",
                isActivating ? "bg-success hover:bg-success/90" : "bg-warning/90 hover:bg-warning")}
              onClick={handleToggle}>
              {isActivating ? "Activate" : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title={`Delete "${deleteTarget?.list_name}"?`}
        description="This will permanently remove the price list. The list must have no items before it can be deleted."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function PriceManagementPanel() {
  const canManage = usePermission("items.update");
  const [activeTab, setActiveTab] = useState("overview");

  // KPI data — always fetched regardless of active tab so stats stay fresh
  const {
    records: allChanges,
    total:   totalChanges,
    storeId,
  } = usePriceChanges({ page: 1, limit: 200 });

  const { records: scheduled } = useScheduledPriceChanges(false);
  const { lists }               = usePriceLists();

  const { pendingCount, appliedCount } = useMemo(() => ({
    pendingCount: allChanges.filter((r) => r.status === "pending").length,
    appliedCount: allChanges.filter((r) => r.status === "applied").length,
  }), [allChanges]);

  const scheduledPending = scheduled.filter((r) => !r.applied && !r.cancelled).length;
  const dueNowCount      = scheduled.filter((r) => !r.applied && !r.cancelled && new Date(r.effective_at) <= new Date()).length;

  return (
    <>
      <PageHeader
        title="Price Management"
        description="Submit and approve price change requests. Schedule future price updates. Manage custom price lists."
      />

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border px-6 bg-card/60 shrink-0">
        {MAIN_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors",
              activeTab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {/* Badge: pending requests on Overview, due count on Scheduled */}
            {t.id === "overview"  && pendingCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning/20 px-1 text-[9px] font-bold text-warning tabular-nums">
                {pendingCount}
              </span>
            )}
            {t.id === "scheduled" && dueNowCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning/20 px-1 text-[9px] font-bold text-warning tabular-nums">
                {dueNowCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-5 space-y-5">

          {/* KPI stat cards — always visible on all tabs */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Change Requests"
              value={totalChanges}
              sub={`${pendingCount} pending`}
              accent={pendingCount > 0 ? "warning" : "primary"}
            />
            <StatCard
              label="Applied"
              value={appliedCount}
              sub="prices updated"
              accent="success"
            />
            <StatCard
              label="Scheduled"
              value={scheduledPending}
              sub={dueNowCount > 0 ? `${dueNowCount} due now` : "future changes"}
              accent={dueNowCount > 0 ? "warning" : scheduledPending > 0 ? "primary" : "muted"}
            />
            <StatCard
              label="Price Lists"
              value={lists.length}
              sub={`${lists.filter((l) => l.is_active).length} active`}
              accent="default"
            />
          </div>

          {activeTab === "overview"  && <OverviewTab   canManage={canManage} storeId={storeId} />}
          {activeTab === "scheduled" && <ScheduledTab  canManage={canManage} storeId={storeId} />}
          {activeTab === "lists"     && <PriceListsTab canManage={canManage} storeId={storeId} />}
        </div>
      </div>
    </>
  );
}
