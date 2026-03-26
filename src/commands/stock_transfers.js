// commands/stock_transfers.js — Inter-branch stock transfers
import { rpc } from "@/lib/apiClient";

// CreateTransferDto: { from_store_id, to_store_id, notes?,
//   items: [{ item_id: UUID, qty_requested: f64 }] }
export const createTransfer = (payload) =>
  rpc("create_transfer", payload);

// SendTransferDto: items: [{ item_id: UUID, qty_sent: f64 }]
export const sendTransfer = (id, payload) =>
  rpc("send_transfer", { id, ...payload });

// ReceiveTransferDto: items: [{ item_id: UUID, qty_received: f64 }]
export const receiveTransfer = (id, payload) =>
  rpc("receive_transfer", { id, ...payload });

export const cancelTransfer = (id) =>
  rpc("cancel_transfer", { id });

// TransferFilters: { store_id?, status?, page?, limit? }
export const getTransfers = (params = {}) =>
  rpc("get_transfers", params);

export const getTransfer = (id) =>
  rpc("get_transfer", { id });

export const searchTransfers = (query, storeId, limit = 8) =>
  rpc("search_transfers", { query, store_id: storeId ?? null, limit });
