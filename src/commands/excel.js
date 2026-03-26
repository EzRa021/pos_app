// commands/excel.js — Import / export (items, customers, stock count)
//
// Design contract:
//   • Frontend parses Excel files with SheetJS → sends rows[] as plain JSON.
//   • Backend returns JSON; frontend converts JSON → Excel with SheetJS for downloads.
//   • No file-path handling anywhere — the Tauri sandbox never touches the FS directly.

import { rpc } from "@/lib/apiClient";

// ─────────────────────────────────────────────────────────────────────────────
// ITEM IMPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Import items from pre-parsed Excel rows.
 *
 * @param {number}  storeId  - Active store id
 * @param {Array}   rows     - Array of row objects (parsed by SheetJS on the frontend)
 * @param {boolean} dryRun   - If true, validate + preview without writing to DB
 *
 * Returns ImportResult:
 *   { total, created, updated, failed, dry_run, errors[],
 *     created_departments[], created_categories[],
 *     reactivated_departments[], reactivated_categories[] }
 */
export const importItems = (storeId, rows, dryRun = false) =>
  rpc("import_items", { store_id: storeId, rows, dry_run: dryRun });

// ─────────────────────────────────────────────────────────────────────────────
// STOCK COUNT IMPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Import a stock count (physical stocktake) from pre-parsed rows.
 * Only sets stock quantities — never creates items or modifies taxonomy.
 * Safer than full item import for routine stock counts.
 *
 * @param {number}  storeId  - Active store id
 * @param {Array}   rows     - Array of { sku, quantity, notes? }
 * @param {boolean} dryRun   - If true, validate without writing to DB
 *
 * Returns StockCountResult:
 *   { total, updated, failed, errors[] }
 */
export const importStockCount = (storeId, rows, dryRun = false) =>
  rpc("import_stock_count", { store_id: storeId, rows, dry_run: dryRun });

// ─────────────────────────────────────────────────────────────────────────────
// ITEM EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export ALL non-archived items for a store as a JSON array.
 */
export const exportItems = (storeId) =>
  rpc("export_items", { store_id: storeId });

/**
 * Export items with optional filters.
 *
 * @param {number}  storeId
 * @param {object}  filters  - { department_id?, category_id?, is_active?, low_stock? }
 *
 * Returns filtered item rows ready for SheetJS.
 * Results sorted: department → category → item name.
 */
export const exportItemsFiltered = (storeId, filters = {}) =>
  rpc("export_items_filtered", {
    store_id:      storeId,
    department_id: filters.departmentId ?? null,
    category_id:   filters.categoryId   ?? null,
    is_active:     filters.isActive      ?? null,
    low_stock:     filters.lowStock      ?? null,
  });

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER IMPORT / EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const importCustomers = (storeId, rows) =>
  rpc("import_customers", { store_id: storeId, rows });

export const exportCustomers = (storeId) =>
  rpc("export_customers", { store_id: storeId });

// ─────────────────────────────────────────────────────────────────────────────
// OTHER EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const exportTransactions = (storeId, params = {}) =>
  rpc("export_transactions", { store_id: storeId, ...params });

export const exportExpenses = (storeId, params = {}) =>
  rpc("export_expenses", { store_id: storeId, ...params });
