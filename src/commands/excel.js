// commands/excel.js — Import / export
import { rpc } from "@/lib/apiClient";

export const importItems = (storeId, filePath) =>
  rpc("import_items", { store_id: storeId, file_path: filePath });

export const importCustomers = (storeId, filePath) =>
  rpc("import_customers", { store_id: storeId, file_path: filePath });

export const exportItems = (storeId, filePath) =>
  rpc("export_items", { store_id: storeId, file_path: filePath });

export const exportTransactions = (storeId, params = {}) =>
  rpc("export_transactions", { store_id: storeId, ...params });
// params: { file_path, date_from?, date_to? }
