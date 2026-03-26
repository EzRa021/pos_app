// features/items/useExcel.js
// Hooks for Excel import and export.
//
// Export flow:
//   1. Fetch data from backend (JSON).
//   2. Convert to Excel using SheetJS.
//   3. Write the .xlsx file into the user-configured export folder using
//      @tauri-apps/plugin-fs (mkdir if needed, then writeFile).
//   4. If no folder is configured fall back to a browser <a> download.
//
// Import flow:
//   1. User selects a file in the UI.
//   2. SheetJS parses it into row objects.
//   3. The UI-selected import mode (auto / create / update) is injected as
//      the `action` field — it never comes from the spreadsheet itself.
//   4. Rows are chunked and sent to the backend in batches of 200.

import { useState, useCallback }         from "react";
import { useQueryClient }                from "@tanstack/react-query";
import { toast }                         from "sonner";
import * as XLSX                         from "xlsx";
import { mkdir, writeFile, exists }      from "@tauri-apps/plugin-fs";
import { openPath }                      from "@tauri-apps/plugin-opener";
import {
  importItems,
  importStockCount,
  exportItems,
  exportItemsFiltered,
} from "@/commands/excel";
import { invalidateStock }               from "@/lib/invalidations";
import { getExportFolder }               from "@/lib/excelSettings";

// ─────────────────────────────────────────────────────────────────────────────
// Column definitions
// Order: item_name first, then identity, taxonomy, pricing, settings, stock.
// The `action` field is NOT in the spreadsheet — it's set via the UI mode
// selector and injected into every row before the backend call.
// ─────────────────────────────────────────────────────────────────────────────

export const ITEM_COLUMNS = [
  // identity (item_name first per user request)
  { key: "item_name",         type: "text",   required: false, hint: "Required when adding new items." },
  { key: "sku",               type: "text",   required: true,  hint: "Unique product code. Required on every row." },
  { key: "barcode",           type: "text",   required: false, hint: "EAN / UPC barcode. Must be globally unique." },
  { key: "description",       type: "text",   required: false, hint: "Optional product description." },
  // taxonomy
  { key: "department_name",   type: "text",   required: false, hint: "Auto-created if not found." },
  { key: "category_name",     type: "text",   required: false, hint: "Auto-created if not found." },
  // pricing
  { key: "selling_price",     type: "number", required: false, hint: "Required for new items. Must be > 0." },
  { key: "cost_price",        type: "number", required: false, hint: "Purchase / landed cost." },
  { key: "discount_price",    type: "number", required: false, hint: "Promotional / sale price (optional)." },
  // settings
  { key: "is_active",         type: "bool",   required: false, hint: "TRUE or FALSE. Default TRUE for new items." },
  { key: "track_stock",       type: "bool",   required: false, hint: "Track stock levels. Default TRUE." },
  { key: "sellable",          type: "bool",   required: false, hint: "Default TRUE." },
  { key: "available_for_pos", type: "bool",   required: false, hint: "Visible on POS screen. Default TRUE." },
  { key: "taxable",           type: "bool",   required: false, hint: "Apply VAT at checkout. Default FALSE." },
  { key: "allow_discount",    type: "bool",   required: false, hint: "Allow cashier to apply a discount. Default TRUE." },
  { key: "measurement_type",  type: "text",   required: false, hint: "quantity | weight | volume | length" },
  { key: "unit_type",         type: "text",   required: false, hint: 'e.g. "kg", "L", "m". Only needed when measurement_type ≠ quantity.' },
  { key: "min_stock_level",   type: "number", required: false, hint: "Reorder alert threshold." },
  { key: "max_stock_level",   type: "number", required: false, hint: "Maximum stock cap." },
  // stock
  { key: "quantity",          type: "number", required: false, hint: "New items: initial stock. Updates: SET stock to this exact value. Leave blank to keep unchanged." },
  { key: "stock_adjustment",  type: "number", required: false, hint: "Updates only: ADD this value to current stock (negative to subtract). Cannot be used together with 'quantity'." },
];

export const STOCK_COUNT_COLUMNS = [
  { key: "sku",      type: "text",   required: true,  hint: "Must match an existing item SKU exactly." },
  { key: "quantity", type: "number", required: true,  hint: "Actual counted quantity. Must be ≥ 0." },
  { key: "notes",    type: "text",   required: false, hint: "Optional note (e.g. 'Shelf 3, counted by Ade')." },
];

export const IMPORT_MODES = [
  { value: "auto",   label: "Auto-detect",  desc: "Creates new items and updates existing ones, decided by SKU." },
  { value: "create", label: "Create only",  desc: "All rows are new items. Fails if the SKU already exists." },
  { value: "update", label: "Update only",  desc: "All rows update existing items. Fails if SKU is not found." },
];

const CHUNK_SIZE = 200;

// ─────────────────────────────────────────────────────────────────────────────
// File-save helper
// Writes the blob to the configured export folder using Tauri's fs plugin.
// Falls back to a browser <a> download if no folder is set.
// ─────────────────────────────────────────────────────────────────────────────

export async function saveExcelFile(blob, filename) {
  const folder = getExportFolder().trim();

  // ── Tauri path: write to configured folder (or temp dir) then open ─────────
  if (window.__TAURI_INTERNALS__) {
    try {
      // If no export folder configured, fall back to the system temp directory
      // so we can still open the file in Excel.
      let targetFolder = folder;
      if (!targetFolder) {
        // Use the app's local data dir as a scratch space
        const { appLocalDataDir } = await import("@tauri-apps/api/path");
        targetFolder = await appLocalDataDir();
      }

      // Create the folder if it doesn't exist
      const folderExists = await exists(targetFolder);
      if (!folderExists) {
        await mkdir(targetFolder, { recursive: true });
      }

      // Build full path (Windows \ vs POSIX /)
      const sep      = targetFolder.includes("\\") ? "\\" : "/";
      const fullPath = `${targetFolder}${sep}${filename}`;

      const buf = await blob.arrayBuffer();
      await writeFile(fullPath, new Uint8Array(buf));

      // Toast first so the user sees feedback immediately
      const savedLabel = folder ? `Saved to ${folder}` : "File ready";
      toast.success(`${savedLabel} — opening in Excel…`, { id: "excel-save" });

      // Open with the system default handler for .xlsx (Excel / LibreOffice)
      await openPath(fullPath);

      return fullPath;
    } catch (e) {
      console.error("Tauri save/open failed:", e);
      toast.error(`Could not save file: ${e?.message ?? e}`);
      return null;
    }
  }

  // ── Browser fallback (non-Tauri environment) ────────────────────────────────
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`${filename} downloaded.`);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a JSON array to an .xlsx Blob. */
export function jsonToExcelBlob(rows, sheetName = "Sheet1") {
  const ws  = XLSX.utils.json_to_sheet(rows);
  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Parse an Excel / CSV file and return raw row objects. */
export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb   = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsArrayBuffer(file);
  });
}

/** Normalise one raw SheetJS row into the shape the backend expects. */
function normaliseItemRow(raw) {
  const row = { action: null }; // action is always null; injected per import mode later
  for (const col of ITEM_COLUMNS) {
    const rawVal = raw[col.key];
    if (rawVal === undefined || rawVal === null || rawVal === "") {
      row[col.key] = null;
      continue;
    }
    if (col.type === "number") {
      const n = parseFloat(String(rawVal).replace(/,/g, ""));
      row[col.key] = isNaN(n) ? null : n;
    } else if (col.type === "bool") {
      const s = String(rawVal).trim().toLowerCase();
      row[col.key] = s === "true" || s === "yes" || s === "1" ? true
                   : s === "false" || s === "no"  || s === "0" ? false
                   : null;
    } else {
      row[col.key] = String(rawVal).trim() || null;
    }
  }
  return row;
}

function normaliseStockCountRow(raw) {
  return {
    sku:      String(raw.sku ?? raw.SKU ?? "").trim() || null,
    quantity: parseFloat(String(raw.quantity ?? raw.Quantity ?? "").replace(/,/g, "")) || 0,
    notes:    String(raw.notes ?? raw.Notes ?? "").trim() || null,
  };
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mergeImportResults(a, b) {
  return {
    total:   (a.total   ?? 0) + (b.total   ?? 0),
    created: (a.created ?? 0) + (b.created ?? 0),
    updated: (a.updated ?? 0) + (b.updated ?? 0),
    failed:  (a.failed  ?? 0) + (b.failed  ?? 0),
    dry_run: b.dry_run,
    errors:  [...(a.errors ?? []), ...(b.errors ?? [])],
    created_departments:     [...new Set([...(a.created_departments ?? []),     ...(b.created_departments ?? [])])],
    created_categories:      [...new Set([...(a.created_categories ?? []),      ...(b.created_categories ?? [])])],
    reactivated_departments: [...new Set([...(a.reactivated_departments ?? []), ...(b.reactivated_departments ?? [])])],
    reactivated_categories:  [...new Set([...(a.reactivated_categories ?? []),  ...(b.reactivated_categories ?? [])])],
  };
}

/** Save the error report xlsx (failed rows annotated with error message). */
export async function downloadErrorReport(result, originalRows) {
  if (!result?.errors?.length) return;

  const errorRowSet = new Map(result.errors.map((e) => [e.row, e.message]));
  const errorData   = originalRows
    .map((row, idx) => {
      const msg = errorRowSet.get(idx + 2);
      return msg ? { ...row, __error__: msg } : null;
    })
    .filter(Boolean);

  if (!errorData.length) return;

  const blob = jsonToExcelBlob(errorData, "Errors");
  await saveExcelFile(blob, `import_errors_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// useExcelImport
// ─────────────────────────────────────────────────────────────────────────────

export function useExcelImport(storeId) {
  const qc = useQueryClient();

  const [file,           setFile]          = useState(null);
  const [normalisedRows, setNormalisedRows] = useState([]);
  const [rawRows,        setRawRows]        = useState([]);
  const [parseError,     setParseError]     = useState(null);
  const [importing,      setImporting]      = useState(false);
  const [progress,       setProgress]       = useState(null);
  const [result,         setResult]         = useState(null);
  const [importMode,     setImportMode]     = useState("auto"); // "auto" | "create" | "update"

  const handleFileChange = useCallback(async (selectedFile) => {
    if (!selectedFile) {
      setFile(null); setRawRows([]); setNormalisedRows([]); setParseError(null);
      return;
    }
    setFile(selectedFile);
    setResult(null);
    setParseError(null);
    try {
      const raw  = await parseExcelFile(selectedFile);
      const norm = raw.map(normaliseItemRow).filter((r) => r.sku);
      setRawRows(raw);
      setNormalisedRows(norm);
    } catch (err) {
      setParseError(err?.message ?? "Could not parse file");
      setRawRows([]);
      setNormalisedRows([]);
    }
  }, []);

  const runImport = useCallback(async ({ dryRun = false } = {}) => {
    if (!normalisedRows.length) { toast.error("No valid rows to import"); return; }
    setImporting(true);
    setResult(null);
    setProgress(null);

    try {
      const modeAction     = importMode === "auto" ? null : importMode;
      const rowsWithAction = normalisedRows.map((r) => ({ ...r, action: modeAction }));
      const chunks         = chunkArray(rowsWithAction, CHUNK_SIZE);

      let merged = {
        total: 0, created: 0, updated: 0, failed: 0, dry_run: dryRun,
        errors: [], created_departments: [], created_categories: [],
        reactivated_departments: [], reactivated_categories: [],
      };

      for (let i = 0; i < chunks.length; i++) {
        setProgress({ done: i * CHUNK_SIZE, total: rowsWithAction.length });
        merged = mergeImportResults(merged, await importItems(storeId, chunks[i], dryRun));
      }

      setProgress(null);
      setResult(merged);

      if (!dryRun && (merged.created + merged.updated) > 0) {
        invalidateStock(storeId);
        qc.invalidateQueries({ queryKey: ["items"] });
        qc.invalidateQueries({ queryKey: ["categories"] });
        qc.invalidateQueries({ queryKey: ["departments"] });
        toast.success(
          `Import complete: ${merged.created} created, ${merged.updated} updated` +
          (merged.failed > 0 ? `, ${merged.failed} failed` : ""),
        );
      } else if (!dryRun && merged.failed === rowsWithAction.length) {
        toast.error("All rows failed — no changes made.");
      }
    } catch (err) {
      setProgress(null);
      toast.error(typeof err === "string" ? err : (err?.message ?? "Import failed"));
    } finally {
      setImporting(false);
    }
  }, [storeId, normalisedRows, importMode, qc]);

  const exportErrors = useCallback(() => {
    downloadErrorReport(result, rawRows);
  }, [result, rawRows]);

  const reset = useCallback(() => {
    setFile(null); setRawRows([]); setNormalisedRows([]);
    setParseError(null); setResult(null); setProgress(null);
  }, []);

  return {
    file, normalisedRows, parseError, importing, progress, result,
    importMode, setImportMode,
    rowCount: normalisedRows.length,
    handleFileChange, runImport, exportErrors, reset,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useStockCountImport
// ─────────────────────────────────────────────────────────────────────────────

export function useStockCountImport(storeId) {
  const qc = useQueryClient();

  const [file,           setFile]          = useState(null);
  const [normalisedRows, setNormalisedRows] = useState([]);
  const [rawRows,        setRawRows]        = useState([]);
  const [parseError,     setParseError]     = useState(null);
  const [importing,      setImporting]      = useState(false);
  const [progress,       setProgress]       = useState(null);
  const [result,         setResult]         = useState(null);

  const handleFileChange = useCallback(async (selectedFile) => {
    if (!selectedFile) {
      setFile(null); setRawRows([]); setNormalisedRows([]); setParseError(null);
      return;
    }
    setFile(selectedFile);
    setResult(null);
    setParseError(null);
    try {
      const raw  = await parseExcelFile(selectedFile);
      const norm = raw.map(normaliseStockCountRow).filter((r) => r.sku);
      setRawRows(raw);
      setNormalisedRows(norm);
    } catch (err) {
      setParseError(err?.message ?? "Could not parse file");
      setRawRows([]);
      setNormalisedRows([]);
    }
  }, []);

  const runImport = useCallback(async ({ dryRun = false } = {}) => {
    if (!normalisedRows.length) { toast.error("No valid rows to import"); return; }
    setImporting(true);
    setResult(null);
    setProgress(null);

    try {
      const chunks = chunkArray(normalisedRows, CHUNK_SIZE);
      let merged   = { total: 0, updated: 0, failed: 0, errors: [] };

      for (let i = 0; i < chunks.length; i++) {
        setProgress({ done: i * CHUNK_SIZE, total: normalisedRows.length });
        const r = await importStockCount(storeId, chunks[i], dryRun);
        merged = {
          total:   merged.total   + r.total,
          updated: merged.updated + r.updated,
          failed:  merged.failed  + r.failed,
          errors:  [...merged.errors, ...r.errors],
          dry_run: dryRun,
        };
      }

      setProgress(null);
      setResult(merged);

      if (!dryRun && merged.updated > 0) {
        invalidateStock(storeId);
        qc.invalidateQueries({ queryKey: ["items"] });
        toast.success(
          `Stock count applied: ${merged.updated} item${merged.updated !== 1 ? "s" : ""} updated` +
          (merged.failed > 0 ? `, ${merged.failed} failed` : ""),
        );
      }
    } catch (err) {
      setProgress(null);
      toast.error(typeof err === "string" ? err : (err?.message ?? "Stock count import failed"));
    } finally {
      setImporting(false);
    }
  }, [storeId, normalisedRows, qc]);

  const exportErrors = useCallback(async () => {
    if (!result?.errors?.length) return;
    const errorRowSet = new Map(result.errors.map((e) => [e.row, e.message]));
    const errorData   = rawRows
      .map((row, idx) => {
        const msg = errorRowSet.get(idx + 2);
        return msg ? { ...row, __error__: msg } : null;
      })
      .filter(Boolean);
    if (!errorData.length) return;
    await saveExcelFile(
      jsonToExcelBlob(errorData, "Errors"),
      `stock_count_errors_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }, [result, rawRows]);

  const reset = useCallback(() => {
    setFile(null); setRawRows([]); setNormalisedRows([]);
    setParseError(null); setResult(null); setProgress(null);
  }, []);

  return {
    file, normalisedRows, parseError, importing, progress, result,
    rowCount: normalisedRows.length,
    handleFileChange, runImport, exportErrors, reset,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useExcelExport
// ─────────────────────────────────────────────────────────────────────────────

export function useExcelExport(storeId) {
  const [exporting, setExporting] = useState(false);

  /**
   * Export items to Excel.
   * Column order: item_name first, then the rest.
   * No `action` column — mode is set in the UI.
   */
  const exportToExcel = useCallback(async (filters = {}, label = "") => {
    setExporting(true);
    try {
      const hasFilter = Object.values(filters).some((v) => v != null);
      const data      = hasFilter
        ? await exportItemsFiltered(storeId, filters)
        : await exportItems(storeId);

      if (!data?.length) { toast.error("No items to export"); return; }

      // Reorder columns: item_name first, then the ITEM_COLUMNS order,
      // then any extra columns from the backend (reserved_quantity etc.)
      const colOrder  = ITEM_COLUMNS.map((c) => c.key);
      const extraKeys = Object.keys(data[0]).filter((k) => !colOrder.includes(k));
      const allKeys   = [...colOrder, ...extraKeys];

      const orderedRows = data.map((row) => {
        const out = {};
        for (const k of allKeys) {
          if (k in row) out[k] = row[k];
        }
        return out;
      });

      const date   = new Date().toISOString().slice(0, 10);
      const suffix = label ? `_${label.replace(/\s+/g, "_").toLowerCase()}` : "";
      await saveExcelFile(
        jsonToExcelBlob(orderedRows, "Items"),
        `items_export${suffix}_${date}.xlsx`,
      );
    } catch (err) {
      toast.error(typeof err === "string" ? err : (err?.message ?? "Export failed"));
    } finally {
      setExporting(false);
    }
  }, [storeId]);

  /** Item import template — item_name first, no action column, 3 sheets. */
  const downloadItemTemplate = useCallback(async () => {
    // Sample row — columns in ITEM_COLUMNS order (item_name first)
    const sample = {
      item_name:         "Sample Product",
      sku:               "ITEM-001",
      barcode:           "1234567890123",
      description:       "A sample product description",
      department_name:   "General",
      category_name:     "Uncategorised",
      selling_price:     9.99,
      cost_price:        5.00,
      discount_price:    "",
      is_active:         true,
      track_stock:       true,
      sellable:          true,
      available_for_pos: true,
      taxable:           false,
      allow_discount:    true,
      measurement_type:  "quantity",
      unit_type:         "",
      min_stock_level:   5,
      max_stock_level:   1000,
      quantity:          100,
      stock_adjustment:  "",
    };

    // Hints row
    const hints = {};
    for (const col of ITEM_COLUMNS) hints[col.key] = col.hint;

    const ws = XLSX.utils.json_to_sheet([sample, hints]);
    ws["!cols"] = ITEM_COLUMNS.map((c) => ({ wch: Math.max(c.key.length + 4, 18) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");

    // Reference — measurement types
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { measurement_type: "quantity", description: "Pieces, packs, units (default)",  unit_type_examples: "pcs, box, pack, dozen" },
      { measurement_type: "weight",   description: "Sold by weight",                  unit_type_examples: "kg, g, lb, oz"         },
      { measurement_type: "volume",   description: "Sold by volume",                  unit_type_examples: "L, ml, cl, fl oz"      },
      { measurement_type: "length",   description: "Sold by length",                  unit_type_examples: "m, cm, mm, ft, in"     },
    ]), "Reference");

    // Valid values
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { column: "measurement_type", valid_values: "quantity, weight, volume, length" },
      { column: "is_active",        valid_values: "TRUE, FALSE, YES, NO, 1, 0" },
      { column: "track_stock",      valid_values: "TRUE, FALSE, YES, NO, 1, 0" },
      { column: "taxable",          valid_values: "TRUE, FALSE, YES, NO, 1, 0" },
      { column: "allow_discount",   valid_values: "TRUE, FALSE, YES, NO, 1, 0" },
      { column: "sellable",         valid_values: "TRUE, FALSE, YES, NO, 1, 0" },
      { column: "available_for_pos",valid_values: "TRUE, FALSE, YES, NO, 1, 0" },
    ]), "Valid Values");

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    await saveExcelFile(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "items_import_template.xlsx",
    );
  }, []);

  /** Stock-count template — only 3 columns. */
  const downloadStockCountTemplate = useCallback(async () => {
    const ws = XLSX.utils.json_to_sheet([
      { sku: "ITEM-001",  quantity: 50, notes: "Shelf A, counted by Ade" },
      {
        sku:      "Must match an existing item SKU exactly",
        quantity: "Actual counted quantity (must be ≥ 0)",
        notes:    "Optional note",
      },
    ]);
    ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 45 }];

    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock Count");

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    await saveExcelFile(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "stock_count_template.xlsx",
    );
  }, []);

  return { exporting, exportToExcel, downloadItemTemplate, downloadStockCountTemplate };
}
