// commands/payments.js — Payment records
import { rpc } from "@/lib/apiClient";

export const getPayments = (params = {}) =>
  rpc("get_payments", params);
// params: { store_id?, transaction_id?, payment_method?, date_from?, date_to?,
//            page?, page_size? }
