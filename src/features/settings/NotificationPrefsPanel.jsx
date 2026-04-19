// ============================================================================
// features/settings/NotificationPrefsPanel.jsx
// Per-store notification thresholds and toggles
// ============================================================================
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, Loader2, Settings2, CheckCircle2, AlertCircle,
  Package, CreditCard, Clock, DollarSign, Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import { toastSuccess, onMutationError } from "@/lib/toast";
import { getStoreSettings, updateStoreSettings } from "@/commands/store_settings";
import { useBranchStore } from "@/stores/branch.store";

function SectionCard({ title, icon: Icon, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <div className="p-5 space-y-3">{children}</div>
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
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors",
          checked ? "border-primary bg-primary" : "border-border bg-muted",
        )}
      >
        <span className={cn(
          "block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )} />
      </button>
    </div>
  );
}

function NumberField({ label, description, value, onChange, min = 0, unit }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))}
          min={min}
          className="h-8 w-20 text-sm text-right"
        />
        {unit && <span className="text-[11px] text-muted-foreground w-12">{unit}</span>}
      </div>
    </div>
  );
}

const DEFAULTS = {
  notif_low_stock_enabled:          true,
  notif_low_stock_threshold:        5,
  notif_overdue_credit_enabled:     true,
  notif_overdue_credit_days:        3,
  notif_shift_end_reminder_enabled: false,
  notif_shift_end_minutes:          30,
  notif_min_float_warning_enabled:  false,
  notif_min_float_amount:           null,
  notif_in_app_enabled:            true,
};

export function NotificationPrefsPanel() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["store-settings", storeId],
    queryFn:  () => getStoreSettings(storeId),
    enabled:  !!storeId,
  });

  useEffect(() => {
    if (data && !form) setForm({ ...DEFAULTS, ...data });
  }, [data]); // eslint-disable-line

  const save = useMutation({
    mutationFn: () => updateStoreSettings({ ...form, store_id: storeId }),
    onSuccess: (d) => {
      setForm((f) => ({ ...f, ...d }));
      qc.setQueryData(["store-settings", storeId], d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toastSuccess("Notification Preferences Saved");
    },
    onError: (e) => onMutationError("Save Failed", e),
  });

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

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

      <SectionCard title="Delivery Channel" icon={Smartphone}>
        <Toggle
          label="In-App Notifications"
          description="Show notification bell alerts inside the application."
          checked={form.notif_in_app_enabled}
          onChange={set("notif_in_app_enabled")}
        />
      </SectionCard>

      <SectionCard title="Low Stock" icon={Package}>
        <Toggle
          label="Low Stock Alerts"
          description="Trigger an alert when any item's quantity falls below its reorder point."
          checked={form.notif_low_stock_enabled}
          onChange={set("notif_low_stock_enabled")}
        />
        {form.notif_low_stock_enabled && (
          <NumberField
            label="Global Low-Stock Threshold"
            description="Items with no individual reorder point set use this store-wide default."
            value={form.notif_low_stock_threshold}
            onChange={set("notif_low_stock_threshold")}
            min={1}
            unit="units"
          />
        )}
      </SectionCard>

      <SectionCard title="Credit Sales" icon={CreditCard}>
        <Toggle
          label="Overdue Credit Alerts"
          description="Alert when a credit sale is approaching or past its due date."
          checked={form.notif_overdue_credit_enabled}
          onChange={set("notif_overdue_credit_enabled")}
        />
        {form.notif_overdue_credit_enabled && (
          <NumberField
            label="Warn Before Due Date"
            description="Trigger an early-warning alert this many days before the due date."
            value={form.notif_overdue_credit_days}
            onChange={set("notif_overdue_credit_days")}
            min={0}
            unit="days"
          />
        )}
      </SectionCard>

      <SectionCard title="Shifts" icon={Clock}>
        <Toggle
          label="Shift-End Reminder"
          description="Alert cashiers when their shift is nearing the expected end time."
          checked={form.notif_shift_end_reminder_enabled}
          onChange={set("notif_shift_end_reminder_enabled")}
        />
        {form.notif_shift_end_reminder_enabled && (
          <NumberField
            label="Remind Before Shift End"
            description="How many minutes before the expected end to trigger the reminder."
            value={form.notif_shift_end_minutes}
            onChange={set("notif_shift_end_minutes")}
            min={5}
            unit="minutes"
          />
        )}
        <Toggle
          label="Minimum Float Warning"
          description="Alert when the drawer cash balance falls below the minimum required float."
          checked={form.notif_min_float_warning_enabled}
          onChange={set("notif_min_float_warning_enabled")}
        />
        {form.notif_min_float_warning_enabled && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Minimum Float Amount (₦)</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Trigger an alert when the drawer balance drops below this amount.
              </p>
            </div>
            <Input
              type="number"
              value={form.notif_min_float_amount ?? ""}
              onChange={(e) => set("notif_min_float_amount")(e.target.value === "" ? null : parseFloat(e.target.value))}
              min={0}
              placeholder="e.g. 5000"
              className="h-8 w-28 text-sm text-right"
            />
          </div>
        )}
      </SectionCard>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3.5">
        {saved
          ? <div className="flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</div>
          : <p className="text-[11px] text-muted-foreground">Changes apply immediately after saving.</p>}
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()} className="gap-1.5 px-5">
          {save.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            : <><Settings2 className="h-3.5 w-3.5" /> Save Preferences</>}
        </Button>
      </div>
    </div>
  );
}
