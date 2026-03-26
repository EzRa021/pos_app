// features/items/ExcelImportExportDialog.jsx
// Three-tab dialog: Import Items | Stock Count | Export
//
// Import tab:   file drop → import-mode selector → preview → dry run → import → results
// Stock Count:  file drop → dry run → apply
// Export tab:   filtered export + template downloads (Tauri save dialog)

import { useRef, useState, useEffect } from "react";
import {
  Upload, Download, FileSpreadsheet, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, ChevronDown, ChevronUp,
  FileDown, Info, ClipboardList, Filter, RotateCcw,
  Shuffle, PlusCircle, Edit3,
} from "lucide-react";

import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn }     from "@/lib/utils";
import {
  ITEM_COLUMNS, STOCK_COUNT_COLUMNS, IMPORT_MODES,
  useExcelImport, useStockCountImport, useExcelExport,
} from "./useExcel";
import { getDepartmentsByStore } from "@/commands/departments";
import { getCategories }         from "@/commands/categories";

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_ROWS = 6;

function PreviewTable({ rows, cols }) {
  if (!rows.length) return null;
  const sample = rows.slice(0, PREVIEW_ROWS);
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-muted/30 border-b border-border/60">
            {cols.map((key) => (
              <th key={key} className="px-2.5 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {sample.map((row, i) => (
            <tr key={i} className="hover:bg-muted/20">
              {cols.map((key) => (
                <td key={key} className="px-2.5 py-1.5 text-foreground truncate max-w-[130px]">
                  {row[key] === null || row[key] === undefined || row[key] === ""
                    ? <span className="text-muted-foreground/30 italic">—</span>
                    : String(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > PREVIEW_ROWS && (
        <div className="px-3 py-2 bg-muted/10 border-t border-border/40 text-[10px] text-muted-foreground">
          Showing first {PREVIEW_ROWS} of {rows.length} rows
        </div>
      )}
    </div>
  );
}

function ProgressBar({ progress }) {
  if (!progress) return null;
  const pct = Math.round((progress.done / progress.total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Processing rows…</span>
        <span>{progress.done} / {progress.total}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ResultKpi({ label, value, color }) {
  const cls = {
    default:     "bg-muted/40 text-foreground border-border/60",
    success:     "bg-success/[0.08] text-success border-success/20",
    primary:     "bg-primary/[0.08] text-primary border-primary/20",
    destructive: "bg-destructive/[0.08] text-destructive border-destructive/20",
  }[color];
  return (
    <div className={cn("rounded-lg border px-3 py-2.5 text-center", cls)}>
      <p className="text-[18px] font-bold tabular-nums leading-none">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide mt-1 opacity-70">{label}</p>
    </div>
  );
}

function ResultSummary({ result, onExportErrors, isStockCount = false }) {
  const [showErrors, setShowErrors] = useState(true);
  if (!result) return null;

  const hasErrors   = result.errors?.length > 0;
  const successRows = isStockCount
    ? result.updated
    : (result.created ?? 0) + (result.updated ?? 0);

  return (
    <div className="space-y-3">
      <div className={cn("grid gap-2", isStockCount ? "grid-cols-3" : "grid-cols-4")}>
        <ResultKpi label="Total"   value={result.total}        color="default" />
        {!isStockCount && <ResultKpi label="Created" value={result.created ?? 0} color="success" />}
        <ResultKpi label="Updated" value={result.updated ?? 0} color="primary" />
        <ResultKpi label="Failed"  value={result.failed}       color={result.failed > 0 ? "destructive" : "default"} />
      </div>

      {result.dry_run && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5">
          <Info className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-300 leading-relaxed">
            This was a <strong>dry run</strong> — no data was changed. Review above, then click{" "}
            <strong>{isStockCount ? "Apply for Real" : "Import for Real"}</strong> to commit.
          </p>
        </div>
      )}

      {!isStockCount && (
        (result.created_departments?.length > 0 ||
         result.created_categories?.length  > 0 ||
         result.reactivated_departments?.length > 0 ||
         result.reactivated_categories?.length  > 0) && (
          <div className="rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2.5 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary/70">Taxonomy changes</p>
            {result.created_departments?.length > 0 && (
              <p className="text-[11px]"><span className="text-muted-foreground">Created departments: </span>{result.created_departments.join(", ")}</p>
            )}
            {result.created_categories?.length > 0 && (
              <p className="text-[11px]"><span className="text-muted-foreground">Created categories: </span>{result.created_categories.join(", ")}</p>
            )}
            {result.reactivated_departments?.length > 0 && (
              <p className="text-[11px]"><span className="text-muted-foreground">Reactivated departments: </span>{result.reactivated_departments.join(", ")}</p>
            )}
            {result.reactivated_categories?.length > 0 && (
              <p className="text-[11px]"><span className="text-muted-foreground">Reactivated categories: </span>{result.reactivated_categories.join(", ")}</p>
            )}
          </div>
        )
      )}

      {hasErrors && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/[0.04] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5">
            <button
              onClick={() => setShowErrors((v) => !v)}
              className="flex items-center gap-2 text-[11px] font-semibold text-destructive"
            >
              <XCircle className="h-3.5 w-3.5" />
              {result.errors.length} error{result.errors.length !== 1 ? "s" : ""}
              {showErrors
                ? <ChevronUp   className="h-3 w-3 ml-1 text-muted-foreground" />
                : <ChevronDown className="h-3 w-3 ml-1 text-muted-foreground" />}
            </button>
            {!result.dry_run && onExportErrors && (
              <Button
                variant="outline" size="sm" onClick={onExportErrors}
                className="h-6 text-[10px] gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <FileDown className="h-3 w-3" />
                Save errors
              </Button>
            )}
          </div>

          {showErrors && (
            <div className="max-h-44 overflow-y-auto border-t border-destructive/15">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-destructive/[0.08]">
                    <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground w-10">Row</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground w-24">SKU</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-destructive/10">
                  {result.errors.map((e, i) => (
                    <tr key={i} className="hover:bg-destructive/10">
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{e.row}</td>
                      <td className="px-3 py-1.5 font-mono text-foreground">{e.sku || "—"}</td>
                      <td className="px-3 py-1.5 text-destructive">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!hasErrors && !result.dry_run && successRows > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/[0.06] px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
          <p className="text-[11px] text-success">
            {isStockCount
              ? `Stock count applied — ${successRows} item${successRows !== 1 ? "s" : ""} updated.`
              : "Import completed with no errors."}
          </p>
        </div>
      )}
    </div>
  );
}

function FileDropZone({ file, rowCount, parseError, onFileChange, onReset }) {
  const inputRef = useRef(null);
  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-7 cursor-pointer transition-all",
          file
            ? "border-primary/40 bg-primary/[0.04]"
            : "border-border/50 hover:border-primary/40 hover:bg-primary/[0.02]",
        )}
      >
        <input
          ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <>
            <FileSpreadsheet className="h-8 w-8 text-primary mb-2" />
            <p className="text-[13px] font-semibold text-foreground">{file.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {rowCount} valid row{rowCount !== 1 ? "s" : ""} found
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); onReset(); }}
              className="mt-2.5 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            >
              Remove file
            </button>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-[13px] font-semibold text-foreground">Click to choose file</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Accepts .xlsx, .xls, .csv</p>
          </>
        )}
      </div>
      {parseError && (
        <p className="mt-2 text-[11px] text-destructive flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {parseError}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Import mode selector
// ─────────────────────────────────────────────────────────────────────────────

const MODE_ICONS = { auto: Shuffle, create: PlusCircle, update: Edit3 };
const MODE_COLORS = {
  auto:   { ring: "border-primary/40 bg-primary/[0.06]",   text: "text-primary",   dot: "bg-primary"   },
  create: { ring: "border-success/40 bg-success/[0.06]",   text: "text-success",   dot: "bg-success"   },
  update: { ring: "border-amber-500/40 bg-amber-500/[0.06]", text: "text-amber-400", dot: "bg-amber-400" },
};

function ImportModeSelector({ value, onChange }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Import mode</p>
      <div className="grid grid-cols-3 gap-2">
        {IMPORT_MODES.map(({ value: v, label, desc }) => {
          const active = value === v;
          const Icon   = MODE_ICONS[v];
          const c      = MODE_COLORS[v];
          return (
            <button
              key={v}
              onClick={() => onChange(v)}
              className={cn(
                "flex flex-col items-start gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-all",
                active
                  ? `${c.ring} border-opacity-60`
                  : "border-border/50 bg-muted/10 hover:bg-muted/20",
              )}
            >
              <div className="flex items-center gap-1.5">
                <Icon className={cn("h-3.5 w-3.5", active ? c.text : "text-muted-foreground")} />
                <span className={cn("text-[11px] font-semibold", active ? c.text : "text-foreground")}>
                  {label}
                </span>
                {active && <span className={cn("ml-auto h-1.5 w-1.5 rounded-full", c.dot)} />}
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">{desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Import tab
// ─────────────────────────────────────────────────────────────────────────────

// Preview columns — action is intentionally absent
const IMPORT_PREVIEW_COLS = ["sku", "item_name", "department_name", "category_name", "selling_price", "quantity"];

function ImportTab({ storeId }) {
  const {
    file, normalisedRows, parseError, importing, progress, result,
    importMode, setImportMode,
    rowCount, handleFileChange, runImport, exportErrors, reset,
  } = useExcelImport(storeId);

  const { downloadItemTemplate } = useExcelExport(storeId);

  const hasDryResult  = result?.dry_run;
  const hasRealResult = result && !result.dry_run;

  return (
    <div className="space-y-4">
      {/* Step 1: mode selector */}
      <ImportModeSelector value={importMode} onChange={setImportMode} />

      {/* Step 2: file */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Select file
        </p>
        <FileDropZone
          file={file} rowCount={rowCount} parseError={parseError}
          onFileChange={handleFileChange} onReset={reset}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={downloadItemTemplate}
            className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            <FileDown className="h-3 w-3" />
            Download blank template
          </button>
        </div>
      </div>

      {/* Step 3: preview */}
      {normalisedRows.length > 0 && !hasRealResult && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Preview — first {Math.min(6, normalisedRows.length)} rows
          </p>
          <PreviewTable rows={normalisedRows} cols={IMPORT_PREVIEW_COLS} />
        </div>
      )}

      {/* Step 4: run */}
      {normalisedRows.length > 0 && (
        <div className="space-y-2">
          {progress && <ProgressBar progress={progress} />}
          <div className="flex items-center gap-2 flex-wrap">
            {!hasDryResult && !hasRealResult && (
              <Button variant="outline" size="sm" disabled={importing} onClick={() => runImport({ dryRun: true })} className="gap-1.5">
                {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Info className="h-3.5 w-3.5" />}
                Dry Run (Preview)
              </Button>
            )}
            {hasDryResult && (
              <Button size="sm" disabled={importing || result.failed === rowCount} onClick={() => runImport({ dryRun: false })} className="gap-1.5">
                {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Import for Real ({result.created + result.updated - result.failed} rows)
              </Button>
            )}
            {!hasDryResult && !hasRealResult && (
              <Button size="sm" disabled={importing} onClick={() => runImport({ dryRun: false })} className="gap-1.5">
                {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Import {rowCount} row{rowCount !== 1 ? "s" : ""}
              </Button>
            )}
            {(hasDryResult || hasRealResult) && (
              <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground gap-1.5">
                <RotateCcw className="h-3 w-3" />
                Start over
              </Button>
            )}
          </div>
        </div>
      )}

      {result && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {result.dry_run ? "Dry Run Results" : "Import Results"}
          </p>
          <ResultSummary result={result} onExportErrors={result.errors?.length > 0 ? exportErrors : null} />
        </div>
      )}

      {/* Column reference accordion */}
      <details className="group rounded-xl border border-border overflow-hidden">
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors list-none">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Column Reference ({ITEM_COLUMNS.length} columns)
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-open:rotate-180 transition-transform" />
        </summary>
        <div className="border-t border-border overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-muted/20">
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-36">Column</th>
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-16">Type</th>
                <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {ITEM_COLUMNS.map((col) => (
                <tr key={col.key} className="hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-mono text-foreground">
                    {col.key}
                    {col.required && <span className="ml-1 text-destructive">*</span>}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{col.type}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{col.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[10px] text-muted-foreground border-t border-border/40">
            <span className="text-destructive">*</span> = required only for new items (Create / Auto-detect mode).
          </p>
        </div>
      </details>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock Count tab
// ─────────────────────────────────────────────────────────────────────────────

const STOCK_PREVIEW_COLS = ["sku", "quantity", "notes"];

function StockCountTab({ storeId }) {
  const {
    file, normalisedRows, parseError, importing, progress, result,
    rowCount, handleFileChange, runImport, exportErrors, reset,
  } = useStockCountImport(storeId);

  const { downloadStockCountTemplate } = useExcelExport(storeId);

  const hasDryResult  = result?.dry_run;
  const hasRealResult = result && !result.dry_run;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-3.5 py-3 flex items-start gap-2.5">
        <Info className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-[11px] text-amber-300 leading-relaxed space-y-1">
          <p><strong>Stock Count</strong> sets each item's stock to the exact counted quantity.</p>
          <p className="text-amber-300/70">
            Only 3 columns needed:{" "}
            <code className="bg-amber-500/10 rounded px-1">sku</code>,{" "}
            <code className="bg-amber-500/10 rounded px-1">quantity</code>,{" "}
            <code className="bg-amber-500/10 rounded px-1">notes</code> (optional).
            Never creates new items.
          </p>
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Select stock count file
        </p>
        <FileDropZone
          file={file} rowCount={rowCount} parseError={parseError}
          onFileChange={handleFileChange} onReset={reset}
        />
        <div className="mt-2">
          <button
            onClick={downloadStockCountTemplate}
            className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            <FileDown className="h-3 w-3" />
            Download blank template
          </button>
        </div>
      </div>

      {normalisedRows.length > 0 && !hasRealResult && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Preview</p>
          <PreviewTable rows={normalisedRows} cols={STOCK_PREVIEW_COLS} />
        </div>
      )}

      {normalisedRows.length > 0 && (
        <div className="space-y-2">
          {progress && <ProgressBar progress={progress} />}
          <div className="flex items-center gap-2 flex-wrap">
            {!hasDryResult && !hasRealResult && (
              <Button variant="outline" size="sm" disabled={importing} onClick={() => runImport({ dryRun: true })} className="gap-1.5">
                {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Info className="h-3.5 w-3.5" />}
                Validate (Dry Run)
              </Button>
            )}
            {hasDryResult && (
              <Button size="sm" disabled={importing || result.failed === rowCount} onClick={() => runImport({ dryRun: false })} className="gap-1.5 bg-amber-600 hover:bg-amber-700">
                {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />}
                Apply for Real ({result.updated} rows)
              </Button>
            )}
            {!hasDryResult && !hasRealResult && (
              <Button size="sm" disabled={importing} onClick={() => runImport({ dryRun: false })} className="gap-1.5 bg-amber-600 hover:bg-amber-700">
                {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />}
                Apply {rowCount} count{rowCount !== 1 ? "s" : ""}
              </Button>
            )}
            {(hasDryResult || hasRealResult) && (
              <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground gap-1.5">
                <RotateCcw className="h-3 w-3" />
                Start over
              </Button>
            )}
          </div>
        </div>
      )}

      {result && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {result.dry_run ? "Validation Results" : "Stock Count Results"}
          </p>
          <ResultSummary
            result={result}
            onExportErrors={result.errors?.length > 0 ? exportErrors : null}
            isStockCount
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export tab
// ─────────────────────────────────────────────────────────────────────────────

function ExportTab({ storeId }) {
  const { exporting, exportToExcel, downloadItemTemplate } = useExcelExport(storeId);

  const [departments, setDepartments] = useState([]);
  const [categories,  setCategories]  = useState([]);
  const [deptFilter,  setDeptFilter]  = useState("");
  const [catFilter,   setCatFilter]   = useState("");
  const [activeFilter,setActiveFilter]= useState("");
  const [lowStock,    setLowStock]    = useState(false);

  useEffect(() => {
    getDepartmentsByStore(storeId, true).then(setDepartments).catch(() => {});
  }, [storeId]);

  useEffect(() => {
    getCategories(storeId, deptFilter ? parseInt(deptFilter) : null)
      .then(setCategories).catch(() => {});
  }, [storeId, deptFilter]);

  const hasFilter = deptFilter || catFilter || activeFilter !== "" || lowStock;

  const handleExport = () => {
    const filters = {
      departmentId: deptFilter ? parseInt(deptFilter) : null,
      categoryId:   catFilter  ? parseInt(catFilter)  : null,
      isActive:     activeFilter !== "" ? activeFilter === "true" : null,
      lowStock:     lowStock || null,
    };
    const label = [
      deptFilter  && departments.find((d) => d.id === parseInt(deptFilter))?.department_name,
      catFilter   && categories.find((c)  => c.id === parseInt(catFilter))?.category_name,
      activeFilter === "false" && "inactive",
      lowStock && "low-stock",
    ].filter(Boolean).join("_");
    exportToExcel(filters, label || "");
  };

  const clearFilters = () => {
    setDeptFilter(""); setCatFilter(""); setActiveFilter(""); setLowStock(false);
  };

  const selectCls = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="space-y-4">
      {/* Filtered export */}
      <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
            <Filter className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-foreground">Export Items</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Filter by department, category, status, or stock level. Leave all blank to export everything.
              A "Save As" dialog will open so you can choose where to save the file.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Department</label>
            <select className={selectCls} value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setCatFilter(""); }}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.department_name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Category</label>
            <select className={selectCls} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.category_name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
            <select className={selectCls} value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
              <option value="">Active & inactive</option>
              <option value="true">Active only</option>
              <option value="false">Inactive only</option>
            </select>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span className="text-[12px] text-foreground">Low stock only</span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={exporting} onClick={handleExport} className="gap-1.5">
            {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {exporting ? "Exporting…" : hasFilter ? "Export filtered" : "Export all items"}
          </Button>
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground gap-1.5">
              <RotateCcw className="h-3 w-3" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Templates */}
      <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 border border-success/20">
            <FileDown className="h-4 w-4 text-success" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-foreground">Import Templates</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Blank spreadsheets with column hints, a sample row, and a Reference sheet.
              A "Save As" dialog will open so you can choose where to save.
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={downloadItemTemplate} className="gap-1.5">
            <FileDown className="h-3.5 w-3.5" />
            Item import template
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dialog shell
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "import",      label: "Import",      icon: Upload        },
  { id: "stock_count", label: "Stock Count", icon: ClipboardList },
  { id: "export",      label: "Export",      icon: Download      },
];

export function ExcelImportExportDialog({ open, onOpenChange, storeId }) {
  const [tab, setTab] = useState("import");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
            </div>
            Excel Import / Export
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Bulk-manage your item catalog using Excel spreadsheets.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pt-4 shrink-0">
          <div className="flex gap-0.5 rounded-lg bg-muted/40 p-0.5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all",
                  tab === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === "import"      && <ImportTab      storeId={storeId} />}
          {tab === "stock_count" && <StockCountTab  storeId={storeId} />}
          {tab === "export"      && <ExportTab      storeId={storeId} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
