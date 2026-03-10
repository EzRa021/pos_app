// ============================================================================
// features/settings/BackupPanel.jsx — Database backup, restore & export
// ============================================================================
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, HardDrive, Download, UploadCloud, FolderOpen,
  CheckCircle2, AlertCircle, RefreshCw, FileArchive, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { cn }      from "@/lib/utils";
import {
  createBackup, restoreFromBackup, listBackups,
  scheduleAutoBackup, exportInventoryCsv,
} from "@/commands/backup";
import { useBranchStore } from "@/stores/branch.store";
import { formatDateTime } from "@/lib/format";

function SectionCard({ title, icon: Icon, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

// ── Manual Backup ─────────────────────────────────────────────────────────────
function ManualBackupPanel() {
  const [outputPath, setOutputPath] = useState("");
  const [dbUrl,      setDbUrl]      = useState("");
  const [result,     setResult]     = useState(null);

  const backup = useMutation({
    mutationFn: () => createBackup({ output_path: outputPath, database_url: dbUrl }),
    onSuccess: (d) => { setResult(d); toast.success("Backup created successfully."); },
    onError:   (e) => { setResult(null); toast.error(String(e)); },
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Requires <code className="text-[10px] bg-muted px-1 rounded">pg_dump</code> to be available
        on the system PATH. The backup will be saved as a plain SQL file.
      </p>
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Output File Path</label>
        <Input value={outputPath} onChange={(e) => setOutputPath(e.target.value)}
          placeholder="C:\Backups\pos_backup_2026.sql" className="h-8 text-sm font-mono" />
      </div>
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Database URL</label>
        <Input value={dbUrl} onChange={(e) => setDbUrl(e.target.value)}
          placeholder="postgresql://user:pass@localhost:5432/posdb" className="h-8 text-sm font-mono" type="password" />
      </div>
      {result && (
        <div className="flex items-start gap-2 rounded-lg border border-success/25 bg-success/8 px-3 py-2.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-success">{result.message}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{result.path}</p>
          </div>
        </div>
      )}
      <Button size="sm" disabled={backup.isPending || !outputPath || !dbUrl} onClick={() => backup.mutate()} className="gap-1.5">
        {backup.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating…</> : <><HardDrive className="h-3.5 w-3.5" />Create Backup</>}
      </Button>
    </div>
  );
}

// ── Backup Browser ────────────────────────────────────────────────────────────
function BackupBrowserPanel() {
  const [dir, setDir]       = useState("");
  const [dbUrl, setDbUrl]   = useState("");
  const [searched, setSearched] = useState(false);

  const { data: files = [], isLoading, refetch } = useQuery({
    queryKey: ["backup-files", dir],
    queryFn:  () => listBackups(dir),
    enabled:  searched && !!dir,
    staleTime: 0,
  });

  const restore = useMutation({
    mutationFn: (path) => restoreFromBackup({ backup_path: path, database_url: dbUrl }),
    onSuccess: () => toast.success("Database restored. Please restart the app."),
    onError:   (e) => toast.error(String(e)),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Backup Directory</label>
          <div className="flex gap-2">
            <Input value={dir} onChange={(e) => setDir(e.target.value)}
              placeholder="C:\Backups" className="h-8 text-sm font-mono flex-1" />
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setSearched(true); refetch(); }}>
              <FolderOpen className="h-3.5 w-3.5" />Browse
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Database URL (for restore)</label>
          <Input value={dbUrl} onChange={(e) => setDbUrl(e.target.value)}
            placeholder="postgresql://user:pass@localhost:5432/posdb" className="h-8 text-sm font-mono" type="password" />
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning…
        </div>
      )}

      {searched && !isLoading && files.length === 0 && (
        <p className="text-xs text-muted-foreground py-3 text-center">No .sql or .dump files found in that directory.</p>
      )}

      {files.length > 0 && (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {files.map((f) => (
            <div key={f.path} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3.5 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{f.filename}</p>
                  <p className="text-[10px] text-muted-foreground">{formatBytes(f.size_bytes)} · {formatDateTime(f.created_at)}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 shrink-0"
                disabled={!dbUrl || restore.isPending}
                onClick={() => restore.mutate(f.path)}>
                <UploadCloud className="h-3 w-3" />Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────
function ExportPanel() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const exportInv = useMutation({
    mutationFn: () => exportInventoryCsv(storeId),
    onSuccess: (rows) => {
      // Build CSV in browser
      if (!rows?.length) { toast.error("No inventory data to export."); return; }
      const keys = Object.keys(rows[0]);
      const csv  = [
        keys.join(","),
        ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(",")),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `inventory_export_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} items.`);
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Download a CSV snapshot of your current inventory.</p>
      <Button size="sm" variant="outline" disabled={exportInv.isPending || !storeId} onClick={() => exportInv.mutate()} className="gap-1.5">
        {exportInv.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Exporting…</> : <><Download className="h-3.5 w-3.5" />Export Inventory CSV</>}
      </Button>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export function BackupPanel() {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3">
        <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
        <p className="text-[11px] text-warning leading-relaxed">
          <strong>Important:</strong> Always back up your data regularly. In the event of power failure
          or hardware damage, only a recent backup can restore your business records.
        </p>
      </div>
      <SectionCard title="Create Backup" icon={HardDrive}><ManualBackupPanel /></SectionCard>
      <SectionCard title="Browse & Restore Backups" icon={FolderOpen}><BackupBrowserPanel /></SectionCard>
      <SectionCard title="Export Data" icon={Download}><ExportPanel /></SectionCard>
    </div>
  );
}
