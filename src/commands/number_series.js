// commands/number_series.js — Invoice / receipt numbering per store
import { rpc } from "@/lib/apiClient";

export const getNumberSeries = (storeId) =>
  rpc("get_number_series", { store_id: storeId });

export const updateNumberSeries = (payload) =>
  rpc("update_number_series", payload);
// payload: { store_id, doc_type, prefix?, suffix?, pad_length?, next_number? }
// doc_type: 'invoice' | 'receipt' | 'purchase_order' | 'return'
//
// Invoice format:  {prefix}{0000}-{suffix}  e.g. TNX-0001-LAG
// Other formats:   {prefix}{00000}          e.g. RCP-00001
