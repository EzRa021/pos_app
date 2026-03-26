// ============================================================================
// hooks/usePrintReceipt.js
// ============================================================================
// Printing strategy (tried in order):
//
//   1. ESC/POS native  — if a receipt printer is saved in localStorage
//                        (`qpos_receipt_printer`), the receipt is sent as raw
//                        ESC/POS bytes via Tauri invoke → Windows print spooler.
//                        Silent, instant, no dialog.
//
//   2. iframe fallback — if no printer is configured, the backend-generated
//                        HTML receipt is injected into a hidden iframe and
//                        `iframe.contentWindow.print()` is called, which shows
//                        the Chromium print dialog.
//
// Configure the printer at: Settings → Printer.
// ============================================================================

import { useState, useCallback } from "react";
import { generateReceiptHtml }   from "@/commands/receipts";
import { printReceiptEscpos }    from "@/commands/printer";

/** localStorage key where the user's chosen receipt printer name is saved. */
export const RECEIPT_PRINTER_KEY = "qpos_receipt_printer";

export function usePrintReceipt() {
  const [isPrinting, setIsPrinting] = useState(false);
  const [error,      setError]      = useState(null);

  const print = useCallback(async (transactionId) => {
    if (!transactionId) return;
    setIsPrinting(true);
    setError(null);

    try {
      const printerName = localStorage.getItem(RECEIPT_PRINTER_KEY);

      if (printerName) {
        // ── ESC/POS native path ──────────────────────────────────────────────
        // Data is fetched from the DB on the Rust side; no HTML involved.
        await printReceiptEscpos(transactionId, printerName);
      } else {
        // ── iframe fallback path ─────────────────────────────────────────────
        // Ask the backend to build + persist the receipt HTML, then print it
        // via a hidden iframe so the Chromium print dialog appears.
        const receipt = await generateReceiptHtml(transactionId);
        const html    = receipt?.html_content;
        if (!html) throw new Error("No receipt HTML returned from backend.");
        await _printHtmlInIframe(html);
      }
    } catch (err) {
      const msg = typeof err === "string" ? err : (err?.message ?? "Print failed");
      setError(msg);
      throw msg;
    } finally {
      setIsPrinting(false);
    }
  }, []);

  return { print, isPrinting, error };
}

// ── iframe fallback ───────────────────────────────────────────────────────────
// Used when no ESC/POS printer is configured. Injects the HTML receipt into a
// hidden iframe and triggers the Chromium print dialog on that frame only.
function _printHtmlInIframe(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = [
      "position:fixed",
      "top:-9999px",
      "left:-9999px",
      "width:1px",
      "height:1px",
      "border:0",
      "visibility:hidden",
    ].join(";");

    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return reject(new Error("Could not create print frame."));
    }

    doc.open();
    doc.write(html);
    doc.close();

    iframe.onload = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => {
          if (document.body.contains(iframe)) document.body.removeChild(iframe);
          resolve();
        }, 1000);
      } catch (e) {
        document.body.removeChild(iframe);
        reject(e);
      }
    };

    iframe.onerror = () => {
      document.body.removeChild(iframe);
      reject(new Error("Failed to load print frame."));
    };
  });
}
