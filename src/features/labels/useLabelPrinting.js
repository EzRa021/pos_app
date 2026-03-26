// ============================================================================
// features/labels/useLabelPrinting.js
// ============================================================================
// Three hooks:
//   useLabelTemplate  — load + save the store's label template settings
//   usePrintLabels    — print labels via ESC/POS (native) or iframe (fallback)
//
// Printing strategy (same as usePrintReceipt):
//   1. If "qpos_label_printer" is set in localStorage → native ESC/POS via Tauri
//   2. Otherwise → iframe with Chromium print dialog (previous behaviour)
// ============================================================================

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranchStore } from "@/stores/branch.store";
import {
  generateItemLabels,
  autoGenerateBarcode,
  printPriceTags,
  getLabelTemplate,
  saveLabelTemplate,
} from "@/commands/labels";
import { printLabelsEscpos } from "@/commands/printer";
import { bulkPrintLabels }   from "@/commands/bulk_operations";
import { generateLabelHtml } from "./labelHtml";

/** localStorage key where the chosen label printer name is saved. */
export const LABEL_PRINTER_KEY = "qpos_label_printer";

// ── Default template (used when no saved template exists) ─────────────────────
export const DEFAULT_TEMPLATE = {
  name:        "Default",
  format:      "80mm",
  show_name:   true,
  show_price:  true,
  show_sku:    true,
  show_store:  false,
  show_expiry: false,
  is_default:  true,
};

// ── useLabelTemplate ──────────────────────────────────────────────────────────
export function useLabelTemplate() {
  const storeId = useBranchStore((s) => s.activeStore?.id);
  const qc      = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey:  ["label-template", storeId],
    queryFn:   () => getLabelTemplate(storeId),
    enabled:   !!storeId,
    staleTime: 5 * 60_000,
  });

  const template = data ?? null;

  const save = useMutation({
    mutationFn: (payload) => saveLabelTemplate({ store_id: storeId, ...payload }),
    onSuccess:  (saved) => { qc.setQueryData(["label-template", storeId], saved); },
  });

  return { template, isLoading, error: error ?? null, save };
}

// ── usePrintLabels ────────────────────────────────────────────────────────────
export function usePrintLabels() {
  const storeId           = useBranchStore((s) => s.activeStore?.id);
  const [isPrinting,    setIsPrinting]    = useState(false);
  const [isGenerating,  setIsGenerating]  = useState(false);
  const [error,         setError]         = useState(null);

  // ── Internal: try native ESC/POS, fall back to iframe ────────────────────
  const _nativeOrIframe = useCallback(async ({ itemIds, categoryId, departmentId, copies, template }) => {
    const printerName = localStorage.getItem(LABEL_PRINTER_KEY);
    const tmpl        = template ?? DEFAULT_TEMPLATE;

    if (printerName) {
      // ── Native ESC/POS path ──────────────────────────────────────────────
      await printLabelsEscpos({
        printerName,
        storeId,
        itemIds,
        categoryId,
        departmentId,
        copies:     copies  ?? 1,
        showName:   tmpl.show_name  ?? true,
        showPrice:  tmpl.show_price ?? true,
        showSku:    tmpl.show_sku   ?? true,
      });
    } else {
      // ── iframe fallback path ─────────────────────────────────────────────
      let labels;
      if (itemIds?.length) {
        labels = await generateItemLabels({
          store_id: storeId,
          item_ids: itemIds.map(String),
          copies:   Math.max(1, copies ?? 1),
        });
      } else if (categoryId || departmentId) {
        labels = await printPriceTags({
          store_id:      storeId,
          category_id:   categoryId   || undefined,
          department_id: departmentId || undefined,
          copies:        Math.max(1, copies ?? 1),
        });
      } else {
        throw new Error("Provide itemIds, categoryId, or departmentId.");
      }
      if (!labels?.length) throw new Error("No label data returned from server.");
      await _printInIframe(generateLabelHtml(labels, tmpl));
    }
  }, [storeId]);

  // ── printByIds ──────────────────────────────────────────────────────────
  // Used for: single-item row action + multi-select bulk print.
  const printByIds = useCallback(async ({ itemIds, copies = 1, template }) => {
    if (!storeId || !itemIds?.length) return;
    setIsPrinting(true);
    setError(null);
    try {
      await _nativeOrIframe({ itemIds, copies, template });
    } catch (e) {
      const msg = typeof e === "string" ? e : (e?.message ?? "Print failed");
      setError(msg);
      throw msg;
    } finally {
      setIsPrinting(false);
    }
  }, [storeId, _nativeOrIframe]);

  // ── printByScope ────────────────────────────────────────────────────────
  // Used for: BulkActionsMenu → Print Labels by category or department.
  const printByScope = useCallback(async ({ categoryId, departmentId, copies = 1, template }) => {
    if (!storeId) return;
    if (!categoryId && !departmentId) throw new Error("Provide a category or department.");
    setIsPrinting(true);
    setError(null);
    try {
      await _nativeOrIframe({ categoryId, departmentId, copies, template });
    } catch (e) {
      const msg = typeof e === "string" ? e : (e?.message ?? "Print failed");
      setError(msg);
      throw msg;
    } finally {
      setIsPrinting(false);
    }
  }, [storeId, _nativeOrIframe]);

  // ── printBulk ───────────────────────────────────────────────────────────
  // Single entry-point for all bulk print flows.
  const printBulk = useCallback(async ({
    itemIds, categoryId, departmentId, copies = 1, template,
  }) => {
    if (!storeId) return;
    if (!itemIds?.length && !categoryId && !departmentId) {
      throw new Error("Provide itemIds, categoryId, or departmentId.");
    }
    setIsPrinting(true);
    setError(null);
    try {
      const printerName = localStorage.getItem(LABEL_PRINTER_KEY);
      const tmpl        = template ?? DEFAULT_TEMPLATE;

      if (printerName) {
        // Native path — bulk_print_labels merged with ESC/POS
        await printLabelsEscpos({
          printerName,
          storeId,
          itemIds,
          categoryId,
          departmentId,
          copies:    copies ?? 1,
          showName:  tmpl.show_name  ?? true,
          showPrice: tmpl.show_price ?? true,
          showSku:   tmpl.show_sku   ?? true,
        });
      } else {
        // iframe path — use the existing bulk_print_labels backend command
        const labels = await bulkPrintLabels({
          store_id:      storeId,
          item_ids:      itemIds?.length ? itemIds.map(String) : undefined,
          category_id:   categoryId   || undefined,
          department_id: departmentId || undefined,
          copies:        Math.max(1, copies),
        });
        if (!labels?.length) throw new Error("No labels returned for the selected scope.");
        await _printInIframe(generateLabelHtml(labels, tmpl));
      }
    } catch (e) {
      const msg = typeof e === "string" ? e : (e?.message ?? "Print failed");
      setError(msg);
      throw msg;
    } finally {
      setIsPrinting(false);
    }
  }, [storeId]);

  // ── generateBarcode ─────────────────────────────────────────────────────
  const generateBarcode = useCallback(async (itemId) => {
    setIsGenerating(true);
    try {
      return await autoGenerateBarcode(itemId);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // Backwards-compat alias
  const print = printByIds;

  return { print, printByIds, printByScope, printBulk, generateBarcode, isPrinting, isGenerating, error };
}

// ── _printInIframe ────────────────────────────────────────────────────────────
// Injects HTML into a hidden iframe and triggers the Chromium print dialog.
// Used as fallback when no ESC/POS label printer is configured.
function _printInIframe(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;visibility:hidden;";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return reject(new Error("Could not create print frame."));
    }

    const cleanup = setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
      resolve();
    }, 6000);

    iframe.onerror = () => {
      clearTimeout(cleanup);
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
      reject(new Error("Failed to load print frame."));
    };

    doc.open();
    doc.write(html);
    doc.close();
  });
}
