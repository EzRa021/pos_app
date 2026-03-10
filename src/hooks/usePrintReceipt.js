// ============================================================================
// hooks/usePrintReceipt.js
// ============================================================================
// Fetches receipt HTML from the backend, injects it into a hidden <iframe>,
// and triggers window.print() scoped to that frame only.
//
// Why iframe and not window.open()?
//   • No popup blockers / new tab flicker
//   • Print dialog opens immediately, scoped only to receipt HTML
//   • Works offline / in Tauri desktop context
//   • Iframe is removed from DOM immediately after printing
//
// Usage:
//   const { print, isPrinting, error } = usePrintReceipt();
//   await print(transactionId);
// ============================================================================

import { useState, useCallback } from "react";
import { generateReceiptHtml }   from "@/commands/receipts";

export function usePrintReceipt() {
  const [isPrinting, setIsPrinting] = useState(false);
  const [error,      setError]      = useState(null);

  const print = useCallback(async (transactionId) => {
    if (!transactionId) return;
    setIsPrinting(true);
    setError(null);

    try {
      // 1. Ask the backend to build + persist the receipt HTML
      const receipt = await generateReceiptHtml(transactionId);
      const html    = receipt?.html_content;

      if (!html) {
        throw new Error("No receipt HTML returned from backend.");
      }

      // 2. Create a hidden iframe, inject the HTML, and print it
      await printHtml(html);

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

// ── printHtml ─────────────────────────────────────────────────────────────────
// Injects HTML into a hidden iframe, waits for it to load, prints, then removes.
function printHtml(html) {
  return new Promise((resolve, reject) => {
    // Create and hide iframe
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

    // Write receipt HTML into iframe
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return reject(new Error("Could not create print frame."));
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Once content is loaded, trigger print then clean up
    iframe.onload = () => {
      try {
        iframe.contentWindow.focus(); // required in some browsers
        iframe.contentWindow.print();
        // Remove iframe after a short delay (print dialog may still be open)
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
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
