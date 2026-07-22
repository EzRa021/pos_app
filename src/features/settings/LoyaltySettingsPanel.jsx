// ============================================================================
// features/settings/LoyaltySettingsPanel.jsx — Loyalty points configuration
// ============================================================================
import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, CheckCircle2, AlertCircle, Settings2,
  Star, Gift, Clock, Trash2, AlertTriangle, Info,
} from "lucide-react";
import { toast } from "sonner";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { cn }       from "@/lib/utils";
import {
  getLoyaltySettings, updateLoyaltySettings, expireOldPoints,
} from "@/commands/loyalty";
import { useBranchStore } from "@/stores/branch.store";
import { formatCurrency } from "@/lib/format";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Rust Decimal serialises as a string — normalise every numeric field to JS
// number on load so inputs don't show trailing zeros like "0.0100000000".
function normaliseSettings(raw) {
  return {
    points_per_naira:           parseFloat(raw.points_per_naira)           || 0.01,
    naira_per_point_redemption: parseFloat(raw.naira_per_point_redemption) || 0.5,
    min_redemption_points:      parseInt(raw.min_redemption_points, 10)    || 100,
    expiry_days:                parseInt(raw.expiry_days, 10)              || 0,
    is_active:                  !!raw.is_active,
  };
}

const DEFAULTS = {
  points_per_naira:           0.01,
  naira_per_point_redemption: 0.5,
  min_redemption_points:      100,
  expiry_days:                0,
  is_active:                  false,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children, accent }) {
  const borderCls = accent === "success" ? "border-success/30" : "border-border";
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", borderCls)}>
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border bg-muted/20">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        {label}
      </label>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function PreviewBox({ children }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
      <p className="text-[11px] text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function InfoCallout({ icon: Icon = Info, children, accent = "default" }) {
  const styles = {
    default: "border-border/60   bg-muted/30      text-muted-foreground",
    warning: "border-warning/25  bg-warning/[0.08] text-warning",
    success: "border-success/25  bg-success/[0.06] text-success",
    danger:  "border-destructive/25 bg-destructive/[0.06] text-destructive",
  }[accent];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5", styles)}>
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <p className="text-[11px] leading-relaxed">{children}</p>
    </div>
  );
}

// ── Validation ────────────────────────────────────────────────────────────────

function validate(form) {
  const errors = [];
  if (!form.points_per_naira || form.points_per_naira <= 0)
    errors.push("Points per ₦1 must be greater than zero.");
  if (!form.naira_per_point_redemption || form.naira_per_point_redemption <= 0)
    errors.push("Naira value per point must be greater than zero.");
  if (!form.min_redemption_points || form.min_redemption_points < 1)
    errors.push("Minimum redemption points must be at least 1.");
  if (form.expiry_days < 0)
    errors.push("Expiry days cannot be negative.");
  return errors;
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function LoyaltySettingsPanel() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const [form,    setForm]    = useState(null);
  const [dirty,   setDirty]   = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [errors,  setErrors]  = useState([]);
  const [expiring, setExpiring] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["loyalty-settings", storeId],
    queryFn:  () => getLoyaltySettings(storeId),
    enabled:  !!storeId,
    staleTime: 5 * 60_000,
  });

  // Reset form whenever the fetched data changes — this handles both initial
  // load AND store switches (fixes the storeId-change bug where the old form
  // stays because `!form` is false after first load).
  useEffect(() => {
    if (data) {
      setForm(normaliseSettings(data));
      setDirty(false);
      setErrors([]);
    }
  }, [data]);

  const set = useCallback((key) => (val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setDirty(true);
    setSaved(false);
  }, []);

  // ── Save all settings ──────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: () => {
      const errs = validate(form);
      if (errs.length) {
        setErrors(errs);
        return Promise.reject(errs[0]);
      }
      setErrors([]);
      return updateLoyaltySettings({ ...form, store_id: storeId });
    },
    onSuccess: (d) => {
      const normalised = normaliseSettings(d);
      setForm(normalised);
      qc.setQueryData(["loyalty-settings", storeId], d);
      // Also invalidate the POS and customer balance caches so they pick up
      // the new naira_per_point_redemption value immediately.
      qc.invalidateQueries({ queryKey: ["loyalty-balance"] });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toastSuccess(
        "Loyalty Settings Saved",
        `Programme is ${d.is_active ? "active — customers will earn points" : "paused — no points will be earned"}.`,
      );
    },
    onError: (e) => {
      if (typeof e !== "string" || !e.includes("must be")) {
        onMutationError("Couldn't Save Loyalty Settings", e);
      }
    },
  });

  // ── Toggle active — only flips is_active, never saves unsaved draft values ──
  const toggleActive = useMutation({
    mutationFn: (val) => updateLoyaltySettings({ store_id: storeId, is_active: val }),
    onSuccess: (d) => {
      // Merge the returned value into current form without discarding edits
      setForm((f) => ({ ...(f ?? DEFAULTS), is_active: d.is_active }));
      qc.setQueryData(["loyalty-settings", storeId], (prev) =>
        prev ? { ...prev, is_active: d.is_active } : d,
      );
      toastSuccess(
        d.is_active ? "Loyalty Programme Enabled" : "Loyalty Programme Disabled",
        d.is_active
          ? "Customers will now earn points on every purchase."
          : "No points will be earned until you re-enable this.",
      );
    },
    onError: (e) => onMutationError("Couldn't Update Loyalty Programme", e),
  });

  // ── Expire old points ──────────────────────────────────────────────────────
  const handleExpirePoints = async () => {
    setExpiring(true);
    try {
      const res = await expireOldPoints(storeId);
      if (res?.expired > 0) {
        toastSuccess(
          "Points Expired",
          `Expired points for ${res.expired} customer${res.expired !== 1 ? "s" : ""} with activity older than ${res.expiry_days} days.`,
        );
      } else {
        toast.info(res?.message ?? "No points were eligible for expiry.");
      }
      qc.invalidateQueries({ queryKey: ["loyalty-balance"] });
      qc.invalidateQueries({ queryKey: ["loyalty-history"] });
    } catch (e) {
      toast.error(typeof e === "string" ? e : (e?.message ?? "Failed to expire points."));
    } finally {
      setExpiring(false);
    }
  };

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!storeId) return (
    <p className="text-xs text-muted-foreground py-8 text-center">No store selected.</p>
  );
  if (error) return (
    <p className="text-xs text-destructive py-8 text-center">{String(error)}</p>
  );
  if (isLoading || !form) return (
    <div className="flex items-center gap-2 py-10 text-muted-foreground text-sm justify-center">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading loyalty settings…
    </div>
  );

  // ── Live preview values ────────────────────────────────────────────────────
  const ppr       = parseFloat(form.points_per_naira)           || 0;
  const npp       = parseFloat(form.naira_per_point_redemption) || 0;
  const minPts    = parseInt(form.min_redemption_points, 10)    || 1;
  const expDays   = parseInt(form.expiry_days, 10)              || 0;

  // How many points does ₦100,000 earn?
  const earn100k  = Math.round(ppr * 100_000);
  // What is the naira value of the minimum redemption?
  const minRedeemValue = npp * minPts;
  // How long until a customer earning 1pt/day hits min redemption?
  const daysToMin = ppr > 0 ? Math.ceil(minPts / (ppr * 1000)) : null;

  return (
    <div className="space-y-3">

      {/* ── Programme toggle ──────────────────────────────────────────── */}
      <div className={cn(
        "rounded-xl border-2 px-5 py-4 flex items-center justify-between gap-4 transition-colors",
        form.is_active
          ? "border-success/40 bg-success/[0.04]"
          : "border-border bg-muted/10",
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
        <button
          type="button"
          onClick={() => toggleActive.mutate(!form.is_active)}
          disabled={toggleActive.isPending}
          title={form.is_active ? "Disable loyalty programme" : "Enable loyalty programme"}
          className={cn(
            "flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors duration-200",
            form.is_active ? "border-success bg-success" : "border-border bg-muted",
            toggleActive.isPending && "opacity-60 cursor-not-allowed",
          )}
        >
          <span className={cn(
            "block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
            form.is_active ? "translate-x-5" : "translate-x-0.5",
          )} />
        </button>
      </div>

      {/* Unsaved changes banner */}
      {dirty && (
        <InfoCallout icon={AlertTriangle} accent="warning">
          You have unsaved changes. Click <strong>Save Settings</strong> below to apply them.
          Toggling the programme on/off above saves immediately and does not affect your unsaved edits.
        </InfoCallout>
      )}

      {/* Validation errors */}
      {errors.length > 0 && (
        <InfoCallout icon={AlertCircle} accent="danger">
          {errors.map((e, i) => <span key={i} className="block">{e}</span>)}
        </InfoCallout>
      )}

      {/* ── Point Earning ─────────────────────────────────────────────── */}
      <SectionCard title="Point Earning" icon={Star}>
        <FieldRow
          label="Points Earned per ₦1 Spent"
          hint="How many points a customer earns for every ₦1 they spend. e.g. 0.01 = 1 pt per ₦100."
        >
          <Input
            type="number"
            value={form.points_per_naira}
            min="0.001" step="0.001"
            onChange={(e) => set("points_per_naira")(parseFloat(e.target.value) || 0)}
            className="h-8 text-sm"
            placeholder="0.01"
          />
        </FieldRow>

        <PreviewBox>
          A customer spending{" "}
          <strong className="text-foreground">₦100,000</strong> earns{" "}
          <strong className="text-primary">{earn100k.toLocaleString()} points</strong>
          {earn100k > 0 && minPts > 0 && earn100k >= minPts
            ? <>, which exceeds the minimum redemption of {minPts.toLocaleString()} pts.</>
            : earn100k > 0 && minPts > 0
            ? <>. They'd need to spend roughly ₦{Math.ceil(minPts / ppr).toLocaleString()} to reach the minimum.</>
            : null}
        </PreviewBox>
      </SectionCard>

      {/* ── Point Redemption ──────────────────────────────────────────── */}
      <SectionCard title="Point Redemption" icon={Gift}>
        <FieldRow
          label="Naira Value per Point (₦)"
          hint="How much ₦1 each redeemed point is worth. e.g. 0.5 = 100 pts gives ₦50 off."
        >
          <Input
            type="number"
            value={form.naira_per_point_redemption}
            min="0.01" step="0.01"
            onChange={(e) => set("naira_per_point_redemption")(parseFloat(e.target.value) || 0)}
            className="h-8 text-sm"
            placeholder="0.50"
          />
        </FieldRow>

        <FieldRow
          label="Minimum Points to Redeem"
          hint="Customer must have at least this many points before the Loyalty button appears at POS."
        >
          <Input
            type="number"
            value={form.min_redemption_points}
            min="1" step="1"
            onChange={(e) => set("min_redemption_points")(parseInt(e.target.value, 10) || 1)}
            className="h-8 text-sm"
            placeholder="100"
          />
        </FieldRow>

        {/* Live preview — uses min_redemption_points, not hardcoded 100 */}
        <PreviewBox>
          Redeeming the minimum of{" "}
          <strong className="text-foreground">{minPts.toLocaleString()} points</strong> gives a{" "}
          <strong className="text-success">{formatCurrency(minRedeemValue)}</strong> discount.
          {daysToMin && (
            <> A customer spending ₦1,000/day earns the minimum in roughly{" "}
            <strong className="text-foreground">{daysToMin} days</strong>.</>
          )}
        </PreviewBox>
      </SectionCard>

      {/* ── Point Expiry ──────────────────────────────────────────────── */}
      <SectionCard title="Point Expiry" icon={Clock}>
        <FieldRow
          label="Points Expire After (days)"
          hint="Set to 0 to disable expiry — points never expire. e.g. 365 = points older than 1 year expire."
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={form.expiry_days}
              min="0" step="1"
              onChange={(e) => set("expiry_days")(parseInt(e.target.value, 10) || 0)}
              className="h-8 text-sm"
              placeholder="0"
            />
            <span className="text-xs text-muted-foreground shrink-0">days</span>
          </div>
        </FieldRow>

        {!expDays ? (
          <InfoCallout icon={Info} accent="success">
            Expiry is <strong>disabled</strong> — customer points never expire.
          </InfoCallout>
        ) : (
          <InfoCallout icon={AlertTriangle} accent="warning">
            Points older than <strong>{expDays} days</strong> will be expired when you run
            "Expire Old Points" below. This action is irreversible.
          </InfoCallout>
        )}

        {/* Run Expire Old Points — only shown when expiry is enabled */}
        {expDays > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Run Expiry Now</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Removes points earned more than {expDays} days ago from all customer balances.
                Run this periodically (e.g. monthly) or automate it via a scheduled task.
              </p>
            </div>
            <Button
              size="sm" variant="outline"
              onClick={handleExpirePoints}
              disabled={expiring || save.isPending}
              className="shrink-0 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive"
            >
              {expiring
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Expiring…</>
                : <><Trash2 className="h-3.5 w-3.5" />Expire Old Points</>}
            </Button>
          </div>
        )}
      </SectionCard>

      {/* ── How the programme works — reference card ──────────────────── */}
      <div className="rounded-xl border border-border bg-muted/10 px-5 py-4 space-y-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">How points flow</p>
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              icon: Star,
              label: "Earn",
              desc: "Points are automatically added after every completed sale at the POS when a customer is attached.",
            },
            {
              icon: Gift,
              label: "Redeem",
              desc: "Cashier taps the Loyalty button at checkout. Points are deducted and the naira value is subtracted from the total.",
            },
            {
              icon: Clock,
              label: "Expire",
              desc: "If expiry is enabled, run the expiry job periodically. Points earned before the cutoff date are removed.",
            },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
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

      {/* ── Save bar ──────────────────────────────────────────────────── */}
      <div className={cn(
        "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors",
        dirty ? "border-warning/30 bg-warning/[0.04]" : "border-border bg-card",
      )}>
        <div className="flex items-center gap-2 min-w-0">
          {saved ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Settings saved
            </div>
          ) : save.isError && errors.length === 0 ? (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{String(save.error)}</span>
            </div>
          ) : dirty ? (
            <p className="text-[11px] text-warning font-medium">Unsaved changes</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Settings apply to all new transactions in this store immediately after saving.
            </p>
          )}
        </div>
        <Button
          size="sm"
          disabled={save.isPending || !dirty}
          onClick={() => save.mutate()}
          className={cn("gap-1.5 px-5 shrink-0", dirty && "shadow-sm shadow-primary/20")}
        >
          {save.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
            : <><Settings2 className="h-3.5 w-3.5" />Save Settings</>}
        </Button>
      </div>

    </div>
  );
}
