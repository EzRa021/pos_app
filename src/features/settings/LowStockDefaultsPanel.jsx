// ============================================================================
// features/settings/LowStockDefaultsPanel.jsx
// Store-level default reorder point and reorder quantity for new items
// ============================================================================
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, Loader2, Settings2, CheckCircle2, AlertCircle, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { getStoreSettings, updateStoreSettings } from "@/commands/store_settings";
import { useBranchStore } from "@/stores/branch.store";

export function LowStockDefaultsPanel() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();
  const [form, setForm]   = useState(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["store-settings", storeId],
    queryFn:  () => getStoreSettings(storeId),
    enabled:  !!storeId,
  });

  useEffect(() => {
    if (data && !form) {
      setForm({
        default_reorder_point: data.default_reorder_point ?? 10,
        default_reorder_qty:   data.default_reorder_qty   ?? 20,
      });
    }
  }, [data]); // eslint-disable-line

  const save = useMutation({
    mutationFn: () => updateStoreSettings({
      store_id:              storeId,
      default_reorder_point: form.default_reorder_point,
      default_reorder_qty:   form.default_reorder_qty,
    }),
    onSuccess: (d) => {
      qc.setQueryData(["store-settings", storeId], d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toastSuccess("Low Stock Defaults Saved");
    },
    onError: (e) => onMutationError("Save Failed", e),
  });

  if (!storeId) return <p className="py-8 text-center text-xs text-muted-foreground">No store selected.</p>;
  if (isLoading || !form) return (
    <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-2 py-8 justify-center text-destructive text-sm">
      <AlertCircle className="h-4 w-4" /> {String(error)}
    </div>
  );

  return (
    <div className="space-y-5">

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Default Reorder Settings
          </h3>
        </div>

        <div className="p-5 space-y-5">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Default Reorder Point (units)
            </label>
            <p className="text-[11px] text-muted-foreground">
              Applied to new items that don't have an individual reorder point set.
              When stock falls to or below this number, a low-stock alert is triggered.
            </p>
            <Input
              type="number"
              value={form.default_reorder_point}
              onChange={(e) => setForm((f) => ({ ...f, default_reorder_point: parseInt(e.target.value, 10) || 0 }))}
              min={0}
              className="h-9 max-w-[160px]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Default Reorder Quantity (units)
            </label>
            <p className="text-[11px] text-muted-foreground">
              Suggested quantity to reorder when generating a Purchase Order for a low-stock item.
              Applied to new items that don't have an individual reorder quantity set.
            </p>
            <Input
              type="number"
              value={form.default_reorder_qty}
              onChange={(e) => setForm((f) => ({ ...f, default_reorder_qty: parseInt(e.target.value, 10) || 0 }))}
              min={1}
              className="h-9 max-w-[160px]"
            />
          </div>
        </div>
      </div>

      {/* Callout */}
      <div className="rounded-xl border border-border/60 bg-muted/10 px-5 py-4">
        <div className="flex gap-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            These are <strong>store-level defaults</strong> for new items. Existing items keep
            their individually configured reorder points. You can always override these values
            per-item from the item detail screen.
          </p>
        </div>
      </div>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3.5">
        {saved
          ? <div className="flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</div>
          : <p className="text-[11px] text-muted-foreground">Defaults apply to new items created after saving.</p>}
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()} className="gap-1.5 px-5">
          {save.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            : <><Settings2 className="h-3.5 w-3.5" /> Save Defaults</>}
        </Button>
      </div>
    </div>
  );
}
