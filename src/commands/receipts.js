// commands/receipts.js — Receipt generation
import { rpc } from "@/lib/apiClient";

export const getReceipt = (transactionId) =>
  rpc("get_receipt", { transaction_id: transactionId });

export const generateReceiptHtml = (transactionId) =>
  rpc("generate_receipt_html", { transaction_id: transactionId });

export const getReceiptSettings = (storeId) =>
  rpc("get_receipt_settings", { store_id: storeId });

export const updateReceiptSettings = (payload) =>
  rpc("update_receipt_settings", { payload });
