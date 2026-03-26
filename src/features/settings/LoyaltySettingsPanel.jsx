// ============================================================================
// features/settings/LoyaltySettingsPanel.jsx — Loyalty points configuration
// ============================================================================
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertCircle, Settings2, Star, Gift, Clock, Coins } from "lucide-react";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { cn }       from "@/lib/utils";
import { getLoyaltySettings, updateLoyaltySettings } from "@/commands/loyalty";
import { useBranchStore } from "@/stores/branch.store";
import { formatCurrency } from "@/lib/format";

function SectionCard({ title, icon: Icon, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        className={cn("flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors duration-200",
          checked ? "border-primary bg-primary" : "border-border bg-muted")}>
        <span className={cn("block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-3.5" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

const DEFAULTS = {
  points_per_naira: 0.01,
  naira_per_point_redemption: 0.5,
  min_redemption_points: 100,
  expiry_days: 0,
  is_active: false,
};

export function LoyaltySettingsPanel() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["loyalty-settings", storeId],
    queryFn:  () => getLoyaltySettings(storeId),
    enabled:  !!storeId,
  });

  useEffect(() => {
    if (data && !form) setForm({ ...DEFAULTS, ...data });
  }, [data]); // eslint-disable-line

  const save = useMutation({
    mutationFn: () => updateLoyaltySettings({ ...form, store_id: storeId }),
    onSuccess: (d) => {
      setForm({ ...DEFAULTS, ...d });
      qc.setQueryData(["loyalty-settings", storeId], d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toastSuccess("Loyalty Settings Saved", `Programme is now ${d.is_active ? "active — customers will earn points" : "paused — no points will be earned"}.`);
    },
    onError: (e) => onMutationError("Couldn't Save Loyalty Settings", e),
  });

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  if (!storeId) return <p className="text-xs text-muted-foreground py-8 text-center">No store selected.</p>;
  if (error)    return <p className="text-xs text-destructive py-8 text-center">{String(error)}</p>;
  if (isLoading || !form) return (
    <div className="flex items-center gap-2 py-10 text-muted-foreground text-sm justify-center">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );

  // Live preview calculations
  const earn100k = Math.round((form.points_per_naira ?? 0) * 100000);
  const redeem100 = (form.naira_per_point_redemption ?? 0) * 100;

  return (
    <div className="space-y-5">

      {/* Active toggle — prominent */}
      <div className={cn(
        "rounded-xl border-2 px-5 py-4 flex items-center justify-between gap-4",
        form.is_active ? "border-success/40 bg-success/5" : "border-border bg-muted/10",
      )}>
        <div>
          <p className={cn("text-sm font-bold", form.is_active ? "text-success" : "text-foreground")}>
            Loyalty Programme — {form.is_active ? "Active" : "Inactive"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {form.is_active
              ? "Points are being earned and can be redeemed at the POS."
              : "Enable to start rewarding customers with every purchase."}
          </p>
        </div>
        <button type="button" onClick={() => set("is_active")(!form.is_active)}
          className={cn("flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors duration-200",
            form.is_active ? "border-success bg-success" : "border-border bg-muted")}>
          <span className={cn("block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
            form.is_active ? "translate-x-5" : "translate-x-0.5")} />
        </button>
      </div>

      {/* Earning rules */}
      <SectionCard title="Point Earning" icon={Star}>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Points Earned per ₦1 Spent
          </label>
          <p className="text-[11px] text-muted-foreground">e.g. 0.01 means 1 point per ₦100 spent.</p>
          <Input type="number" value={form.points_per_naira ?? ""} min="0" step="0.001"
            onChange={(e) => set("points_per_naira")(parseFloat(e.target.value) || 0)}
            className="h-8 text-sm" placeholder="0.01" />
        </div>
        {/* Live preview */}
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-[11px] text-muted-foreground">
            A customer spending <strong className="text-foreground">₦100,000</strong> earns{" "}
            <strong className="text-primary">{earn100k.toLocaleString()} points</strong>
          </p>
        </div>
      </SectionCard>

      {/* Redemption rules */}
      <SectionCard title="Point Redemption" icon={Gift}>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Naira Value per Point
          </label>
          <p className="text-[11px] text-muted-foreground">e.g. 0.5 means 100 points = ₦50 discount.</p>
          <Input type="number" value={form.naira_per_point_redemption ?? ""} min="0" step="0.01"
            onChange={(e) => set("naira_per_point_redemption")(parseFloat(e.target.value) || 0)}
            className="h-8 text-sm" placeholder="0.50" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Minimum Points to Redeem
          </label>
          <Input type="number" value={form.min_redemption_points ?? ""} min="1" step="1"
            onChange={(e) => set("min_redemption_points")(parseInt(e.target.value, 10) || 0)}
            className="h-8 text-sm" placeholder="100" />
        </div>
        {/* Live preview */}
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-[11px] text-muted-foreground">
            Redeeming <strong className="text-foreground">100 points</strong> gives a{" "}
            <strong className="text-success">{formatCurrency(redeem100)}</strong> discount
          </p>
        </div>
      </SectionCard>

      {/* Expiry */}
      <SectionCard title="Point Expiry" icon={Clock}>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Points Expire After (days)
          </label>
          <p className="text-[11px] text-muted-foreground">Set to 0 to disable expiry — points never expire.</p>
          <div className="flex items-center gap-2">
            <Input type="number" value={form.expiry_days ?? ""} min="0" step="1"
              onChange={(e) => set("expiry_days")(parseInt(e.target.value, 10) || 0)}
              className="h-8 text-sm" placeholder="0" />
            <span className="text-xs text-muted-foreground shrink-0">days</span>
          </div>
        </div>
        {form.expiry_days === 0 && (
          <div className="rounded-lg border border-success/25 bg-success/8 px-3 py-2">
            <p className="text-[11px] text-success">Points never expire (expiry disabled).</p>
          </div>
        )}
      </SectionCard>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3.5">
        {saved ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </div>
        ) : save.error ? (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" /> {String(save.error)}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Run "Expire Old Points" from the customer screen to clean up expired points.</p>
        )}
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()} className="gap-1.5 px-5">
          {save.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : <><Settings2 className="h-3.5 w-3.5" />Save</>}
        </Button>
      </div>
    </div>
  );
}
