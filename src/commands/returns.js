// commands/returns.js — Product returns
import { rpc } from "@/lib/apiClient";

export const getReturns = (params = {}) =>
  rpc("get_returns", params);
// params: { store_id?, cashier_id?, customer_id?, status?, return_type?, date_from?, date_to?, page?, limit? }

export const getReturn = (id) =>
  rpc("get_return", { id });

export const getTransactionReturns = (txId) =>
  rpc("get_transaction_returns", { tx_id: txId });

export const createReturn = (payload) =>
  rpc("create_return", payload);
// payload: {
//   original_tx_id, refund_method, refund_reference?, reason?, notes?,
//   items: [{ item_id (UUID), quantity_returned, condition, restock, notes? }]
// }
