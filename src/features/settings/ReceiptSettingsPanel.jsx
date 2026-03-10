// ============================================================================
// features/settings/ReceiptSettingsPanel.jsx
// ============================================================================
// Full receipt settings form with live preview.
// Two-column layout on desktop: settings form (left) + receipt preview (right).
// Tabs: Branding | Paper & Layout | Content & Options
// ============================================================================

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Store, Smartphone, Mail, MapPin, Type, Image as ImageIcon,
  Printer, AlignLeft, Eye, EyeOff, CheckCircle2, AlertCircle,
  Loader2, Upload, X, FileText, Settings2, ToggleLeft, ToggleRight,
  Hash, Layers, QrCode,
} from "lucide-react";

import { Button }    from "@/components/ui/button";
import { Input }     from "@/components/ui/input";
import { cn }        from "@/lib/utils";
import { ReceiptPreview } from "./ReceiptPreview";
import { getReceiptSettings, updateReceiptSettings } from "@/commands/receipts";
import { useBranchStore } from "@/stores/branch.store";

// ── Sub-tab list ──────────────────────────────────────────────────────────────
const TABS = [
  { id: "branding", label: "Branding",        icon: Store },
  { id: "layout",   label: "Paper & Layout",  icon: Printer },
  { id: "content",  label: "Content Options", icon: Layers },
];

// ── Reusable field components ─────────────────────────────────────────────────

function FieldGroup({ label, hint, icon: Icon, children }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  );
}

function TextInput({ label, hint, icon, value, onChange, placeholder, type = "text" }) {
  return (
    <FieldGroup label={label} hint={hint} icon={icon}>
      <Input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
    </FieldGroup>
  );
}

function TextAreaInput({ label, hint, icon, value, onChange, placeholder, rows = 2 }) {
  return (
    <FieldGroup label={label} hint={hint} icon={icon}>
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(
          "w-full rounded-md border border-input bg-transparent px-3 py-1.5",
          "text-xs shadow-sm resize-none transition-colors",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      />
    </FieldGroup>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3.5 py-3 hover:bg-muted/40 transition-colors">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        {description && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors duration-200",
          checked
            ? "border-primary bg-primary"
            : "border-border bg-muted",
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

function PaperWidthPicker({ value, onChange }) {
  const options = [
    { mm: 58,  label: "58 mm",  desc: "Small / narrow" },
    { mm: 80,  label: "80 mm",  desc: "Standard POS"   },
    { mm: 110, label: "110 mm", desc: "Wide format"    },
  ];
  return (
    <FieldGroup label="Paper Width" icon={Printer}>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.mm}
            type="button"
            onClick={() => onChange(o.mm)}
            className={cn(
              "rounded-lg border py-2.5 text-center transition-colors",
              value === o.mm
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/20 text-foreground hover:bg-muted/50",
            )}
          >
            <div className="text-sm font-bold">{o.label}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{o.desc}</div>
          </button>
        ))}
      </div>
    </FieldGroup>
  );
}

function FontSizePicker({ value, onChange }) {
  const sizes = [10, 11, 12, 13, 14];
  return (
    <FieldGroup label="Font Size" icon={Type} hint="Controls text size across the entire receipt.">
      <div className="flex gap-2">
        {sizes.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={cn(
              "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors",
              value === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/20 text-foreground hover:bg-muted/50",
            )}
          >
            {s}px
          </button>
        ))}
      </div>
    </FieldGroup>
  );
}

function CopiesPicker({ value, onChange }) {
  return (
    <FieldGroup label="Receipt Copies" icon={Layers} hint="How many copies to print per transaction.">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, value - 1))}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 text-sm font-bold hover:bg-muted/60 transition-colors"
        >−</button>
        <span className="text-sm font-bold text-foreground w-6 text-center">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(5, value + 1))}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 text-sm font-bold hover:bg-muted/60 transition-colors"
        >+</button>
        <span className="text-xs text-muted-foreground">
          {value === 1 ? "single copy" : `${value} copies`}
        </span>
      </div>
    </FieldGroup>
  );
}

// ── Logo uploader ─────────────────────────────────────────────────────────────
function LogoUploader({ value, onChange }) {
  const inputRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (file.size > 500 * 1024) {
      alert("Logo must be under 500 KB. Please compress or resize it.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => onChange(e.target.result);
    reader.readAsDataURL(file);
  }, [onChange]);

  const handleDrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  };

  return (
    <FieldGroup
      label="Store Logo"
      icon={ImageIcon}
      hint="PNG or JPG, max 500 KB. Displayed at the top of the receipt when enabled."
    >
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <img src={value} alt="logo preview"
            className="h-12 w-12 rounded-md object-contain border border-border bg-white p-1" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground">Logo uploaded</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Click × to remove</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed",
            "border-border bg-muted/10 p-5 cursor-pointer",
            "hover:border-primary/40 hover:bg-muted/30 transition-colors",
          )}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/50">
            <Upload className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-xs font-semibold text-foreground">Click or drag to upload</p>
          <p className="text-[11px] text-muted-foreground">PNG, JPG — max 500 KB</p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files[0])}
      />
    </FieldGroup>
  );
}

// ── Default settings ──────────────────────────────────────────────────────────
const DEFAULTS = {
  show_logo:          false,
  logo_url:           null,
  logo_base64:        null,
  business_name:      "",
  business_address:   "",
  business_phone:     "",
  business_email:     "",
  tagline:            "",
  header_text:        "",
  footer_text:        "Thank you for your purchase!",
  show_cashier_name:  true,
  show_customer_name: true,
  show_item_sku:      false,
  show_tax_breakdown: true,
  show_qr_code:       true,
  auto_print:         false,
  paper_width_mm:     80,
  font_size:          12,
  receipt_copies:     1,
  currency_symbol:    "₦",
};

// ── ReceiptSettingsPanel ──────────────────────────────────────────────────────
export function ReceiptSettingsPanel() {
  const activeStore   = useBranchStore((s) => s.activeStore);
  const storeId       = activeStore?.id;
  const queryClient   = useQueryClient();

  const [activeTab, setActiveTab] = useState("branding");
  const [form,      setForm]      = useState(null);   // null = not loaded yet
  const [saved,     setSaved]     = useState(false);

  // ── Load settings ─────────────────────────────────────────────────────────
  // NOTE: onSuccess was removed in TanStack Query v5 — use useEffect instead.
  const { data: settingsData, isLoading, error } = useQuery({
    queryKey: ["receipt-settings", storeId],
    queryFn:  () => getReceiptSettings(storeId),
    enabled:  !!storeId,
  });

  useEffect(() => {
    if (settingsData && !form) {
      setForm({ ...DEFAULTS, ...settingsData });
    }
  }, [settingsData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save mutation ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => updateReceiptSettings({ ...form, store_id: storeId }),
    onSuccess:  (data) => {         // onSuccess IS still supported on useMutation in v5
      setForm({ ...DEFAULTS, ...data });
      queryClient.setQueryData(["receipt-settings", storeId], data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  // ── Field helper ──────────────────────────────────────────────────────────
  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  // ── Loading / error states ────────────────────────────────────────────────
  if (!storeId) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No store selected.
      </div>
    );
  }

  // error must be checked BEFORE !form — a failed query leaves form=null
  // and isLoading=false, so checking !form first would show spinner forever.
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <AlertCircle className="h-7 w-7 text-destructive" />
        <p className="text-sm font-semibold text-destructive">Failed to load receipt settings</p>
        <p className="text-xs text-muted-foreground max-w-xs text-center">
          {String(error)}
        </p>
      </div>
    );
  }

  if (isLoading || !form) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  // ── Tab content ───────────────────────────────────────────────────────────
  const TabBranding = (
    <div className="space-y-4">
      <LogoUploader value={form.logo_base64} onChange={set("logo_base64")} />

      <Toggle
        label="Show Logo on Receipt"
        description="Display your store logo at the top of every receipt."
        checked={form.show_logo}
        onChange={set("show_logo")}
      />

      <div className="grid grid-cols-1 gap-4 pt-1">
        <TextInput
          label="Business Name"
          icon={Store}
          value={form.business_name}
          onChange={set("business_name")}
          placeholder={activeStore?.store_name || "Your Store Name"}
          hint="Overrides the store name on receipts."
        />
        <TextAreaInput
          label="Address"
          icon={MapPin}
          value={form.business_address}
          onChange={set("business_address")}
          placeholder="123 Main Street, Lagos, Nigeria"
        />
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Phone"
            icon={Smartphone}
            value={form.business_phone}
            onChange={set("business_phone")}
            placeholder="+234 800 000 0000"
          />
          <TextInput
            label="Email"
            icon={Mail}
            value={form.business_email}
            onChange={set("business_email")}
            placeholder="store@example.com"
          />
        </div>
        <TextInput
          label="Tagline / Slogan"
          icon={Type}
          value={form.tagline}
          onChange={set("tagline")}
          placeholder="Fresh quality every day"
          hint="Short slogan shown beneath the store name."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 pt-1">
        <TextAreaInput
          label="Header Message"
          icon={AlignLeft}
          value={form.header_text}
          onChange={set("header_text")}
          placeholder="Welcome to our store — enjoy special offers!"
          hint="Shown between the store info and the transaction details."
        />
        <TextAreaInput
          label="Footer Message"
          icon={FileText}
          value={form.footer_text}
          onChange={set("footer_text")}
          placeholder="Thank you for your purchase!"
          hint="Printed at the very bottom of every receipt."
        />
      </div>
    </div>
  );

  const TabLayout = (
    <div className="space-y-5">
      <PaperWidthPicker value={form.paper_width_mm} onChange={set("paper_width_mm")} />
      <FontSizePicker   value={form.font_size}       onChange={set("font_size")} />
      <CopiesPicker     value={form.receipt_copies}  onChange={set("receipt_copies")} />

      <TextInput
        label="Currency Symbol"
        icon={Hash}
        value={form.currency_symbol}
        onChange={set("currency_symbol")}
        placeholder="₦"
        hint="Symbol prepended to all monetary values on the receipt."
      />

      <Toggle
        label="Auto-Print After Sale"
        description="Automatically send to the default printer when a transaction completes."
        checked={form.auto_print}
        onChange={set("auto_print")}
      />
    </div>
  );

  const TabContent = (
    <div className="space-y-3">
      <Toggle
        label="Show QR Code"
        description="Embed a scannable QR code tied to the transaction reference ID."
        checked={form.show_qr_code}
        onChange={set("show_qr_code")}
      />
      <Toggle
        label="Show Cashier Name"
        description="Print the name of the cashier who processed the sale."
        checked={form.show_cashier_name}
        onChange={set("show_cashier_name")}
      />
      <Toggle
        label="Show Customer Name"
        description="Print the customer's name when attached to the transaction."
        checked={form.show_customer_name}
        onChange={set("show_customer_name")}
      />
      <Toggle
        label="Show Item SKU"
        description="Display the product SKU code beneath each item name."
        checked={form.show_item_sku}
        onChange={set("show_item_sku")}
      />
      <Toggle
        label="Show Tax Breakdown"
        description="Print a separate tax line in the totals section."
        checked={form.show_tax_breakdown}
        onChange={set("show_tax_breakdown")}
      />
    </div>
  );

  const tabContent = { branding: TabBranding, layout: TabLayout, content: TabContent };

  return (
    <div className="flex flex-col xl:flex-row gap-6 items-start">

      {/* ── Left: Settings Form ─────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 rounded-xl border border-border bg-card overflow-hidden">

        {/* Sub-tab bar */}
        <div className="flex border-b border-border bg-muted/20">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-xs font-semibold transition-colors border-b-2",
                activeTab === id
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5">
          {tabContent[activeTab]}
        </div>

        {/* Save bar */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/10 px-5 py-3.5">
          {saved ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Settings saved
            </div>
          ) : saveMutation.error ? (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {String(saveMutation.error)}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Preview updates as you edit. Save when ready.
            </p>
          )}

          <Button
            variant="default"
            size="sm"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="gap-1.5 px-5"
          >
            {saveMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
              : <><Settings2 className="h-3.5 w-3.5" /> Save Settings</>
            }
          </Button>
        </div>
      </div>

      {/* ── Right: Live Receipt Preview ─────────────────────────────────── */}
      <div className="xl:sticky xl:top-6 xl:w-auto w-full">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Live Preview
          </span>
        </div>
        <div className="flex justify-center xl:justify-start overflow-x-auto pb-2">
          <ReceiptPreview settings={form} />
        </div>
        <p className="mt-2 text-center xl:text-left text-[10px] text-muted-foreground">
          Sample data — actual receipts use real transaction values.
        </p>
      </div>
    </div>
  );
}
