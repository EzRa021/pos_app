// lib/excelSettings.js
// Tiny helper for persisting the user-chosen Excel export folder path.
// We use localStorage directly (no server, no Tauri store) because this is
// a local UI preference that belongs on this machine only.

const KEY = "qpos_excel_export_folder";

export function getExportFolder() {
  return localStorage.getItem(KEY) ?? "";
}

export function setExportFolder(path) {
  if (path) {
    localStorage.setItem(KEY, path);
  } else {
    localStorage.removeItem(KEY);
  }
}
