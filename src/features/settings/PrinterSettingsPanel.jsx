// ============================================================================
// features/settings/PrinterSettingsPanel.jsx
// ============================================================================
// Lets the user pick a receipt printer and a label printer from the list of
// printers installed on this machine (via the Windows print spooler).
// Choices are saved to localStorage so they persist across sessions.
//
// Architecture note:
//   Printer selection is LOCAL — each terminal saves its own printer choice.
//   A cashier terminal prints on its own desk printer, not the server's.
// ============================================================================

import { useState, useEffect } from "react";
import {
  Printer, RefreshCw, CheckCircle2, AlertCircle, Loader2,
  ReceiptText, Tag, Wifi, WifiOff, Info,
} from "lucide-react";
import { Button }               from "@/components/ui/button";
import { cn }                   from "@/lib/utils";
import { listPrinters, printTestPage } from "@/commands/printer";
import { RECEIPT_PRINTER_KEY }  from "@/hooks/usePrintReceipt";
import { LABEL_PRINTER_KEY }    from "@/features/labels/useLabelPrinting";
import { toastSuccess, toastError } from "@/lib/toast";

// ── PrinterPicker ─────────────────────────────────────────────────────────────
// A self-contained sub-panel for selecting one printer (receipt or label).
function PrinterPicker({ title, icon: Icon, description, storageKey, printers, loading }) {
  const [selected,      setSelected]      = useState(() => localStorage.getItem(storageKey) ?? "");
  const [testPending,   setTestPending]   = useState(false);

  // Keep in sync if the user clears localStorage elsewhere
  useEffect(() => {
    const stored = localStorage.getItem(storageKey) ?? "";
    setSelected(stored);
  }, [storageKey]);

  function handleSelect(name) {
    setSelected(name);
    if (name) {
      localStorage.setItem(storageKey, name);
      toastSuccess("Printer Saved", `"${name}" will be used for ${title.toLowerCase()}.`);
    } else {
      localStorage.removeItem(storageKey);
      toastSuccess("Printer Cleared", `${title} will use the browser print dialog instead.`);
    }
  }

  async function handleTest() {
    if (!selected) return;
    setTestPending(true);
    try {
      await printTestPage(selected);
      toastSuccess("Test Print Sent", `Check "${selected}" for the test page.`);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e?.message ?? "Test print failed.");
      toastError("Test Print Failed", msg);
    } finally {
      setTestPending(false);
    }
  }

  const selectedPrinter = printers.find((p) => p.name === selected);
  const isOnline        = !!selectedPrinter; // printer is in the current list = installed

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>

      <div className="p-5 space-y-4">
        <p className="text-xs text-muted-foreground">{description}</p>

        {/* Printer list */}
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Scanning for printers…
          </div>
        ) : printers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/10 py-6 text-center">
            <Printer className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No printers found on this machine.</p>
            <p className="text-[11px] text-muted-foreground/60">
              Install a printer in Windows Settings, then refresh.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* "None" option — clears the selection */}
            <button
              type="button"
              onClick={() => handleSelect("")}
              className={cn(
                "w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                !selected
                  ? "border-primary/40 bg-primary/8 text-primary"
                  : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/30 hover:text-foreground",
              )}
            >
              <div className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                !selected ? "border-primary/30 bg-primary/15" : "border-border bg-transparent",
              )}>
                {!selected
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  : <Printer className="h-3.5 w-3.5 opacity-30" />
                }
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold">None (use browser dialog)</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  The Chromium print dialog will appear each time
                </p>
              </div>
            </button>

            {printers.map((p) => {
              const isSelected = selected === p.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => handleSelect(p.name)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    isSelected
                      ? "border-primary/40 bg-primary/8 text-primary"
                      : "border-border bg-muted/10 text-foreground hover:bg-muted/30",
                  )}
                >
                  <div className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                    isSelected ? "border-primary/30 bg-primary/15" : "border-border bg-muted/30",
                  )}>
                    {isSelected
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                      : <Printer className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      "text-xs font-semibold truncate",
                      isSelected ? "text-primary" : "text-foreground",
                    )}>
                      {p.name}
                    </p>
                    {p.is_default && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">System default</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Selected printer status + test button */}
        {selected && (
          <div className={cn(
            "flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5",
            isOnline
              ? "border-success/30 bg-success/8"
              : "border-warning/30 bg-warning/8",
          )}>
            <div className="flex items-center gap-2 min-w-0">
              {isOnline
                ? <Wifi    className="h-3.5 w-3.5 text-success shrink-0" />
                : <WifiOff className="h-3.5 w-3.5 text-warning shrink-0" />
              }
              <div className="min-w-0">
                <p className={cn(
                  "text-xs font-semibold truncate",
                  isOnline ? "text-success" : "text-warning",
                )}>
                  {selected}
                </p>
                <p className={cn(
                  "text-[11px] mt-0.5",
                  isOnline ? "text-success/70" : "text-warning/70",
                )}>
                  {isOnline ? "Printer found on this machine" : "Printer not found — may be offline"}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={testPending || !isOnline}
              onClick={handleTest}
              className="shrink-0 gap-1.5 h-7 text-xs"
            >
              {testPending
                ? <><Loader2 className="h-3 w-3 animate-spin" />Sending…</>
                : <><Printer className="h-3 w-3" />Test Print</>
              }
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function PrinterSettingsPanel() {
  const [printers,   setPrinters]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState(null);

  async function refresh() {
    setLoading(true);
    setFetchError(null);
    try {
      const list = await listPrinters();
      setPrinters(list ?? []);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e?.message ?? "Could not list printers.");
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="space-y-5">

      {/* How-it-works info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3.5">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-primary">ESC/POS Silent Printing</p>
          <p className="text-[11px] text-primary/80 leading-relaxed">
            When a printer is selected here, receipts and labels are sent directly to
            the Windows print spooler as raw ESC/POS bytes — no dialog, instant output.
            This works with any thermal printer that speaks ESC/POS (Xprinter, GOOJPRT,
            Epson TM, Star TSP, etc.). Leave blank to use the standard browser print dialog.
          </p>
        </div>
      </div>

      {/* Refresh button + error */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {loading ? "Scanning…" : `${printers.length} printer${printers.length !== 1 ? "s" : ""} found on this machine`}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={loading}
          className="gap-1.5 h-7 text-xs"
        >
          {loading
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <RefreshCw className="h-3 w-3" />
          }
          Refresh
        </Button>
      </div>

      {fetchError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <p className="text-xs text-destructive">{fetchError}</p>
        </div>
      )}

      {/* Receipt printer picker */}
      <PrinterPicker
        title="Receipt Printer"
        icon={ReceiptText}
        description="Used when printing receipts after a sale. Select your thermal receipt printer (80mm or 58mm roll)."
        storageKey={RECEIPT_PRINTER_KEY}
        printers={printers}
        loading={loading}
      />

      {/* Label printer picker */}
      <PrinterPicker
        title="Label Printer"
        icon={Tag}
        description="Used when printing barcode labels from the Products or Inventory page. Can be the same printer as receipts."
        storageKey={LABEL_PRINTER_KEY}
        printers={printers}
        loading={loading}
      />

      {/* Compatibility note */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          ESC/POS Compatibility
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          This feature sends raw bytes to the printer using the Windows RAW data type.
          It is compatible with any ESC/POS thermal printer installed as a Windows printer
          (USB, serial, network, or Bluetooth). ZPL label printers (Zebra, etc.) are not
          supported with this method — use the browser dialog fallback for those.
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          If your printer does not print correctly, ensure it is set to the correct
          paper size in Windows Devices &amp; Printers and that the RAW port is enabled.
        </p>
      </div>
    </div>
  );
}
