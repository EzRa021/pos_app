// ============================================================================
// commands/printer.js — Native ESC/POS printer commands
// ============================================================================
// These commands use Tauri invoke() — NOT the HTTP RPC server.
//
// Why invoke and not rpc()?
//   Each terminal (server or client) must print on its own locally-attached
//   printer. The HTTP server only runs on the server machine; using rpc()
//   would route all print jobs through the server's printer, which is wrong.
//   invoke() calls the native Tauri layer on the CURRENT machine.
//
// Usage:
//   import { listPrinters, printReceiptEscpos } from "@/commands/printer";
//   const printers = await listPrinters();
//   await printReceiptEscpos(transactionId, "XPrinter XP-58");
// ============================================================================

import { invoke }       from "@tauri-apps/api/core";
import { useAuthStore } from "@/stores/auth.store";

/** Get the current session token from the auth store. */
function tok() {
  return useAuthStore.getState().token ?? "";
}

/**
 * List all printers available on this machine.
 * @returns {Promise<Array<{ name: string, is_default: boolean }>>}
 */
export const listPrinters = () =>
  invoke("list_printers", { token: tok() });

/**
 * Get the Windows system-default printer name.
 * @returns {Promise<string | null>}
 */
export const getDefaultPrinter = () =>
  invoke("get_default_printer", { token: tok() });

/**
 * Print a receipt for the given transaction via ESC/POS — no dialog.
 * Reads paper size and receipt settings from the database automatically.
 * @param {number} transactionId
 * @param {string} printerName  Exact Windows printer name from listPrinters()
 */
export const printReceiptEscpos = (transactionId, printerName) =>
  invoke("print_receipt_escpos", {
    token:   tok(),
    payload: { transaction_id: transactionId, printer_name: printerName },
  });

/**
 * Print barcode labels for a set of items via ESC/POS — no dialog.
 * @param {Object} opts
 * @param {string}   opts.printerName   - Exact Windows printer name
 * @param {number}   opts.storeId
 * @param {string[]} [opts.itemIds]     - Specific item UUIDs (or use scope)
 * @param {number}   [opts.categoryId]  - Print all items in category
 * @param {number}   [opts.departmentId]- Print all items in department
 * @param {number}   [opts.copies]      - Copies per label (default 1)
 * @param {boolean}  [opts.showName]    - Print item name (default true)
 * @param {boolean}  [opts.showPrice]   - Print price (default true)
 * @param {boolean}  [opts.showSku]     - Print SKU (default true)
 */
export const printLabelsEscpos = ({
  printerName,
  storeId,
  itemIds,
  categoryId,
  departmentId,
  copies,
  showName,
  showPrice,
  showSku,
}) =>
  invoke("print_labels_escpos", {
    token:   tok(),
    payload: {
      printer_name:  printerName,
      store_id:      storeId,
      item_ids:      itemIds      ?? null,
      category_id:   categoryId   ?? null,
      department_id: departmentId ?? null,
      copies:        copies       ?? 1,
      show_name:     showName     ?? true,
      show_price:    showPrice    ?? true,
      show_sku:      showSku      ?? true,
    },
  });

/**
 * Send a brief test page to verify a printer is connected and configured.
 * @param {string} printerName  Exact Windows printer name
 */
export const printTestPage = (printerName) =>
  invoke("print_test_page", { token: tok(), printerName });
