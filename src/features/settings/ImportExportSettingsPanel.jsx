// features/settings/ImportExportSettingsPanel.jsx
// Lets the user pick and save a folder for all Excel exports.
// Exports (items, customers, transactions, error reports, templates) are
// written directly to this folder using Tauri's native fs plugin.

import { useState, useEffect } from "react";
import { open }                from "@tauri-apps/plugin-dialog";
import {
  FolderOpen, FolderCheck, Save, AlertCircle, CheckCircle2,
  FileSpreadsheet, Info,
} from "lucide-react";
import { toast }   from "sonner";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { cn }      from "@/lib/utils";
import { getExportFolder, setExportFolder } from "@/lib/excelSettings";

export function ImportExportSettingsPanel() {
  const [folder,  setFolder]  = useState(() => getExportFolder());
  const [saved,   setSaved]   = useState(() => getExportFolder());
  const [picking, setPicking] = useState(false);

  // Keep local state in sync if another tab/component changes the value
  useEffect(() => {
    const stored = getExportFolder();
    setFolder(stored);
    setSaved(stored);
  }, []);

  const handleBrowse = async () => {
    setPicking(true);
    try {
      const selected = await open({
        directory: true,
        multiple:  false,
        title:     "Select Excel Export Folder",
      });
      if (selected && typeof selected === "string") {
        setFolder(selected);
      }
    } catch (e) {
      toast.error("Could not open folder picker: " + (e?.message ?? e));
    } finally {
      setPicking(false);
    }
  };

  const handleSave = () => {
    setExportFolder(folder.trim());
    setSaved(folder.trim());
    toast.success("Export folder saved.");
  };

  const handleClear = () => {
    setFolder("");
    setExportFolder("");
    setSaved("");
    toast.success("Export folder cleared.");
  };

  const isDirty   = folder.trim() !== saved.trim();
  const hasFolder = !!saved.trim();

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3.5">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground">How it works</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Choose a folder on this computer. Every Excel file you export — items,
            customers, error reports, and templates — will be saved directly into that
            folder, organised automatically with a date-stamp in the filename.
          </p>
        </div>
      </div>

      {/* Folder picker */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/30">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </div>
          <h3 className="text-[13px] font-bold text-foreground">Export Folder</h3>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Folder path
          </label>
          <div className="flex gap-2">
            <Input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Click Browse to pick a folder…"
              className="h-9 font-mono text-[12px] flex-1"
              readOnly
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 shrink-0"
              onClick={handleBrowse}
              disabled={picking}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Browse
            </Button>
          </div>
        </div>

        {/* Current saved path status */}
        {hasFolder && !isDirty && (
          <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/[0.06] px-3 py-2.5">
            <FolderCheck className="h-3.5 w-3.5 text-success shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-success">Export folder is set</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">{saved}</p>
            </div>
          </div>
        )}

        {!hasFolder && !isDirty && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5">
            <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <p className="text-[11px] text-amber-300">
              No export folder set. Exports will download via the browser until you configure one.
            </p>
          </div>
        )}

        {isDirty && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.05] px-3 py-2.5">
            <Info className="h-3.5 w-3.5 text-primary shrink-0" />
            <p className="text-[11px] text-primary">Unsaved — click Save to apply this folder.</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            disabled={!isDirty || !folder.trim()}
            onClick={handleSave}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            Save folder
          </Button>
          {hasFolder && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClear}
              className="text-muted-foreground hover:text-destructive"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* What gets exported here */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/30">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          </div>
          <h3 className="text-[13px] font-bold text-foreground">Files saved to this folder</h3>
        </div>

        <div className="space-y-2">
          {[
            { label: "Item export",           file: "items_export_YYYY-MM-DD.xlsx" },
            { label: "Filtered item export",  file: "items_export_<filter>_YYYY-MM-DD.xlsx" },
            { label: "Item import template",  file: "items_import_template.xlsx" },
            { label: "Stock count template",  file: "stock_count_template.xlsx" },
            { label: "Import error report",   file: "import_errors_YYYY-MM-DD.xlsx" },
            { label: "Stock count errors",    file: "stock_count_errors_YYYY-MM-DD.xlsx" },
          ].map(({ label, file }) => (
            <div key={file} className="flex items-center justify-between gap-4 py-1 border-b border-border/30 last:border-0">
              <span className="text-[11px] text-foreground">{label}</span>
              <code className="text-[10px] font-mono text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
                {file}
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
