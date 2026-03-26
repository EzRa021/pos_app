// ============================================================================
// features/settings/BackupPanel.jsx — Backup, Restore & Auto-Schedule
// ============================================================================
//
// Sections:
//   1. Create Backup   — specify output path + DB URL → pg_dump → success card
//   2. Auto-Backup     — toggle + frequency/time/retain, calls schedule_auto_backup
//   3. Backup History  — list_backups from a scanned directory, restore per row
//   4. Restore         — <input type="file"> OS picker + confirmation dialog
//   5. Export          — inventory CSV download
//
// All schedule settings are persisted to localStorage so they survive page
// reloads (the backend only logs the schedule to audit_logs; it does not store
// it in a queryable table).
// ============================================================================

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, HardDrive, Download, UploadCloud, FolderOpen,
  CheckCircle2, AlertCircle, FileArchive, Clock, RotateCcw,
  Shield, ToggleLeft, ToggleRight, CalendarClock, Trash2,
  ChevronDown,
} from "lucide-react";
import { toastSuccess, toastError, onMutationError } from "@/lib/toast";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn }      from "@/lib/utils";
import {
  createBackup, restoreFromBackup, listBackups,
  scheduleAutoBackup, exportInventoryCsv,
} from "@/commands/backup";
import { useBranchStore } from "@/stores/branch.store";
import { formatDateTime } from "@/lib/format";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

const AUTO_BACKUP_KEY = "qpos_auto_backup_schedule";

function loadSchedule() {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSchedule(s) {
  try { localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children, badge }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2.5 px-5 py-3 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
        </div>
        {badge}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function FieldLabel({ children, required }) {
  return (
    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
      {children}{required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

// ── 1. Create Backup ──────────────────────────────────────────────────────────

function CreateBackupSection() {
  const [outputPath, setOutputPath] = useState(
    () => localStorage.getItem("qpos_last_backup_path") || ""
  );
  const [dbUrl,  setDbUrl]  = useState("");
  const [result, setResult] = useState(null);

  const backup = useMutation({
    mutationFn: () => createBackup({ output_path: outputPath.trim(), database_url: dbUrl.trim() }),
    onSuccess: (d) => {
      setResult(d);
      localStorage.setItem("qpos_last_backup_path", outputPath.trim());
      toastSuccess("Backup Created", `Database snapshot saved to ${d?.path ?? outputPath}.`);
    },
    onError: (e) => {
      setResult(null);
      onMutationError("Backup Failed", e);
    },
  });

  const canRun = outputPath.trim() && dbUrl.trim();

  return (
    <div className="space-y-3.5">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Uses <code className="text-[10px] bg-muted px-1 rounded">pg_dump</code> to create a plain-SQL
        backup file at the specified path. The file is saved directly on this machine.
      </p>

      <div className="space-y-3">
        <div>
          <FieldLabel required>Output file path</FieldLabel>
          <Input
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            placeholder="C:\Backups\pos_2026-01-01.sql"
            className="h-8 text-sm font-mono"
          />
        </div>
        <div>
          <FieldLabel required>Database URL</FieldLabel>
          <Input
            value={dbUrl}
            onChange={(e) => setDbUrl(e.target.value)}
            placeholder="postgresql://user:pass@localhost:5432/posdb"
            className="h-8 text-sm font-mono"
            type="password"
          />
        </div>
      </div>

      {result && (
        <div className="flex items-start gap-2.5 rounded-lg border border-success/25 bg-success/[0.07] px-3.5 py-3">
          <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-success">{result.message}</p>
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">{result.path}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{formatBytes(result.size_bytes)}</p>
          </div>
        </div>
      )}

      <Button
        size="sm"
        disabled={backup.isPending || !canRun}
        onClick={() => backup.mutate()}
        className="gap-1.5"
      >
        {backup.isPending
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating backup…</>
          : <><HardDrive className="h-3.5 w-3.5" />Create Backup Now</>}
      </Button>
    </div>
  );
}

// ── 2. Auto-Backup Schedule ───────────────────────────────────────────────────

const FREQUENCY_OPTIONS = [
  { value: "daily",   label: "Daily"   },
  { value: "weekly",  label: "Weekly"  },
];

const RETAIN_OPTIONS = [3, 5, 7, 10, 14, 30];

function AutoBackupSection() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const [saved, setSaved] = useState(() => loadSchedule());
  const enabled = !!(saved?.enabled);

  const [form, setForm] = useState(() => {
    const s = loadSchedule();
    return {
      enabled:          s?.enabled          ?? false,
      backup_directory: s?.backup_directory ?? "",
      frequency:        s?.frequency        ?? "daily",
      time_of_day:      s?.time_of_day      ?? "02:00",
      database_url:     s?.database_url     ?? "",
      retain_last_n:    s?.retain_last_n    ?? 7,
    };
  });

  const set = (k) => (v) => setForm((p) => ({ ...p, [k]: v }));
  const setE = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => scheduleAutoBackup({
      store_id:         storeId,
      backup_directory: form.backup_directory.trim(),
      frequency:        form.frequency,
      time_of_day:      form.time_of_day,
      database_url:     form.database_url.trim(),
      retain_last_n:    Number(form.retain_last_n),
    }),
    onSuccess: (resp) => {
      const next = { ...form };
      saveSchedule(next);
      setSaved(next);
      if (form.enabled) {
        toastSuccess("Auto-backup Scheduled", `Running ${form.frequency} at ${form.time_of_day}, keeping ${form.retain_last_n} backups.`);
      } else {
        toastSuccess("Auto-backup Disabled", "Scheduled backups have been turned off.");
      }
    },
    onError: (e) => onMutationError("Couldn't Save Schedule", e),
  });

  const canSave = !form.enabled || (form.backup_directory.trim() && form.database_url.trim());

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">Auto-backup</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Automatically create backups on a schedule
          </p>
        </div>
        <button
          type="button"
          onClick={() => setForm((p) => ({ ...p, enabled: !p.enabled }))}
          className="flex items-center gap-1.5 transition-colors"
          title={form.enabled ? "Disable auto-backup" : "Enable auto-backup"}
        >
          {form.enabled
            ? <ToggleRight className="h-7 w-7 text-primary" />
            : <ToggleLeft  className="h-7 w-7 text-muted-foreground/40" />}
          <span className={cn(
            "text-xs font-semibold",
            form.enabled ? "text-primary" : "text-muted-foreground/50",
          )}>
            {form.enabled ? "Enabled" : "Disabled"}
          </span>
        </button>
      </div>

      {/* Schedule fields — only shown when enabled */}
      {form.enabled && (
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/10 p-4">

          <div>
            <FieldLabel required>Backup directory</FieldLabel>
            <Input
              value={form.backup_directory}
              onChange={setE("backup_directory")}
              placeholder="C:\Backups"
              className="h-8 text-sm font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Frequency</FieldLabel>
              <select
                value={form.frequency}
                onChange={setE("frequency")}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Run at</FieldLabel>
              <Input
                type="time"
                value={form.time_of_day}
                onChange={setE("time_of_day")}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Keep last N backups</FieldLabel>
              <select
                value={form.retain_last_n}
                onChange={(e) => setForm((p) => ({ ...p, retain_last_n: Number(e.target.value) }))}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {RETAIN_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} backups</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <FieldLabel required>Database URL</FieldLabel>
            <Input
              value={form.database_url}
              onChange={setE("database_url")}
              placeholder="postgresql://user:pass@localhost:5432/posdb"
              className="h-8 text-sm font-mono"
              type="password"
            />
          </div>
        </div>
      )}

      {/* Saved state summary */}
      {saved?.enabled && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <CalendarClock className="h-3.5 w-3.5 text-primary shrink-0" />
          <p className="text-[11px] text-primary">
            Currently scheduled: <strong>{saved.frequency}</strong> at <strong>{saved.time_of_day}</strong>,
            keeping the last <strong>{saved.retain_last_n}</strong> backups.
          </p>
        </div>
      )}

      <Button
        size="sm"
        disabled={save.isPending || !canSave}
        onClick={() => save.mutate()}
        className="gap-1.5"
      >
        {save.isPending
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
          : <><CalendarClock className="h-3.5 w-3.5" />Save Schedule</>}
      </Button>
    </div>
  );
}

// ── 3. Backup History ─────────────────────────────────────────────────────────

function BackupHistorySection() {
  const [dir,     setDir]     = useState(() => localStorage.getItem("qpos_last_backup_path")?.split(/[\\/]/).slice(0, -1).join("\\") || "");
  const [dbUrl,   setDbUrl]   = useState("");
  const [scanned, setScanned] = useState(false);

  // Confirm-restore dialog state
  const [confirmFile, setConfirmFile] = useState(null); // BackupFile | null

  const { data: files = [], isLoading, refetch } = useQuery({
    queryKey:  ["backup-files", dir],
    queryFn:   () => listBackups(dir),
    enabled:   scanned && !!dir.trim(),
    staleTime: 0,
  });

  const restore = useMutation({
    mutationFn: (path) => restoreFromBackup({ backup_path: path, database_url: dbUrl.trim() }),
    onSuccess: () => {
      toastSuccess("Database Restored", "Restart the app now to load the restored data.");
      setConfirmFile(null);
    },
    onError: (e) => {
      onMutationError("Restore Failed", e);
      setConfirmFile(null);
    },
  });

  const handleScan = () => {
    setScanned(true);
    refetch();
  };

  return (
    <>
      <div className="space-y-3.5">
        <div className="grid grid-cols-1 gap-3">
          <div>
            <FieldLabel>Backup directory</FieldLabel>
            <div className="flex gap-2">
              <Input
                value={dir}
                onChange={(e) => setDir(e.target.value)}
                placeholder="C:\Backups"
                className="h-8 text-sm font-mono flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 shrink-0"
                onClick={handleScan}
                disabled={!dir.trim()}
              >
                <FolderOpen className="h-3.5 w-3.5" />Scan
              </Button>
            </div>
          </div>
          <div>
            <FieldLabel>Database URL (required to restore)</FieldLabel>
            <Input
              value={dbUrl}
              onChange={(e) => setDbUrl(e.target.value)}
              placeholder="postgresql://user:pass@localhost:5432/posdb"
              className="h-8 text-sm font-mono"
              type="password"
            />
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-3 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />Scanning directory…
          </div>
        )}

        {scanned && !isLoading && files.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No .sql or .dump files found in that directory.
          </p>
        )}

        {files.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_140px_80px] gap-2 px-2 pb-1 border-b border-border/40">
              {["File", "Size", "Modified", ""].map((h, i) => (
                <span key={i} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {h}
                </span>
              ))}
            </div>

            {files.map((f) => (
              <div key={f.path}
                className="grid grid-cols-[1fr_80px_140px_80px] gap-2 items-center rounded-lg border border-border bg-muted/20 px-2 py-2.5 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <FileArchive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-semibold text-foreground truncate">{f.filename}</span>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground">{formatBytes(f.size_bytes)}</span>
                <span className="text-[11px] text-muted-foreground">{formatDateTime(f.created_at)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] gap-1 px-2"
                  disabled={!dbUrl.trim() || restore.isPending}
                  onClick={() => setConfirmFile(f)}
                >
                  <RotateCcw className="h-3 w-3" />Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm-restore dialog */}
      <Dialog open={!!confirmFile} onOpenChange={(v) => { if (!v) setConfirmFile(null); }}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          <div className="h-[3px] w-full bg-destructive" />
          <div className="p-6 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold">Restore backup?</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {confirmFile?.filename}
                </DialogDescription>
              </div>
            </div>
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
              <p className="text-xs text-destructive leading-relaxed">
                <strong>This will overwrite all current data.</strong> This action cannot be undone.
                Make sure you have a recent backup before proceeding.
              </p>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <p>File: <span className="font-mono text-foreground">{confirmFile?.filename}</span></p>
              <p>Size: <span className="font-mono text-foreground">{formatBytes(confirmFile?.size_bytes)}</span></p>
              <p>Created: <span className="font-mono text-foreground">{formatDateTime(confirmFile?.created_at)}</span></p>
            </div>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmFile(null)} disabled={restore.isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-destructive hover:bg-destructive/90 text-white gap-1.5"
              disabled={restore.isPending}
              onClick={() => restore.mutate(confirmFile.path)}
            >
              {restore.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Restoring…</>
                : <><RotateCcw className="h-3.5 w-3.5" />Yes, Restore</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 4. Restore from File ──────────────────────────────────────────────────────
// Uses a hidden <input type="file"> to open the OS file picker, then shows a
// confirmation dialog before calling restore_from_backup.

function RestoreFromFileSection() {
  const fileInputRef         = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);   // { name, path }
  const [dbUrl,        setDbUrl]        = useState("");
  const [confirmOpen,  setConfirmOpen]  = useState(false);

  const restore = useMutation({
    mutationFn: () => restoreFromBackup({ backup_path: selectedFile.path, database_url: dbUrl.trim() }),
    onSuccess: () => {
      toastSuccess("Database Restored", "Restart the app now to load the restored data.");
      setConfirmOpen(false);
      setSelectedFile(null);
    },
    onError: (e) => {
      onMutationError("Restore Failed", e);
      setConfirmOpen(false);
    },
  });

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // In Tauri the `path` property is the absolute filesystem path
    const path = file.path ?? file.name;
    setSelectedFile({ name: file.name, path });
    // Reset input so the same file can be reselected if needed
    e.target.value = "";
  };

  const canRestore = selectedFile && dbUrl.trim();

  return (
    <>
      <div className="space-y-3.5">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Pick a <code className="text-[10px] bg-muted px-1 rounded">.sql</code> or{" "}
          <code className="text-[10px] bg-muted px-1 rounded">.dump</code> file from your machine,
          then confirm to overwrite the current database.
        </p>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".sql,.dump"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* File picker trigger */}
        <div>
          <FieldLabel>Backup file</FieldLabel>
          <div className="flex gap-2">
            <div className={cn(
              "flex-1 flex items-center rounded-md border px-3 h-8 text-sm font-mono truncate",
              selectedFile ? "border-input text-foreground" : "border-input text-muted-foreground/50",
            )}>
              {selectedFile?.name ?? "No file chosen"}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1.5"
              onClick={() => fileInputRef.current?.click()}
            >
              <FolderOpen className="h-3.5 w-3.5" />Choose file
            </Button>
          </div>
        </div>

        <div>
          <FieldLabel required>Database URL</FieldLabel>
          <Input
            value={dbUrl}
            onChange={(e) => setDbUrl(e.target.value)}
            placeholder="postgresql://user:pass@localhost:5432/posdb"
            className="h-8 text-sm font-mono"
            type="password"
          />
        </div>

        <Button
          size="sm"
          variant="destructive"
          disabled={!canRestore}
          onClick={() => setConfirmOpen(true)}
          className="gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" />Restore Database
        </Button>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={(v) => { if (!v && !restore.isPending) setConfirmOpen(false); }}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          <div className="h-[3px] w-full bg-destructive" />
          <div className="p-6 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold">Confirm restore</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {selectedFile?.name}
                </DialogDescription>
              </div>
            </div>
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
              <p className="text-xs text-destructive leading-relaxed">
                <strong>All current data will be replaced.</strong> This cannot be undone.
                Back up the current database first if you are unsure.
              </p>
            </div>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={restore.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-destructive hover:bg-destructive/90 text-white gap-1.5"
              disabled={restore.isPending}
              onClick={() => restore.mutate()}
            >
              {restore.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Restoring…</>
                : <><RotateCcw className="h-3.5 w-3.5" />Confirm Restore</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 5. Export ─────────────────────────────────────────────────────────────────

function ExportSection() {
  const storeId = useBranchStore((s) => s.activeStore?.id);

  const exportInv = useMutation({
    mutationFn: () => exportInventoryCsv(storeId),
    onSuccess: (rows) => {
      if (!rows?.length) { toastError("Nothing to Export", "Your inventory appears to be empty — add some items first."); return; }
      const keys = Object.keys(rows[0]);
      const csv  = [
        keys.join(","),
        ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(",")),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toastSuccess("Export Ready", `${rows.length} items downloaded as inventory_${new Date().toISOString().slice(0, 10)}.csv.`);
    },
    onError: (e) => onMutationError("Export Failed", e),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Download a CSV snapshot of your current inventory for use in spreadsheets or external tools.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={exportInv.isPending || !storeId}
        onClick={() => exportInv.mutate()}
        className="gap-1.5"
      >
        {exportInv.isPending
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Exporting…</>
          : <><Download className="h-3.5 w-3.5" />Export Inventory CSV</>}
      </Button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function BackupPanel() {
  return (
    <div className="space-y-5">

      {/* Warning banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/[0.07] px-4 py-3.5">
        <Shield className="h-4 w-4 text-warning mt-0.5 shrink-0" />
        <p className="text-[11px] text-warning leading-relaxed">
          <strong>Back up regularly.</strong> In the event of hardware failure or accidental deletion,
          only a recent backup can restore your complete business records. Store backups on a separate
          drive or cloud location.
        </p>
      </div>

      <SectionCard title="Create Backup" icon={HardDrive}>
        <CreateBackupSection />
      </SectionCard>

      <SectionCard title="Auto-Backup Schedule" icon={CalendarClock}>
        <AutoBackupSection />
      </SectionCard>

      <SectionCard title="Backup History" icon={FolderOpen}>
        <BackupHistorySection />
      </SectionCard>

      <SectionCard title="Restore from File" icon={RotateCcw}>
        <RestoreFromFileSection />
      </SectionCard>

      <SectionCard title="Export Data" icon={Download}>
        <ExportSection />
      </SectionCard>

    </div>
  );
}
