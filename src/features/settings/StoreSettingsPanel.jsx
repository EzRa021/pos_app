// ============================================================================
// features/settings/StoreSettingsPanel.jsx — Business Rules configuration
// ============================================================================
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, CheckCircle2, AlertCircle, Settings2,
  DollarSign, ShieldCheck, Receipt, Package, CreditCard, Timer,
} from "lucide-react";
import { toast } from "sonner";
import { Button }        from "@/components/ui/button";
import { Input }         from "@/components/ui/input";
import { cn }            from "@/lib/utils";
import { getStoreSettings, updateStoreSettings } from "@/commands/store_settings";
import { useBranchStore } from "@/stores/branch.store";

// ── Reusable sub-components ───────────────────────────────────────────────────

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
          "flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors duration-200",
          checked ? "border-primary bg-primary" : "border-border bg-muted",
        )}
      >
        <span className={cn(
          "block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )} />
      </button>
    </div>
  );
}

function NumberField({ label, description, value, onChange, placeholder, min, step = "1", unit }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
      {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
          placeholder={placeholder}
          min={min}
          step={step}
          className="h-8 text-sm"
        />
        {unit && <span className="text-xs text-muted-foreground shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

function TextField({ label, description, value, onChange, placeholder }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
      {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder={placeholder}
        rows={2}
        className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}

// ── StoreSettingsPanel ────────────────────────────────────────────────────────

const DEFAULTS = {
  allow_price_override: true,
  max_discount_percent: null,
  require_discount_reason: false,
  warn_sell_below_cost: true,
  allow_sell_below_cost: false,
  require_customer_above_amount: null,
  void_same_day_only: true,
  max_void_amount: null,
  require_manager_approval_void_above: null,
  receipt_header_text: null,
  receipt_footer_text: null,
  show_vat_on_receipt: true,
  show_cashier_on_receipt: true,
  receipt_copies: 1,
  auto_create_po_on_reorder: false,
  opening_float_required: false,
  min_opening_float: null,
  max_credit_days: 30,
  auto_flag_overdue_after_days: 7,
};

export function StoreSettingsPanel() {
  const storeId   = useBranchStore((s) => s.activeStore?.id);
  const qc        = useQueryClient();
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
      setForm({ ...DEFAULTS, ...d });
      qc.setQueryData(["store-settings", storeId], d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast.success("Business rules saved.");
    },
    onError: (e) => toast.error(String(e)),
  });

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  if (!storeId) return <p className="text-xs text-muted-foreground py-8 text-center">No store selected.</p>;
  if (error) return <p className="text-xs text-destructive py-8 text-center">{String(error)}</p>;
  if (isLoading || !form) return (
    <div className="flex items-center gap-2 py-10 text-muted-foreground text-sm justify-center">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );

  return (
    <div className="space-y-5">

      {/* Pricing Rules */}
      <SectionCard title="Pricing Rules" icon={DollarSign}>
        <Toggle label="Allow Price Override at POS" description="Cashiers can change the selling price during a sale." checked={form.allow_price_override} onChange={set("allow_price_override")} />
        <Toggle label="Warn When Selling Below Cost" description="Show a warning if selling price is below cost price." checked={form.warn_sell_below_cost} onChange={set("warn_sell_below_cost")} />
        <Toggle label="Allow Selling Below Cost" description="If disabled, below-cost sales are blocked entirely." checked={form.allow_sell_below_cost} onChange={set("allow_sell_below_cost")} />
        <Toggle label="Require Reason for Discounts" description="Cashier must enter a reason before applying any discount." checked={form.require_discount_reason} onChange={set("require_discount_reason")} />
        <NumberField label="Max Discount %" description="Maximum discount a cashier can apply (leave blank for no limit)." value={form.max_discount_percent} onChange={set("max_discount_percent")} placeholder="e.g. 20" min="0" step="1" unit="%" />
      </SectionCard>

      {/* Transaction Rules */}
      <SectionCard title="Transaction Rules" icon={ShieldCheck}>
        <Toggle label="Voids Same Day Only" description="Transactions can only be voided on the same day they were made." checked={form.void_same_day_only} onChange={set("void_same_day_only")} />
        <NumberField label="Max Void Amount (₦)" description="Voids above this amount are automatically blocked." value={form.max_void_amount} onChange={set("max_void_amount")} placeholder="e.g. 50000" min="0" step="100" />
        <NumberField label="Require Manager Approval for Voids Above (₦)" description="Voids above this value require a manager to approve." value={form.require_manager_approval_void_above} onChange={set("require_manager_approval_void_above")} placeholder="e.g. 10000" min="0" step="100" />
        <NumberField label="Require Customer Above (₦)" description="Customer must be attached to any sale above this amount." value={form.require_customer_above_amount} onChange={set("require_customer_above_amount")} placeholder="e.g. 50000" min="0" step="100" />
      </SectionCard>

      {/* Receipt Rules */}
      <SectionCard title="Receipt Settings" icon={Receipt}>
        <Toggle label="Show VAT on Receipt" checked={form.show_vat_on_receipt} onChange={set("show_vat_on_receipt")} />
        <Toggle label="Show Cashier Name on Receipt" checked={form.show_cashier_on_receipt} onChange={set("show_cashier_on_receipt")} />
        <NumberField label="Receipt Copies" value={form.receipt_copies} onChange={set("receipt_copies")} placeholder="1" min="1" step="1" unit="copies" />
        <TextField label="Receipt Header Text" value={form.receipt_header_text} onChange={set("receipt_header_text")} placeholder="Welcome message or promotional text…" />
        <TextField label="Receipt Footer Text" value={form.receipt_footer_text} onChange={set("receipt_footer_text")} placeholder="Thank you for shopping with us!" />
      </SectionCard>

      {/* Stock Rules */}
      <SectionCard title="Stock Rules" icon={Package}>
        <Toggle label="Auto-Create PO on Reorder" description="Automatically create a draft Purchase Order when an item hits its reorder point." checked={form.auto_create_po_on_reorder} onChange={set("auto_create_po_on_reorder")} />
      </SectionCard>

      {/* Shift / Cash Rules */}
      <SectionCard title="Shift & Cash Rules" icon={Timer}>
        <Toggle label="Opening Float Required" description="Cashier must enter an opening float amount before starting a shift." checked={form.opening_float_required} onChange={set("opening_float_required")} />
        <NumberField label="Minimum Opening Float (₦)" description="Minimum cash amount required to open a shift." value={form.min_opening_float} onChange={set("min_opening_float")} placeholder="e.g. 5000" min="0" step="100" />
      </SectionCard>

      {/* Credit Rules */}
      <SectionCard title="Credit Rules" icon={CreditCard}>
        <NumberField label="Max Credit Days" description="Default maximum number of days before a credit sale is overdue." value={form.max_credit_days} onChange={set("max_credit_days")} placeholder="30" min="1" step="1" unit="days" />
        <NumberField label="Auto-Flag Overdue After (days)" description="Automatically mark credit sales as overdue after this many days past due date." value={form.auto_flag_overdue_after_days} onChange={set("auto_flag_overdue_after_days")} placeholder="7" min="1" step="1" unit="days" />
      </SectionCard>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3.5">
        {saved ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Settings saved
          </div>
        ) : save.error ? (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" /> {String(save.error)}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Changes apply to new transactions immediately after saving.</p>
        )}
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()} className="gap-1.5 px-5">
          {save.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            : <><Settings2 className="h-3.5 w-3.5" /> Save Rules</>}
        </Button>
      </div>
    </div>
  );
}
