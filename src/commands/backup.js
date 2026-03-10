// commands/backup.js — Data backup, restore, and export
import { rpc } from "@/lib/apiClient";

// CreateBackupDto: { output_path: string, database_url: string }
export const createBackup = (payload) =>
  rpc("create_backup", payload);

// RestoreBackupDto: { backup_path: string, database_url: string }
export const restoreFromBackup = (payload) =>
  rpc("restore_from_backup", payload);

// Returns: BackupFile[] sorted by created_at DESC
export const listBackups = (directory) =>
  rpc("list_backups", { directory });

// AutoBackupScheduleDto: { store_id, backup_directory, frequency: "daily"|"weekly",
//   time_of_day: "HH:MM", database_url, retain_last_n? }
export const scheduleAutoBackup = (payload) =>
  rpc("schedule_auto_backup", payload);

// Returns JSON array of inventory rows (for CSV download)
export const exportInventoryCsv = (storeId) =>
  rpc("export_inventory_csv", { store_id: storeId });
