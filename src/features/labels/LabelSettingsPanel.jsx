// ============================================================================
// features/labels/LabelSettingsPanel.jsx
// ============================================================================
// Label & barcode printing settings.
// Two-column layout: settings form (left) + live label preview (right).
// Matches the pattern + quality of ReceiptSettingsPanel.
// ============================================================================

import { useState, useEffect } from "react";
import {
  Printer, Tag, ToggleLeft, Layers, Settings2,
  CheckCircle2, AlertCircle, Loader2, Eye,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { cn }     from "@/lib/utils";
import { useLabelTemplate, DEFAULT_TEMPLATE } from "./useLabelPrinting";

// ── Reusable field components (mirror ReceiptSettingsPanel style) ─────────────

function Toggle({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3.5 py-3 hover:bg-muted/40 transition-colors">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        {description && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{description}</p>
        )}
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        className={cn(
          "flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors duration-200",
          checked ? "border-primary bg-primary" : "border-border bg-muted",
        )}>
        <span className={cn(
          "block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )} />
      </button>
    </div>
  );
}

// ── Paper format picker ───────────────────────────────────────────────────────
const FORMAT_OPTIONS = [
  { value: "58mm", label: "58 mm",  desc: "Narrow thermal" },
  { value: "80mm", label: "80 mm",  desc: "Standard POS"   },
  { value: "a4",   label: "A4",     desc: "Desktop / Laser"},
];

function FormatPicker({ value, onChange }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Printer className="h-3.5 w-3.5 text-muted-foreground" />
        Paper Format
      </label>
      <div className="grid grid-cols-3 gap-2">
        {FORMAT_OPTIONS.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg border py-2.5 text-center transition-colors",
              value === o.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/20 text-foreground hover:bg-muted/50",
            )}>
            <div className="text-sm font-bold">{o.label}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{o.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Live label preview ────────────────────────────────────────────────────────
// Renders a React mock-up of the label — not the actual print HTML.
// Gives immediate visual feedback as settings change.

const PREVIEW_SAMPLE = {
  item_name:     "Indomie Noodles ×12",
  sku:           "IND-001",
  barcode:       "1234567890128",
  selling_price: 1500,
  store_name:    "Quantum POS",
};

// Simple simulated barcode using alternating thin/thick bars
function SimBarcode({ value = "1234567890", height = 28 }) {
  const seed   = value.split("").reduce((a, c, i) => a ^ (c.charCodeAt(0) * (i + 1)), 0);
  const bars   = [];
  const count  = 32;
  for (let i = 0; i < count; i++) {
    const isBlack = ((seed >> (i % 16)) & 1) === 1;
    const width   = ((seed * (i + 3)) % 3) + 1; // 1, 2, or 3px
    bars.push({ black: isBlack, width });
  }
  const totalW = bars.reduce((a, b) => a + b.width, 0);

  return (
    <div style={{ width: "100%", overflow: "hidden" }}>
      <svg viewBox={`0 0 ${totalW} ${height}`} preserveAspectRatio="none"
        style={{ width: "100%", height: `${height}px`, display: "block" }}>
        {bars.reduce((acc, bar, i) => {
          const x = acc.x;
          if (bar.black) {
            acc.rects.push(
              <rect key={i} x={x} y={0} width={bar.width} height={height} fill="#000" />
            );
          }
          acc.x += bar.width;
          return acc;
        }, { x: 0, rects: [] }).rects}
      </svg>
      <div style={{
        textAlign: "center", fontFamily: "Courier New, monospace",
        fontSize: "7px", color: "#000", marginTop: "1px", letterSpacing: "0.5px",
      }}>
        {value}
      </div>
    </div>
  );
}

const FORMAT_PREVIEW_STYLE = {
  "58mm": { width: 180, nameFontSize: 10, priceFontSize: 14, barcodeH: 24 },
  "80mm": { width: 240, nameFontSize: 11, priceFontSize: 16, barcodeH: 30 },
  "a4":   { width: 200, nameFontSize: 10, priceFontSize: 13, barcodeH: 26 },
};

function LabelPreview({ template }) {
  const fmt   = template?.format || "80mm";
  const style = FORMAT_PREVIEW_STYLE[fmt] || FORMAT_PREVIEW_STYLE["80mm"];
  const s     = template ?? DEFAULT_TEMPLATE;
  const price = "₦" + PREVIEW_SAMPLE.selling_price.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
  });

  return (
    <div style={{
      width: style.width,
      fontFamily: "'Courier New', monospace",
      background: "#fff",
      border: "0.6pt solid #bbb",
      borderRadius: 4,
      padding: "8px 10px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
    }}>
      {s.show_store && (
        <div style={{ fontSize: 7, textTransform: "uppercase", letterSpacing: 0.8, color: "#666" }}>
          {PREVIEW_SAMPLE.store_name}
        </div>
      )}
      {s.show_name && (
        <div style={{
          fontSize: style.nameFontSize, fontWeight: 800,
          fontFamily: "Arial, sans-serif", color: "#000",
          lineHeight: 1.25, overflow: "hidden",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {PREVIEW_SAMPLE.item_name}
        </div>
      )}
      <div style={{ flex: 1, minHeight: style.barcodeH + 12 }}>
        <SimBarcode value={PREVIEW_SAMPLE.barcode} height={style.barcodeH} />
      </div>
      {s.show_sku && (
        <div style={{ fontSize: 7, color: "#555", fontFamily: "Courier New, monospace" }}>
          SKU: {PREVIEW_SAMPLE.sku}
        </div>
      )}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6,
        borderTop: "0.5pt solid #e0e0e0", paddingTop: 3, marginTop: "auto",
      }}>
        {s.show_price && (
          <div style={{
            fontSize: style.priceFontSize, fontWeight: 900,
            fontFamily: "Arial, sans-serif", color: "#000",
          }}>
            {price}
          </div>
        )}
        {s.show_expiry && (
          <div style={{ fontSize: 6.5, color: "#555" }}>Exp: ____________</div>
        )}
      </div>
    </div>
  );
}

// ── Settings tabs ─────────────────────────────────────────────────────────────
const TABS = [
  { id: "format",  label: "Format & Template", icon: Printer },
  { id: "content", label: "Content Options",   icon: Layers  },
];

// ── LabelSettingsPanel (main export) ──────────────────────────────────────────
export function LabelSettingsPanel() {
  const { template, isLoading, error, save } = useLabelTemplate();

  const [activeTab, setActiveTab] = useState("format");
  const [form,      setForm]      = useState(null);  // null = not loaded yet
  const [saved,     setSaved]     = useState(false);

  // Load template into local form once
  useEffect(() => {
    if (!form) {
      // Use the loaded template if available, otherwise DEFAULT_TEMPLATE
      setForm({ ...DEFAULT_TEMPLATE, ...(template ?? {}) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const set    = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));
  const setEvt = (key) => (e)   => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async () => {
    if (!form) return;
    try {
      await save.mutateAsync({
        name:        form.name        || "Default",
        format:      form.format      || "80mm",
        show_name:   form.show_name   ?? true,
        show_price:  form.show_price  ?? true,
        show_sku:    form.show_sku    ?? true,
        show_store:  form.show_store  ?? false,
        show_expiry: form.show_expiry ?? false,
        is_default:  true, // LabelSettingsPanel always saves as the default template
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* error shown below */ }
  };

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading || !form) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />Loading label settings…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <AlertCircle className="h-7 w-7 text-destructive" />
        <p className="text-sm font-semibold text-destructive">Failed to load label settings</p>
        <p className="text-xs text-muted-foreground max-w-xs text-center">{String(error)}</p>
      </div>
    );
  }

  // ── Tab content ────────────────────────────────────────────────────────────
  const TabFormat = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          Template Name
        </label>
        <Input
          value={form.name || ""}
          onChange={setEvt("name")}
          placeholder="e.g. Default, Shelf Label, Price Tag"
          className="h-8 text-xs"
        />
        <p className="text-[11px] text-muted-foreground">Identifies this template. Only one can be set as default at a time.</p>
      </div>

      <FormatPicker value={form.format} onChange={set("format")} />

      <div className="rounded-lg border border-border bg-muted/20 px-3.5 py-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">58 mm / 80 mm</strong> — Direct thermal printers.
          Labels print single-column in a continuous roll.{" "}
          <strong className="text-foreground">A4</strong> — Desktop inkjet or laser.
          Labels print 3 columns × 8 rows = 24 per page.
        </p>
      </div>
    </div>
  );

  const TabContent = (
    <div className="space-y-3">
      <Toggle
        label="Show Item Name"
        description="Print the full product name on the label."
        checked={form.show_name ?? true}
        onChange={set("show_name")}
      />
      <Toggle
        label="Show Price"
        description="Print the selling price prominently at the bottom."
        checked={form.show_price ?? true}
        onChange={set("show_price")}
      />
      <Toggle
        label="Show SKU Code"
        description="Print the internal SKU beneath the barcode."
        checked={form.show_sku ?? true}
        onChange={set("show_sku")}
      />
      <Toggle
        label="Show Store Name"
        description="Print the store name at the top of the label."
        checked={form.show_store ?? false}
        onChange={set("show_store")}
      />
      <Toggle
        label="Show Expiry Field"
        description="Add a blank 'Exp: ___' line for perishables."
        checked={form.show_expiry ?? false}
        onChange={set("show_expiry")}
      />
    </div>
  );

  const tabContent = { format: TabFormat, content: TabContent };

  return (
    <div className="flex flex-col xl:flex-row gap-6 items-start">

      {/* ── Left: Settings Form ─────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 rounded-xl border border-border bg-card overflow-hidden">

        {/* Sub-tab bar */}
        <div className="flex border-b border-border bg-muted/20">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-xs font-semibold transition-colors border-b-2",
                activeTab === id
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}>
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5">{tabContent[activeTab]}</div>

        {/* Save bar */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/10 px-5 py-3.5">
          {saved ? (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />Label template saved
            </div>
          ) : save.error ? (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />{String(save.error)}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Preview updates in real-time. Save when ready.
            </p>
          )}
          <Button size="sm" disabled={save.isPending} onClick={handleSave} className="gap-1.5 px-5">
            {save.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
              : <><Settings2 className="h-3.5 w-3.5" />Save Template</>}
          </Button>
        </div>
      </div>

      {/* ── Right: Live Label Preview ────────────────────────────────────── */}
      <div className="xl:sticky xl:top-6 w-full xl:w-auto">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Live Preview
          </span>
        </div>
        <div className="flex justify-center xl:justify-start">
          <LabelPreview template={form} />
        </div>
        <p className="mt-3 text-center xl:text-left text-[10px] text-muted-foreground">
          Sample data — actual labels use real item values.
        </p>
      </div>

    </div>
  );
}
